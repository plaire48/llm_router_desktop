# -*- coding: utf-8 -*-
"""질문지 답변과 구조 편집 결과를 task JSON에 적용한다.

구조화된 답변은 Python 규칙으로 직접 적용하고, AI 작성이 필요한 항목만
``remaining``으로 반환한다. 구조 편집에서는 기존 노드 ID와 공통 필드를 보존하고,
노드 추가·삭제와 판단 분기를 함께 정리한다. Connected Creator 제출은 구성과
입출력을 한 번에 저장한다.

CLI (AI 에이전트의 /e2e-agent-creator가 실행):
  python ops_runtime/author_apply.py answers   <task.json> <answers.json>
  python ops_runtime/author_apply.py structure <task.json> <edit.json>
"""
import argparse
import copy
import datetime
import hashlib
import json
import os
import re
import shutil
import sys
import tempfile
import time

if __package__ in (None, ""):
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from ops_runtime import (custom_logic_jobs, mutation_lock, references,
                             task_catalog, task_compat, util, validate, workspace)
    from ops_runtime.author_questions import (
        PENDING, collect_detail_questions, collect_questions,
        collect_revision_questions)
    from ops_runtime.engine import (
        ACTION_TYPE_KO, _input_runtime_keys, _task_fingerprint)
else:
    from . import (custom_logic_jobs, mutation_lock, references, task_catalog,
                   task_compat, util, validate, workspace)
    from .author_questions import (
        PENDING, collect_detail_questions, collect_questions,
        collect_revision_questions)
    from .engine import ACTION_TYPE_KO, _input_runtime_keys, _task_fingerprint

RESULT_INSTRUCTION = (
    "AI 에이전트: 기계적 항목(입출력·api integration·command·라벨 재구성 포함)은 이 도구가 "
    "이미 task JSON에 반영·저장했다 – 같은 항목을 Edit로 다시 적용하지 마라(이중 적용 "
    "금지). remaining의 각 항목만 질문지 instruction의 기존 적용 규칙대로 네가 처리하라"
    "(생성 작업: 커스텀 로직 작성·notify "
    "채널 상세 등). ask_back과 unanswered 항목은 questionnaire의 해당 질문 문구로 "
    "채팅에서 되물어라 – 값을 임의로 채우는 것 금지. notes는 사용자 안내 문구다(요약해 "
    "전달). validate 결과의 오류를 확인하고, 미정 항목이 남았으면 author_questions를 "
    "재실행해 새 질문지를 받아라.")

STALE_INSTRUCTION = (
    "AI 에이전트: 답변이 낡은 질문지/폼에서 온 것이라 적용하지 않았다(task JSON 무변경). "
    "author_questions를 다시 실행해 폼을 재생성하고 사용자에게 다시 안내하라.")

IO_RESULT_INSTRUCTION = (
    "AI 에이전트: 현재 노드 입출력 확인 결과만 task JSON에 결정적으로 반영했다. "
    "같은 입출력을 직접 Edit로 다시 적용하지 마라. ask_back·unanswered가 남으면 최신 "
    "입출력 확인 화면에서 해당 노드만 다시 확인하고, 모두 끝났으면 상세 질문 단계로 "
    "진행하라.")


def _cfg_for(node, system):
    """system이 지정된 답(복수 시스템 노드)은 해당 시스템 설정에 반영한다."""
    if not system or not node.get("systems"):
        return node
    for s in node.get("systems") or []:
        if s.get("name") == system:
            return s
    return None


def _prune_external_inputs(task):
    used = {i.get("source", "")[len("$.inputs_from."):]
            for n in task.get("nodes") or [] for i in n.get("inputs") or []
            if i.get("source", "").startswith("$.inputs_from.")}
    task["inputs_from"] = [s for s in task.get("inputs_from") or []
                           if s.get("from_task") or s.get("name") in used]


def _set_file_inputs(task, node, fields):
    """file_read가 실제로 소비하는 입력만 남기고 외부 입력 선언을 동기화한다."""
    previous = {i.get("field"): i for i in node.get("inputs") or []}
    node["inputs"] = []
    for field in fields:
        old = previous.get(field)
        source = old.get("source") if old else f"$.inputs_from.{field}"
        node["inputs"].append({"field": field, "source": source})
        if source.startswith("$.inputs_from."):
            name = source[len("$.inputs_from."):]
            if not any(s.get("name") == name for s in task.get("inputs_from") or []):
                task.setdefault("inputs_from", []).append({"name": name})
    _prune_external_inputs(task)


def _read_text(path):
    try:
        with open(path, encoding="utf-8") as f:
            return f.read()
    except OSError:
        return None


def _write_text(path, text):
    """같은 폴더의 임시 파일을 교체해 프롬프트를 원자적으로 저장한다."""
    directory = os.path.dirname(os.path.abspath(path))
    os.makedirs(directory, exist_ok=True)
    fd, temporary = tempfile.mkstemp(dir=directory, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(text)
        for attempt in range(5):
            try:
                os.replace(temporary, path)
                return
            except PermissionError:
                time.sleep(0.1 * (attempt + 1))
        os.replace(temporary, path)
    except Exception:
        if os.path.exists(temporary):
            os.remove(temporary)
        raise


def _json_sha256(value):
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True,
                     separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _task_diff(before, after):
    """이력에서 빠르게 확인할 수 있는 구조·입출력 변경 요약."""
    before_nodes = {n.get("id"): n for n in before.get("nodes", []) if n.get("id")}
    after_nodes = {n.get("id"): n for n in after.get("nodes", []) if n.get("id")}
    common = sorted(set(before_nodes) & set(after_nodes))

    renamed, type_changed, branch_changed, io_changed = [], [], [], []
    for nid in common:
        old, new = before_nodes[nid], after_nodes[nid]
        if old.get("name") != new.get("name"):
            renamed.append({"id": nid, "before": old.get("name"), "after": new.get("name")})
        old_type = old.get("action_type") or old.get("type")
        new_type = new.get("action_type") or new.get("type")
        if old_type != new_type:
            type_changed.append({"id": nid, "before": old_type, "after": new_type})
        old_branch = {"source_node": old.get("source_node"), "labels": old.get("labels"),
                      "cases": old.get("cases"), "next": old.get("next")}
        new_branch = {"source_node": new.get("source_node"), "labels": new.get("labels"),
                      "cases": new.get("cases"), "next": new.get("next")}
        if old_branch != new_branch:
            branch_changed.append({"id": nid, "before": old_branch, "after": new_branch})
        old_io = {"inputs": old.get("inputs") or [], "outputs": old.get("outputs") or []}
        new_io = {"inputs": new.get("inputs") or [], "outputs": new.get("outputs") or []}
        if old_io != new_io:
            io_changed.append({"id": nid, "before": old_io, "after": new_io})
    return {
        "added_nodes": sorted(set(after_nodes) - set(before_nodes)),
        "deleted_nodes": sorted(set(before_nodes) - set(after_nodes)),
        "renamed_nodes": renamed,
        "type_changes": type_changed,
        "branch_changes": branch_changed,
        "io_changes": io_changed,
    }


def _validated(task_path, task):
    result = validate.validate(task, task_path)
    result["task_path"] = os.path.abspath(task_path)
    result["task_fingerprint"] = _task_fingerprint(task_path)
    return result


def _write_history(task_path, kind, before, after, payload, summary, validate_result):
    """저작 적용의 before/after와 payload를 한 파일에 보존한다."""
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    task_id = str(after.get("task_id") or "task")
    folder = workspace.history_dir(task_path, task_id)
    path = os.path.join(folder, f"{stamp}-{kind}.json")
    record = {
        "kind": kind,
        "applied_at": datetime.datetime.now().isoformat(timespec="seconds"),
        "task_path": os.path.abspath(task_path),
        "before_sha256": _json_sha256(before),
        "after_sha256": _json_sha256(after),
        "payload_sha256": _json_sha256(payload),
        "summary": summary,
        "diff": _task_diff(before, after),
        "payload": payload,
        "before": before,
        "after": after,
        "validate": validate_result,
    }
    util.atomic_write_json(path, record)
    return path


def _next_action(task_path, action_type="rerender_structure_gate"):
    return {"type": action_type,
            "command": f'python ops_runtime/author_questions.py "{task_path}"'}


class _Apply:
    """한 번의 적용 세션 – 결과 수집기."""

    def __init__(self, task, base_dir, previous_catalog=None,
                 drop_connected_inputs=False, revision=False,
                 persist_files=True, task_path=None):
        self.task = task
        self.base_dir = base_dir
        self.previous_catalog = previous_catalog or {"tasks": [], "diagnostics": []}
        self.drop_connected_inputs = bool(drop_connected_inputs)
        self.revision = bool(revision)
        self.persist_files = bool(persist_files)
        self.task_path = task_path or os.path.join(
            base_dir or os.getcwd(), (task.get("task_id") or "task") + ".json")
        self.by_id = {n.get("id"): n for n in task.get("nodes", [])}
        self.applied = []
        self.remaining = []
        self.ask_back = []
        self.notes = []
        self.stale = []
        self.reference_issues = []
        # 판단 프롬프트는 모든 답 검증이 끝난 뒤 task JSON과 함께 저장한다.
        # path/content/before를 보관해 외부 변경 감지와 실패 롤백에 사용한다.
        self.text_writes = []
        # 커스텀 로직 해제는 Task가 유효한지 먼저 확인한 뒤 전용 폴더만 삭제한다.
        self.custom_logic_deletions = []
        # 1.5패스(입출력 편집)가 반영한 답 – io_confirmed 확정은 질문 번호 대조가
        # 끝난 마지막에 한다(먼저 바꾸면 질문 수가 줄어 no 대조가 어긋난다)
        self.io_pending = []

    def ok(self, ans, what):
        self.applied.append({"no": ans.get("no"), "node_id": ans.get("node_id"),
                             "target": ans.get("target"), "applied": what})

    def rem(self, ans, action, todo, detail=None, **extra):
        item = {"no": ans.get("no"), "node_id": ans.get("node_id"),
                "action": action, "todo": todo}
        if detail:
            item["detail"] = detail
        item.update(extra)
        self.remaining.append(item)

    def back(self, ans, reason):
        self.ask_back.append({"no": ans.get("no"), "node_id": ans.get("node_id"),
                              "qtype": ans.get("qtype"), "reason": reason})

    # ------------------------------------------------------------ 1패스: 라벨
    # 프롬프트 초안이 라벨을 포함하므로 라벨 변경을 먼저 반영해야
    # 2패스의 초안 파일이 갱신된 라벨로 만들어진다.

    def apply_labels(self, ans, node):
        value = ans.get("value")
        if ans.get("qtype") == "labels_input":
            labels = value if isinstance(value, list) else [
                s.strip() for s in str(value).splitlines() if s.strip()]
            if not labels:
                return self.back(ans, "라벨 목록이 비었습니다")
            node["labels"] = labels
            self.ok(ans, f"labels {len(labels)}개 설정")
            ifs = [n for n in self.task.get("nodes", [])
                   if n.get("type") == "if" and n.get("source_node") == node.get("id")]
            case_values = {c.get("value") for n in ifs for c in n.get("cases", [])}
            if case_values and case_values != set(labels):
                self.rem(ans, "labels_if_mismatch",
                         "설정한 labels가 후속 If의 cases 값과 다르다 – 사용자와 확인해 "
                         "If cases를 함께 맞춰라(검증기가 집합 일치를 강제한다)")
            return
        # labels_fixed – '그대로'(유지), [{label, next, was?}] 최종 배열(폼 –
        # 이름 변경·추가·삭제·분기 대상까지), 또는 [{from, to}] 이름 변경(채팅 폴백)
        if value == "그대로":
            return self.ok(ans, "라벨 유지")
        if not isinstance(value, list) or not value:
            return self.back(ans, "라벨 답 형식을 해석할 수 없습니다 – 라벨은 1개 이상이어야 "
                                  "합니다(분기 자체를 없애려면 구성 편집기에서)")
        if all(isinstance(r, dict) and "label" in r for r in value):
            return self._labels_final(ans, node, value)
        labels = node.get("labels") or []
        for r in value:
            frm, to = (r or {}).get("from"), (r or {}).get("to")
            if not frm or not to:
                return self.back(ans, "라벨 이름 변경 항목에 from/to가 없습니다")
            if frm not in labels:
                self.stale.append(f"[{node.get('name') or '판단'}] 라벨 '{frm}'이 현재 labels에 없습니다"
                                  " – 낡은 질문지의 답입니다")
                return
        for r in value:
            frm, to = r["from"], r["to"]
            labels[labels.index(frm)] = to
            for n in self.task.get("nodes", []):
                if n.get("type") == "if" and n.get("source_node") == node.get("id"):
                    for c in n.get("cases", []):
                        if c.get("value") == frm:
                            c["value"] = to
            pf = node.get("prompt_file")
            body = _read_text(pf) if pf and PENDING not in str(pf) else None
            if body and frm in body:
                self.rem(ans, "label_in_prompt_file",
                         f"프롬프트 파일({pf})에 옛 라벨 '{frm}'이 남아 있다 – "
                         f"'{to}'로 함께 수정하라")
        node["labels"] = labels
        self.ok(ans, f"라벨 이름 변경 {len(value)}건 (If cases 동기 수정)")

    def _labels_final(self, ans, node, rows):
        """폼의 라벨 최종 배열 적용 – labels와 후속 If cases를 통째로 재구성한다
        (ops_structure_edit과 같은 최종 배열 원칙)."""
        nid = node.get("id")
        labels = node.get("labels") or []
        finals = [str(r.get("label") or "").strip() for r in rows]
        if not all(finals):
            return self.back(ans, "빈 라벨 이름이 있습니다")
        if len(finals) != len(set(finals)):
            return self.back(ans, "라벨 이름이 중복됩니다")
        for r in rows:
            was = r.get("was")
            if was and was not in labels:
                self.stale.append(f"[{node.get('name') or '판단'}] 라벨 '{was}'이 현재 labels에 없습니다 – "
                                  "낡은 질문지의 답입니다")
                return
        ifn = next((n for n in self.task.get("nodes", [])
                    if n.get("type") == "if" and n.get("source_node") == nid), None)
        if ifn is None:
            return self.back(ans, "후속 If 노드가 없습니다 – 낡은 답변이거나 산출형 "
                                  "판단입니다(라벨 편집 불가)")
        valid = {n.get("id") for n in self.task.get("nodes", [])
                 if n.get("type") != "if" and n.get("id") != nid}
        for r in rows:
            nxt = r.get("next")
            if nxt and nxt not in valid:
                self.stale.append(f"[{node.get('name') or '판단'}] 선택한 분기 대상이 현재 구성에 없습니다 – "
                                  "낡은 질문지의 답입니다")
                return
        covered = ({r.get("was") for r in rows if r.get("was")}
                   | {r["label"] for r in rows})
        renamed = [(r["was"], r["label"]) for r in rows
                   if r.get("was") and r["was"] != r["label"]]
        added = [r["label"] for r in rows if not r.get("was")]
        removed = [x for x in labels if x not in covered]
        node["labels"] = finals
        ifn["cases"] = [{"value": r["label"], "next": r.get("next") or None}
                        for r in rows]
        pf = node.get("prompt_file")
        body = _read_text(pf) if pf and PENDING not in str(pf) else None
        for frm, to in renamed:
            if body and frm in body:
                self.rem(ans, "label_in_prompt_file",
                         f"프롬프트 파일({pf})에 옛 라벨 '{frm}'이 남아 있다 – "
                         f"'{to}'로 함께 수정하라")
        for lb in removed:
            if body and lb in body:
                self.rem(ans, "label_in_prompt_file",
                         f"프롬프트 파일({pf})에 삭제된 라벨 '{lb}'의 서술이 남아 있다 – "
                         "해당 분기 서술을 정리하라")
        for lb in added:
            if body is not None and lb not in body:
                self.notes.append(f"[{node.get('name') or '판단'}] 새 라벨 '{lb}'의 선택 기준이 프롬프트 파일에 "
                                  "없습니다 – 실행 전까지 파일에 채워 달라고 안내하세요")
        self.ok(ans, f"라벨 재구성 – 이름변경 {len(renamed)}·추가 {len(added)}·삭제 "
                     f"{len(removed)} (If cases 동기 재구성)")

    def _apply_method_choice(self, ans, q, node, value, detail):
        cfg = _cfg_for(node, ans.get("system"))
        if cfg is None:
            return self.back(ans, f"시스템 '{ans.get('system')}'을 노드에서 찾을 수 없습니다")
        if value == "manual":
            if (node.get("action_type") in ("system_read", "file_read")
                    and not node.get("outputs")):
                node["io_confirmed"] = PENDING
                return self.back(ans, "조회 결과 출력 필드가 없습니다 — 입출력 편집에서 "
                                       "최소 1개를 추가해야 manual 조회를 확정할 수 있습니다")
            url = None
            copy_automation = False
            if isinstance(detail, dict):    # 폼 – 안내문 + 작업 화면 URL(선택)
                url = str(detail.get("url") or "").strip() or None
                raw_copy_automation = detail.get("copy_automation", False)
                if not isinstance(raw_copy_automation, bool):
                    return self.back(ans, "복사 자동화 값은 boolean이어야 합니다")
                copy_automation = raw_copy_automation
                detail = detail.get("guide")
            if url and not re.match(r"^https?://", url, re.IGNORECASE):
                return self.back(ans, "작업 화면 URL은 http:// 또는 https://로 시작해야 합니다")
            if copy_automation and node.get("action_type") != "system_read":
                return self.back(ans, "복사 자동화는 시스템 조회에서만 사용할 수 있습니다")
            if copy_automation and not url:
                return self.back(ans, "복사 자동화를 사용하려면 작업 화면 URL이 필요합니다")
            guide = detail if detail and detail != "그대로" else q.get("suggestion")
            if not guide:
                return self.back(ans, "manual 안내문이 없습니다 – 안내문을 받아야 합니다")
            cfg["method"] = "manual"
            cfg["manual_guide"] = guide
            if url:
                cfg["manual_url"] = url
                self.notes.append(f"[{node.get('name') or '노드'}] 작업 화면 URL이 설정되었습니다 – "
                                  "실행 때 이 노드에서 브라우저가 자동으로 열립니다"
                                  "(배포 시 받는 사람이 자기 환경의 URL로 바꿔야 합니다)")
            elif self.revision:
                # 재수정 질문지는 기존 URL을 미리 채운다. 사용자가 그 칸을
                # 비웠다면 보존이 아니라 명시적인 제거로 해석한다.
                cfg.pop("manual_url", None)
            if copy_automation:
                cfg["manual_copy_automation"] = True
            else:
                cfg.pop("manual_copy_automation", None)
            cfg.pop("automation_note", None)
            return self.ok(ans, "method=manual + 안내문"
                                + (" + 작업 화면 URL" if url else ""))
        if value == "command":
            if isinstance(detail, dict):
                legacy_command = str(detail.get("command") or "").strip()
                if legacy_command:
                    cfg.pop("manual_copy_automation", None)
                    cfg["method"] = "command"
                    if self.task.get("schema_version") in ("2.1", "2.2"):
                        existing_spec = cfg.get("command_spec")
                        timeout = (
                            existing_spec.get("timeout_seconds", 120)
                            if isinstance(existing_spec, dict) else 120
                        )
                        cfg["command_spec"] = {
                            "legacy_shell_command": legacy_command,
                            "timeout_seconds": timeout,
                        }
                        cfg.pop("command", None)
                    else:
                        cfg["command"] = legacy_command
                        cfg.pop("command_spec", None)
                    cfg.pop("automation_note", None)
                    return self.ok(
                        ans, "method=command + legacy 명령어")
                # 폼 – 2.1은 program+args, 2.0은 legacy 셸 문자열로 반영한다.
                # (배포 표준화: 받은 사람이 bat만 교체하면 된다. 260716)
                path = str(detail.get("path") or "").strip()
                if not path:
                    return self.back(ans, "실행 파일 경로가 비었습니다 – 사실값이라 "
                                          "추정 금지")
                fields = list(dict.fromkeys(
                    i.get("field") for i in node.get("inputs") or []
                    if i.get("field")))
                previous_method = cfg.get("method")
                cfg.pop("manual_copy_automation", None)
                cfg["method"] = "command"
                if self.task.get("schema_version") in ("2.1", "2.2"):
                    existing_spec = cfg.get("command_spec")
                    if (
                        self.revision
                        and previous_method == "command"
                        and isinstance(existing_spec, dict)
                    ):
                        updated_spec = copy.deepcopy(existing_spec)
                        was_legacy_shell = "legacy_shell_command" in updated_spec
                        updated_spec.pop("legacy_shell_command", None)
                        updated_spec["program"] = path
                        if was_legacy_shell:
                            updated_spec["args"] = [
                                "{" + f + "}" for f in fields
                            ]
                        cfg["command_spec"] = updated_spec
                    else:
                        cfg["command_spec"] = {
                            "program": path,
                            "args": ["{" + f + "}" for f in fields],
                            "timeout_seconds": 120,
                        }
                    cfg.pop("command", None)
                    shown = json.dumps(cfg["command_spec"], ensure_ascii=False)
                else:
                    cmd = f'"{path}"' + "".join(f' "{{{f}}}"' for f in fields)
                    cfg["command"] = cmd
                    shown = cmd
                cfg.pop("automation_note", None)
                self.notes.append(
                    f"[{node.get('name') or '노드'}] 실행 명령을 구성했습니다: {shown} – 입력값이 "
                    "순서대로 인자(%1 %2…)로 전달되고, 표준출력이 첫 번째 출력 필드에 "
                    "저장됩니다")
                return self.ok(ans, "method=command + 실행 파일 경로(인자 자동 구성)")
            if not detail or detail == "그대로":
                return self.back(ans, "실행 파일 경로/명령어가 없습니다 – 사실값이라 "
                                      "추정 금지")
            cfg["method"] = "command"
            cfg.pop("manual_copy_automation", None)
            if self.task.get("schema_version") in ("2.1", "2.2"):
                fields = list(dict.fromkeys(
                    i.get("field") for i in node.get("inputs") or [] if i.get("field")))
                cfg["command_spec"] = {"program": str(detail).strip(),
                                       "args": ["{" + f + "}" for f in fields],
                                       "timeout_seconds": 120}
                cfg.pop("command", None)
            else:
                cfg["command"] = detail    # schema 2.0 채팅 폴백
            cfg.pop("automation_note", None)
            return self.ok(ans, "method=command + 명령어")
        if value == "api":
            if isinstance(detail, dict):
                # 폼 – 구조화된 api 상세를 integration으로 결정적 반영
                if self._apply_api(ans, node, cfg, detail):
                    return
                cfg.pop("manual_copy_automation", None)
                cfg["method"] = "api"
                cfg.pop("automation_note", None)
                return self.ok(ans, "method=api + integration 구조화")
            cfg.pop("manual_copy_automation", None)
            cfg["method"] = "api"
            cfg.pop("automation_note", None)
            self.rem(ans, "api_integration",
                     "detail의 api 상세(주소·HTTP method·인증 이름·요청 파라미터·응답 "
                     "추출)를 integration 객체로 구조화해 채워라 – 사실값 추정 금지, "
                     "불명확하면 그 항목만 되물어라", detail=detail,
                     system=ans.get("system"))
            return self.ok(ans, "method=api (integration은 remaining)")
        if value == "mcp":
            if isinstance(detail, dict):
                # 폼 – 서버 이름·지시문을 결정적 반영
                if self._apply_mcp(ans, node, cfg, detail):
                    return
                cfg.pop("manual_copy_automation", None)
                cfg["method"] = "mcp"
                cfg.pop("automation_note", None)
                return self.ok(ans, "method=mcp + 서버·지시문")
            cfg.pop("manual_copy_automation", None)
            cfg["method"] = "mcp"
            cfg.pop("automation_note", None)
            self.rem(ans, "mcp_detail",
                     "detail에서 MCP 서버 이름과 지시문을 mcp_server/mcp_instruction"
                     "으로 구조화해 채워라 – 입력값 자리는 {필드명} 표기. 서버 이름이 "
                     "불명확하면 되물어라(사실값 추정 금지)", detail=detail,
                     system=ans.get("system"))
            return self.ok(ans, "method=mcp (서버·지시문은 remaining)")
        return self.back(ans, f"알 수 없는 실행 방식: {value}")


    # ---------------------------------------------------------- 2패스: 나머지

    def apply_one(self, ans, q, node):
        qt = ans.get("qtype")
        value = ans.get("value")
        detail = ans.get("detail")
        if self.revision and q.get("current_answer") is not None:
            candidate = {"value": value}
            if "detail" in ans:
                candidate["detail"] = detail
            if candidate == q["current_answer"]:
                return self.ok(ans, "현재 설정 유지")

        if qt == "method_choice":
            return self._apply_method_choice(ans, q, node, value, detail)
        if qt == "manual_guide":
            cfg = _cfg_for(node, ans.get("system"))
            if cfg is None:
                return self.back(ans, f"시스템 '{ans.get('system')}'을 노드에서 찾을 수 없습니다")
            guide = value if value and value != "그대로" else q.get("suggestion")
            if not guide:
                return self.back(ans, "안내문이 없습니다")
            cfg["manual_guide"] = guide
            return self.ok(ans, "manual_guide")

        if qt == "decision_prompt":
            draft = q.get("suggestion") or ""
            path, folder = q.get("prompt_path"), q.get("decision_dir")
            if not path or not folder:
                return self.back(ans, "표준 판단 폴더 경로를 계산할 수 없습니다")
            task_hint = os.path.join(self.base_dir or os.getcwd(), "task.json")
            actual_path = workspace.resolve_project_path(path, task_hint)
            actual_folder = workspace.resolve_project_path(folder, task_hint)
            # 판단 폴더는 실제 적용 때 생성한다. preview는 candidate와 staged prompt만
            # 반환해야 하므로 디렉터리조차 만들지 않는다.
            if self.persist_files:
                os.makedirs(actual_folder, exist_ok=True)
            node.pop("prompt", None)
            node["prompt_file"] = path
            node["references"] = [folder]
            node["evidence_required"] = True
            folder_action = "만들었습니다" if self.persist_files else "만들 예정입니다"
            self.notes.append(
                f"[{node.get('name') or '판단'}] 판단 폴더({actual_folder})를 "
                f"{folder_action} – 과거 사례·기준 문서를 넣어두면 실행 때 AI가 "
                "함께 읽고 판단에 반영한다고 안내하세요")
            if value in {"판단 기준 입력", "판단 기준 추가 반영"}:
                if not (detail and str(detail).strip()):
                    return self.back(ans, "'판단 기준 입력'인데 내용이 비었습니다 – "
                                          "판단 기준을 입력해야 합니다")
                content = str(detail)
            else:
                content = draft.rstrip("\n") + "\n"
            existing = _read_text(actual_path)
            if existing is not None and existing != content:
                if not self.revision:
                    self.rem(ans, "prompt_file_conflict",
                             f"표준 경로({actual_path})에 내용이 다른 파일이 이미 있다 – 사용자에게 "
                             "덮어쓸지 확인받은 뒤 처리하라(확인 없이 덮어쓰기 금지)")
            if (
                existing != content
                and (self.revision or existing is None)
            ):
                self.text_writes.append({
                    "path": actual_path,
                    "content": content,
                    "before": existing,
                })
            suffix = " + 사용자 원문 저장" if value in {
                "판단 기준 입력", "판단 기준 추가 반영"
            } else ""
            return self.ok(ans, f"판단 폴더·프롬프트 파일 생성·연결({actual_path}){suffix}")

        if qt == "notify_channel":
            node["channel"] = value
            self.ok(ans, f"channel={value}")
            if value in ("ba_entity", "api"):
                self.rem(ans, "notify_channel_detail",
                         f"채널 {value}의 사실값(ba_entity: entity·base_url·auth / "
                         "api: integration)을 확인해 채워라 – 없으면 되물어라")
            return

        if qt == "file_read_spec":
            if isinstance(value, dict) and value.get("mode") == "path":
                node["path"] = value.get("path")
                node.pop("path_input", None)
                node.pop("directory", None)
                node.pop("file_hint", None)
                node.pop("method", None)
                node.pop("manual_guide", None)
                _set_file_inputs(self.task, node, [])
                return self.ok(ans, "path 지정")
            if isinstance(value, dict) and value.get("mode") == "runtime_path":
                field = str(value.get("path_input") or "").strip()
                if not field:
                    return self.back(ans, "실행 때 받을 파일 경로 입력 이름이 비었습니다")
                node.pop("path", None)
                node.pop("directory", None)
                node.pop("file_hint", None)
                node.pop("method", None)
                node.pop("manual_guide", None)
                node["path_input"] = field
                _set_file_inputs(self.task, node, [field])
                return self.ok(ans, f"실행 시 경로 입력({field}) → 엔진 직접 읽기")
            if isinstance(value, dict) and value.get("mode") == "folder_hint":
                if not value.get("directory") or not value.get("file_hint"):
                    return self.back(ans, "directory/file_hint가 비었습니다")
                node.pop("path", None)
                node.pop("path_input", None)
                node.pop("method", None)
                node.pop("manual_guide", None)
                node["directory"] = value["directory"]
                node["file_hint"] = value["file_hint"]
                return self.ok(ans, "directory+file_hint 지정")
            if value == "manual":
                guide = detail if detail and detail != "그대로" else q.get("suggestion")
                if not guide:
                    return self.back(ans, "manual 안내문이 없습니다")
                node.pop("path", None)
                node.pop("path_input", None)
                node.pop("directory", None)
                node.pop("file_hint", None)
                node["method"] = "manual"
                node["manual_guide"] = guide
                _set_file_inputs(self.task, node, [])
                return self.ok(ans, "file_read manual + 안내문")
            if isinstance(value, str) and value.strip():
                node["path"] = value.strip()    # 채팅식 답 – 경로 문자열로 간주
                node.pop("path_input", None)
                node.pop("directory", None)
                node.pop("file_hint", None)
                node.pop("method", None)
                node.pop("manual_guide", None)
                _set_file_inputs(self.task, node, [])
                return self.ok(ans, "path 지정")
            return self.back(ans, "파일 지정 답을 해석할 수 없습니다")

        if qt == "file_write_path":
            if value == "manual":
                return self.rem(ans, "file_write_manual",
                                "file_write를 manual로 바꾸는 답이다 – 스킬 규칙대로 "
                                "처리하고 안내문을 확인받아라")
            if not isinstance(value, str) or not value.strip():
                return self.back(ans, "출력 경로가 비었습니다")
            node["path"] = value.strip()
            return self.ok(ans, "출력 경로")

        if qt == "file_write_content":
            if not isinstance(value, dict):
                return self.back(ans, "문서 작성 방식 답을 해석할 수 없습니다")
            mode = value.get("mode")
            content = str(value.get("content") or "").strip()
            if not content:
                return self.back(ans, "생성 프롬프트 또는 템플릿 본문이 비었습니다")
            if mode == "generate":
                node["generation_prompt"] = content
                node.pop("template", None)
                return self.ok(ans, "LLM 생성 프롬프트")
            if mode == "template":
                node["template"] = content
                node.pop("generation_prompt", None)
                return self.ok(ans, "템플릿 본문")
            return self.back(ans, "알 수 없는 문서 작성 방식입니다")

        if qt == "io_confirm":
            if value == "그대로":
                if (node.get("action_type") in ("system_read", "file_read")
                        and not node.get("outputs")):
                    node["io_confirmed"] = PENDING
                    return self.back(ans, "조회 결과 출력 필드가 없습니다 — 입출력 편집에서 "
                                           "최소 1개를 추가하세요")
                node["io_confirmed"] = True
                return self.ok(ans, "io_confirmed=true")
            # dict(폼의 구조화 편집)은 1.5패스(apply_io)가 이미 처리했다 – 여기 오면
            # 채팅식 자유 텍스트 수정 요청뿐이다
            return self.rem(ans, "io_edit",
                            "입출력 수정 요청이다 – 필드를 고치고, 그 필드를 참조하는 다른 "
                            "노드의 source도 함께 갱신한 뒤 io_confirmed를 true로 바꿔라. "
                            "'자동 전달' 배선은 사용자가 바꾸자고 한 것만 지워라",
                            detail=str(value))

        if qt == "custom_logic_opt":
            current = node.get("custom_logic")
            expected = (
                detail.get("expected_asset_fingerprint")
                if isinstance(detail, dict) else None)
            current_fingerprint = q.get("asset_fingerprint")
            if expected is not None and expected != current_fingerprint:
                self.stale.append("커스텀 로직 파일이 화면을 연 뒤 변경되었습니다")
                return
            if value == "커스텀 로직 유지":
                if not current:
                    self.stale.append("유지할 커스텀 로직이 더 이상 연결되어 있지 않습니다")
                    return
                return self.ok(ans, "커스텀 로직 유지 (Task·파일 무변경)")
            if value == "사용 안 함":
                if current:
                    try:
                        folder = custom_logic_jobs.removable_folder(
                            self.task_path,
                            self.task,
                            node.get("id"),
                            current,
                        )
                    except (OSError, ValueError, PermissionError) as exc:
                        return self.back(ans, str(exc))
                    self.custom_logic_deletions.append(folder)
                    node.pop("custom_logic", None)
                return self.ok(ans, "커스텀 로직 사용 안 함")
            if value != "커스텀 로직":
                return self.back(ans, "알 수 없는 커스텀 로직 선택입니다")
            description = (
                detail.get("description") if isinstance(detail, dict) else detail)
            if not isinstance(description, str) or not description.strip():
                return self.back(ans, "커스텀 로직 설명이 비었습니다")
            return self.rem(ans, "custom_logic",
                            "커스텀 로직 생성 작업이다 – 질문지 instruction의 커스텀 로직 "
                            "절차(LOGIC.md·run.py 작성 → logic_draft.py mark → custom_logic "
                            "연결 → 타입별 미정 키 삭제)대로 처리하라",
                            detail=description.strip(), logic_dir=q.get("logic_dir"),
                            expected_asset_fingerprint=current_fingerprint)

        # free_text류 – target에 값 그대로 (topic/recipient/message/guide/generation_prompt)
        target = ans.get("target")
        if target and isinstance(value, str) and value.strip():
            node[target] = value.strip()
            return self.ok(ans, target)
        return self.back(ans, "답을 해석할 수 없습니다")

    def _apply_api(self, ans, node, cfg, d):
        """폼의 구조화 api 상세 → integration 결정적 반영. 문제가 있으면 back을
        기록하고 True(중단)를 반환한다 – 사실값을 고치거나 추정하지 않는다."""
        endpoint = str(d.get("endpoint") or "").strip()
        if not endpoint:
            self.back(ans, "api endpoint가 비었습니다 – 사실값이라 추정 금지")
            return True
        exposed_keys = {
            "endpoint", "http_method", "auth", "request", "response_fields",
        }
        previous = cfg.get("integration")
        integ = {}
        if (
            self.revision
            and cfg.get("method") == "api"
            and isinstance(previous, dict)
        ):
            # 질문지가 표현하지 않는 verify_tls 등 확장 설정은 부분 편집으로
            # 지우지 않는다. 화면에 노출된 키만 아래에서 다시 구성한다.
            integ.update({
                key: copy.deepcopy(value)
                for key, value in previous.items()
                if key not in exposed_keys
            })
        integ.update({
            "endpoint": endpoint,
            "http_method": str(d.get("http_method") or "GET").upper(),
        })
        auth = d.get("auth")
        if auth:
            kind = (auth or {}).get("kind")
            name = str((auth or {}).get("name") or "").strip()
            if kind not in ("env", "credman") or not name:
                self.back(ans, "인증 정보가 불완전합니다 – 방식(env/credman)과 참조 이름이 "
                               "함께 있어야 합니다(값 금지)")
                return True
            integ["auth"] = {"kind": kind, "name": name}
        request = d.get("request") or {}
        if request:
            if not (isinstance(request, dict)
                    and all(isinstance(k, str) and isinstance(v, str)
                            for k, v in request.items())):
                self.back(ans, "요청 파라미터 형식을 해석할 수 없습니다")
                return True
            sources = {i.get("source") for i in node.get("inputs") or []} | {"$.key"}
            for v in request.values():
                if v.startswith("$.") and v not in sources:
                    self.back(ans, f"요청 파라미터의 참조 '{v}'가 이 노드의 입력과 일치하지 "
                                   "않습니다 – 낡은 폼일 수 있으니 폼을 재생성하세요")
                    return True
            integ["request"] = request
        out_ids = {o.get("id") for o in node.get("outputs") or []}
        rf = {}
        for k, v in (d.get("response_fields") or {}).items():
            if k not in out_ids:
                self.notes.append(f"[{node.get('name') or '노드'}] 응답 추출의 '{k}'는 선언된 출력 필드가 아니라 "
                                  "제외했습니다")
                continue
            if not str(v).strip().startswith("$.body"):
                self.back(ans, f"응답 추출 경로는 $.body 로 시작해야 합니다: {v}")
                return True
            rf[k] = str(v).strip()
        if rf:
            integ["response_fields"] = rf
        empty_outs = [o.get("name") or o.get("id", "?")
                      for o in node.get("outputs") or [] if o.get("id") not in rf]
        if empty_outs:
            self.notes.append(f"[{node.get('name') or '노드'}] 출력 {', '.join(empty_outs)}의 응답 추출 경로가 "
                              "비어 있습니다 – 실행 전 채워야 값이 채워진다고 안내하세요")
        cfg["integration"] = integ
        return False

    def _apply_mcp(self, ans, node, cfg, d):
        """폼의 구조화 mcp 상세 → mcp_server/mcp_instruction 결정적 반영. 문제가 있으면
        back을 기록하고 True(중단)를 반환한다 – 사실값을 고치거나 추정하지 않는다."""
        server = str(d.get("server") or "").strip()
        if not server:
            self.back(ans, "MCP 서버 이름이 비었습니다 – 사실값이라 추정 금지")
            return True
        instr = str(d.get("instruction") or "").strip()
        if not instr:
            self.back(ans, "MCP 지시문이 비었습니다 – 사실값이라 추정 금지")
            return True
        known = {i.get("field") for i in node.get("inputs") or []}
        clean = util.normalize_named_placeholders(instr, known)
        for ref in util.named_placeholder_refs(clean):
            if ref not in known:
                self.back(ans, f"지시문의 참조 {{{ref}}}가 이 노드의 입력 필드와 일치하지 "
                               "않습니다 – 낡은 폼일 수 있으니 폼을 재생성하세요")
                return True
        cfg["mcp_server"] = server
        cfg["mcp_instruction"] = clean
        self.notes.append(f"[{node.get('name') or '노드'}] 실행 때 AI에 '{server}' MCP 서버가 연결되어 있어야 "
                          "합니다 (배포 시 받는 분 환경에도 같은 이름의 서버가 필요합니다)")
        return False

    # ----------------------------------------------- 1.5패스: 입출력 편집(폼)

    def _normalize_io_inputs(self, ans, ins):
        structured_inputs = all(isinstance(item, dict) for item in ins)
        normalized_inputs = []
        if structured_inputs:
            for item in ins:
                name = str(item.get("field") or "").strip()
                source = str(item.get("source") or "").strip()
                if not name or not source:
                    return self.back(ans, "입력 필드 이름과 출처가 모두 필요합니다")
                ref = item.get("source_ref")
                if ref is not None:
                    if not isinstance(ref, dict):
                        return self.back(ans, "이전 task 출력 참조 형식을 해석할 수 없습니다")
                    if ref.get("kind") not in (None, "previous_task"):
                        return self.back(ans, "지원하지 않는 입력 출처 참조입니다")
                    if not all(str(ref.get(k) or "").strip()
                               for k in ("from_task", "from_node", "from_field")):
                        return self.back(
                            ans, "이전 task 출력에는 task·노드·출력 필드 참조가 모두 필요합니다")
                    ref = {k: str(ref.get(k)).strip()
                           for k in ("from_task", "from_node", "from_field")}
                when = item.get("when")
                if when is not None:
                    if (not isinstance(when, dict)
                            or not str(when.get("if_node") or "").strip()
                            or not str(when.get("value") or "").strip()):
                        return self.back(
                            ans, "조건부 입력에는 분기 노드와 케이스 값이 모두 필요합니다")
                    when = {
                        "if_node": str(when.get("if_node")).strip(),
                        "value": str(when.get("value")).strip(),
                    }
                normalized_inputs.append({
                    "name": name, "source": source,
                    "original": item.get("original_field"), "source_ref": ref,
                    "when": when,
                })
        else:
            names = [str(s).strip() for s in ins if str(s).strip()]
            if len(names) != len(set(names)):
                return self.back(ans, "입력 필드 이름이 중복됩니다")
            normalized_inputs = [
                {"name": name, "source": "__external__",
                 "original": None, "source_ref": None, "when": None}
                for name in names]

        return normalized_inputs

    def _normalize_io_outputs(self, ans, outs, old_out):
        new_out = []
        used_ids = {o.get("id") for o in old_out}
        normalized_outputs = []
        if all(isinstance(item, dict) for item in outs):
            normalized_outputs = [(item.get("id"), str(item.get("name") or "").strip())
                                  for item in outs]
        else:
            normalized_outputs = [(None, str(item).strip()) for item in outs if str(item).strip()]
        names = [name for _, name in normalized_outputs]
        if any(not name for name in names):
            return self.back(ans, "출력 필드 이름이 비었습니다")
        seen_ids = set()
        for output_id, name in normalized_outputs:
            if output_id and output_id in seen_ids:
                return self.back(ans, "출력 필드 id가 중복됩니다")
            hit = next((o for o in old_out if output_id and o.get("id") == output_id), None)
            if output_id and hit is None:
                # 같은 정적 질문지에서 새 출력을 뒤 노드 입력에 즉시 연결하려면 브라우저가
                # 결정적인 output_N id를 미리 부여해야 한다. 임의 id는 여전히 거부한다.
                if not re.match(r"^output_\d+$", str(output_id)) or output_id in used_ids:
                    return self.back(ans, "현재 task에 없는 출력 id입니다 — 낡은 폼일 수 있습니다")
                used_ids.add(output_id)
                new_out.append({"id": output_id, "name": name})
                seen_ids.add(output_id)
                continue
            if hit:
                updated = copy.deepcopy(hit)
                updated["name"] = name
                new_out.append(updated)
                seen_ids.add(output_id)
                continue
            seq = 1
            while f"output_{seq}" in used_ids:
                seq += 1
            used_ids.add(f"output_{seq}")
            new_out.append({"id": f"output_{seq}", "name": name})

        return new_out

    def apply_io(self, ans, node, value):
        """행 편집기의 최종 입출력 배열 적용. 새 입력의 __external__ source는 실행
        시작 시 사용자 입력으로 만든다. __previous_task__는 질문지 payload 안에서만
        쓰는 sentinel이며 기존 inputs_from 계약으로 정규화한다. 기존 문자열 배열과
        source_ref 없는 payload도 계속 호환한다."""
        ins = value.get("inputs")
        outs = value.get("outputs")
        if not isinstance(ins, list) or not isinstance(outs, list):
            return self.back(ans, "입출력 답 형식을 해석할 수 없습니다")
        if node.get("action_type") in ("system_read", "file_read") and not outs:
            node["io_confirmed"] = PENDING
            return self.back(ans, "조회 결과 출력 필드는 최소 1개 필요합니다")
        nid = node.get("id")

        old_in = node.get("inputs") or []
        normalized_inputs = self._normalize_io_inputs(ans, ins)
        if normalized_inputs is None:
            return
        # 출력 배열도 task를 건드리기 전에 전부 검증한다. 입력은 유효한데 출력 id가
        # 낡아 부분 반영되는 일을 막기 위한 트랜잭션 경계다.
        old_out = node.get("outputs") or []
        new_out = self._normalize_io_outputs(ans, outs, old_out)
        if new_out is None:
            return

        roots = copy.deepcopy(self.task.get("inputs_from") or [])

        def dependency_key(root):
            if not isinstance(root, dict):
                return None
            if not all(root.get(k) for k in ("from_task", "from_node", "from_field")):
                return None
            return tuple(str(root[k]) for k in ("from_task", "from_node", "from_field"))

        def named_roots(name):
            return [root for root in roots
                    if isinstance(root, dict) and root.get("name") == name]

        def unique_name(preferred):
            preferred = str(preferred or "입력값").strip() or "입력값"
            existing = {root.get("name") for root in roots if isinstance(root, dict)}
            candidate, seq = preferred, 2
            while candidate in existing:
                candidate = f"{preferred} ({seq})"
                seq += 1
            return candidate

        def external_source(preferred):
            hits = named_roots(preferred)
            plain = [root for root in hits if dependency_key(root) is None]
            if len(hits) == 1 and len(plain) == 1:
                return f"$.inputs_from.{preferred}"
            name = unique_name(preferred)
            roots.append({"name": name})
            return f"$.inputs_from.{name}"

        def dependency_source(ref, preferred, record, original_source=None):
            key = tuple(ref[k] for k in ("from_task", "from_node", "from_field"))
            if original_source and original_source.startswith("$.inputs_from."):
                original_name = original_source[len("$.inputs_from."):]
                matches = named_roots(original_name)
                if len(matches) == 1 and dependency_key(matches[0]) == key:
                    return original_source
            for root in roots:
                if dependency_key(root) == key:
                    return f"$.inputs_from.{root.get('name')}"
            name = unique_name(preferred)
            roots.append({
                "name": name,
                "from_task": record["from_task"],
                "from_node": record["from_node"],
                "from_field": record["from_field"],
                "description": record.get("node_name") or record.get("task_name") or "",
            })
            return f"$.inputs_from.{name}"

        new_in = []
        touched_root_names = {
            spec.get("source", "")[len("$.inputs_from."):]
            for spec in old_in
            if str(spec.get("source") or "").startswith("$.inputs_from.")
        }
        for item in normalized_inputs:
            name, source = item["name"], item["source"]
            original = item["original"]
            ref = item["source_ref"]
            when = item.get("when")
            old_spec = next((spec for spec in old_in
                             if spec.get("field") == (original or name)
                             and spec.get("when") == when), None)
            original_source = old_spec.get("source") if old_spec else None

            if source == "__previous_task__":
                if ref is None:
                    return self.back(ans, "이전 task 출력 선택 정보가 없습니다 — 질문지를 다시 열어 주세요")
                record = task_catalog.find_output_ref(self.previous_catalog, ref)
                if record is None:
                    self.stale.append(
                        f"[{node.get('name') or '노드'}] 선택한 이전 task 출력이 더 이상 "
                        "존재하지 않거나 선행 task가 아닙니다")
                    return
                source = dependency_source(ref, name, record, original_source)
                self.notes.append(
                    f"입력 '{name}'을 이전 task [{record.get('task_name') or ref['from_task']}]의 "
                    f"[{record.get('node_name') or ref['from_node']}] 출력으로 연결했습니다")
            elif source == "__external__":
                if ref is not None:
                    return self.back(ans, "외부 입력에 이전 task 참조가 함께 들어 있습니다")
                source = external_source(name)
                self.notes.append(f"새 입력 '{name}'은 실행 시작 시 사용자에게 받습니다")
            elif source.startswith("$.inputs_from."):
                root_name = source[len("$.inputs_from."):]
                hits = named_roots(root_name)
                if len(hits) > 1:
                    self.stale.append(
                        f"inputs_from 이름 '{root_name}'이 중복되어 낡은 질문지의 출처를 "
                        "안전하게 판별할 수 없습니다")
                    return
                if not hits:
                    if ref is not None:
                        self.stale.append(
                            f"이전 task 입력 '{root_name}' 선언이 없어졌습니다")
                        return
                    # 구형 payload 호환: 명시된 inputs_from source가 task에 없으면
                    # 종전과 같이 일반 외부 입력 선언을 보충한다.
                    roots.append({"name": root_name})
                elif ref is not None:
                    expected = tuple(ref[k] for k in
                                     ("from_task", "from_node", "from_field"))
                    if dependency_key(hits[0]) != expected:
                        self.stale.append(
                            f"이전 task 입력 '{root_name}'의 생산자 연결이 폼 생성 후 바뀌었습니다")
                        return
            elif ref is not None:
                return self.back(ans, "현재 task/건 ID 출처에 이전 task 참조가 함께 들어 있습니다")

            kept = next((spec for spec in old_in
                         if spec.get("field") == (original or name)
                         and spec.get("source") == source), None)
            spec = copy.deepcopy(kept) if kept else {}
            spec.update({"field": name, "source": source})
            if when is None:
                spec.pop("when", None)
            else:
                spec["when"] = when
            new_in.append(spec)

        # field는 표시 이름이라 서로 다른 생산자에서 온 값이면 반복할 수 있다.
        # Runner/Validator와 같은 런타임 키 계약으로 실제 구분 가능성을 확인한다.
        candidate_task = copy.deepcopy(self.task)
        candidate_task["inputs_from"] = roots
        candidate_node = next(
            (candidate for candidate in candidate_task.get("nodes") or []
             if candidate.get("id") == node.get("id")),
            None,
        )
        if candidate_node is None:
            return self.back(ans, "입출력을 적용할 노드를 찾을 수 없습니다")
        candidate_node["inputs"] = copy.deepcopy(new_in)
        unconditional = [spec for spec in new_in if not spec.get("when")]
        runtime_candidate = copy.deepcopy(candidate_node)
        runtime_candidate["inputs"] = unconditional
        runtime_keys = _input_runtime_keys(candidate_task, runtime_candidate)
        usable_keys = [key for key in runtime_keys if key is not None]
        if (len(runtime_keys) != len(unconditional)
                or any(key is None for key in runtime_keys)
                or len(usable_keys) != len(set(usable_keys))):
            return self.back(
                ans,
                "동명 입력을 출처별로 안전하게 구분할 수 없습니다")

        # 입력·출력·root 검증이 모두 끝난 뒤 한 번에 반영한다.
        self.task["inputs_from"] = roots
        node["inputs"] = new_in
        kept_output_ids = {o.get("id") for o in new_out}
        removed_out = [o for o in old_out if o.get("id") not in kept_output_ids]
        node["outputs"] = new_out
        if not old_out and new_out:
            output_names = ", ".join(o.get("name") or o.get("id", "?") for o in new_out)
            configs = [node] + [s for s in node.get("systems", []) or []
                                if isinstance(s, dict)]
            for cfg in configs:
                guide = cfg.get("manual_guide")
                if cfg.get("method") == "manual" and "(없음)" in str(guide or ""):
                    cfg["manual_guide"] = str(guide).replace("(없음)", output_names)
                    self.notes.append(f"[{node.get('name') or '노드'}] 새 출력 필드에 맞춰 "
                                      "기존 자동 수동 안내문의 '(없음)' 표식을 갱신했습니다")

        # 출력 이름은 표시값이라 같은 노드 안에서도 중복될 수 있다. 삭제 참조는
        # 안정적인 ID를 기준으로 처리하고, 과거 이름 참조는 그 이름이 삭제 전
        # 노드에서 유일할 때만 함께 정리한다.
        old_name_counts = {}
        for output in old_out:
            old_name = output.get("name")
            if old_name:
                old_name_counts[old_name] = old_name_counts.get(old_name, 0) + 1
        removed_keys = {
            output.get("id")
            for output in removed_out
            if output.get("id")
        }
        removed_keys.update(
            output.get("name")
            for output in removed_out
            if output.get("name")
            and old_name_counts.get(output.get("name")) == 1
        )
        if removed_keys:
            reconciled = references.reconcile_removed(
                self.task, removed_outputs={nid: removed_keys},
                drop_connected_inputs=self.drop_connected_inputs)
            self.notes.extend(reconciled["notes"])
            self.reference_issues.extend(reconciled["unresolved"])
            rf = (node.get("integration") or {}).get("response_fields")
            if isinstance(rf, dict):
                for k in [k for k in rf if k in removed_keys]:
                    rf.pop(k)
                    self.notes.append(f"삭제된 출력 '{k}'의 응답 추출 항목도 제거했습니다")

        # 더 이상 어떤 입력도 참조하지 않는 일반 외부 입력 선언은 정리한다. 삭제
        # 생산자 경고도 사용자가 입력을 삭제/재연결하면 함께 사라진다.
        used_external = {spec.get("source", "")[len("$.inputs_from."):]
                         for n in self.task.get("nodes") or []
                         for spec in n.get("inputs") or []
                         if str(spec.get("source") or "").startswith("$.inputs_from.")}
        current_roots = self.task.get("inputs_from") or []
        self.task["inputs_from"] = [
            root for root in current_roots
            if (not isinstance(root, dict)
                or root.get("name") in used_external
                or (root.get("from_task") and root.get("name") not in touched_root_names))
        ]
        # 기존 io_confirmed=true task를 복구 편집하는 경우에도 질문 번호가 2패스
        # 재계산 중 사라지지 않도록, 최종 확정 루프 전까지 미정 상태를 유지한다.
        node["io_confirmed"] = PENDING
        self.io_pending.append((ans, node))


@mutation_lock.serialized_path_mutation(path_arg=2, path_kw="task_path")
def apply_io_answers(task, answers, task_path):
    """현재 ``io_confirm`` 질문만 별도 단계에서 규칙에 따라 반영한다.

    상세 질문 payload가 입출력 게이트를 건너뛰지 못하도록 현재 질문 집합과 payload의
    answer/unanswered 항목을 완전히 대조한다. 실제 입출력·source 재배선은 기존
    :meth:`_Apply.apply_io`만 사용한다.
    """
    before = copy.deepcopy(task)
    base_dir = os.path.dirname(task_path) or None

    def restore_before():
        task.clear()
        task.update(copy.deepcopy(before))

    def stale(reason):
        restore_before()
        return {
            "status": "stale",
            "reason": reason,
            "instruction": STALE_INSTRUCTION,
        }

    if not isinstance(answers, dict) or answers.get("type") != "ops_author_io_answers":
        return {
            "status": "error",
            "reason": "입출력 답변의 type이 ops_author_io_answers가 아닙니다",
        }
    if answers.get("task_id") != task.get("task_id"):
        return stale(
            f"답변의 task_id({answers.get('task_id')})가 이 task"
            f"({task.get('task_id')})와 다릅니다")

    current_questions = collect_questions(task, base_dir)
    io_questions = [
        question for question in current_questions
        if question.get("qtype") == "io_confirm"
    ]
    if not io_questions:
        return stale("현재 확인할 입출력 질문이 없습니다 – 이미 적용된 답변일 수 있습니다")
    if answers.get("question_count") != len(io_questions):
        return stale(
            f"답변의 question_count({answers.get('question_count')})가 현재 입출력 "
            f"질문 수({len(io_questions)})와 다릅니다 – 낡은 폼이거나 이미 적용된 "
            "답변입니다(이중 적용 방지)")

    answer_items = answers.get("answers", [])
    unanswered_items = answers.get("unanswered", [])
    if not isinstance(answer_items, list) or not isinstance(unanswered_items, list):
        return stale("입출력 답변의 answers/unanswered 형식을 해석할 수 없습니다")
    if (any(not isinstance(item, dict) for item in answer_items)
            or any(not isinstance(item, dict) for item in unanswered_items)):
        return stale("입출력 답변 항목 형식을 해석할 수 없습니다")

    by_no = {question.get("no"): question for question in io_questions}

    def checked_numbers(items, label):
        numbers = []
        for item in items:
            number = item.get("no")
            question = by_no.get(number)
            if question is None:
                return None, f"{label}에 현재 입출력 질문이 아닌 번호({number})가 있습니다"
            if (item.get("qtype") != "io_confirm"
                    or item.get("node_id") != question.get("node_id")):
                return None, f"{label}의 질문 {number} 식별 정보가 현재 폼과 다릅니다"
            numbers.append(number)
        if len(numbers) != len(set(numbers)):
            return None, f"{label}에 중복된 질문 번호가 있습니다"
        return set(numbers), None

    answered_numbers, problem = checked_numbers(answer_items, "answers")
    if problem:
        return stale(problem)
    unanswered_numbers, problem = checked_numbers(unanswered_items, "unanswered")
    if problem:
        return stale(problem)
    if answered_numbers & unanswered_numbers:
        return stale("같은 입출력 질문이 answers와 unanswered에 함께 들어 있습니다")
    expected_numbers = set(by_no)
    if answered_numbers | unanswered_numbers != expected_numbers:
        return stale("현재 입출력 질문 중 답변 또는 미입력으로 보고되지 않은 항목이 있습니다")

    previous_catalog = task_catalog.build_previous_output_catalog(task, task_path)
    ap = _Apply(task, base_dir, previous_catalog=previous_catalog)
    for item in answer_items:
        question = by_no[item.get("no")]
        node = ap.by_id.get(question.get("node_id"))
        if node is None:
            return stale(f"입출력 질문의 노드({question.get('node_id')})를 찾을 수 없습니다")
        value = item.get("value")
        if not isinstance(value, dict):
            ap.back(item, "입출력 답 형식을 해석할 수 없습니다")
            continue
        ap.apply_io(item, node, value)

    if ap.stale:
        return stale(" / ".join(ap.stale))

    # apply_io는 질문 번호 대조가 끝날 때까지 마커를 유지한다. 여기서 성공한 노드만
    # 확정하므로 unanswered나 형식 오류가 난 노드는 다음 io_gate에 그대로 남는다.
    for item, node in ap.io_pending:
        node["io_confirmed"] = True
        ap.ok(item, "입출력 수정 반영 + io_confirmed=true")

    dangling = references.dangling_references(task)
    if ap.reference_issues or dangling:
        unresolved = ap.reference_issues + dangling
        restore_before()
        return {
            "status": "needs_rewire",
            "reason": "입출력 변경 후 자동으로 재배선할 수 없는 실행 참조가 남았습니다",
            "unresolved": unresolved,
            "written": None,
        }

    util.atomic_write_json(task_path, task)
    vres = _validated(task_path, task)
    remaining_questions = collect_questions(task, base_dir)
    remaining_io = [
        question for question in remaining_questions
        if question.get("qtype") == "io_confirm"
    ]
    remaining_detail = [
        question for question in remaining_questions
        if question.get("qtype") != "io_confirm"
    ]
    summary = {
        "applied": ap.applied,
        "ask_back": ap.ask_back,
        "unanswered": unanswered_items,
        "notes": ap.notes,
        "remaining_io": len(remaining_io),
    }
    history = _write_history(
        task_path, "io-answers", before, copy.deepcopy(task),
        answers, summary, vres)
    if remaining_io:
        next_action = _next_action(task_path, "complete_author_io")
    elif remaining_detail:
        next_action = _next_action(task_path, "open_author_questionnaire")
    else:
        next_action = {
            "type": "validate_task",
            "command": f'python ops_runtime/validate.py "{task_path}" --rehearsal',
        }
    return {
        "status": "ok",
        "written": task_path,
        "applied": ap.applied,
        "remaining": [],
        "ask_back": ap.ask_back,
        "unanswered": unanswered_items,
        "notes": ap.notes,
        "remaining_io": len(remaining_io),
        "validate": vres,
        "history": history,
        "next_action": next_action,
        "instruction": IO_RESULT_INSTRUCTION,
    }


def _apply_answers_impl(task, answers, task_path, revision=False,
                        persist=True, allow_partial_revision=False,
                        detail_editor=False):
    before = copy.deepcopy(task)
    base_dir = os.path.dirname(task_path) or None

    def restore_before():
        """파일을 쓰지 않는 실패는 호출자가 넘긴 메모리 객체도 원상 복구한다."""
        task.clear()
        task.update(copy.deepcopy(before))

    if answers.get("type") != "ops_author_answers":
        return {"status": "error",
                "reason": "답변 JSON의 type이 ops_author_answers가 아닙니다 – 폼의 결과 "
                          "JSON을 그대로 저장했는지 확인하세요"}
    if answers.get("task_id") != task.get("task_id"):
        return {"status": "stale",
                "reason": f"답변의 task_id({answers.get('task_id')})가 이 task"
                          f"({task.get('task_id')})와 다릅니다",
                "instruction": STALE_INSTRUCTION}
    collect = (
        collect_detail_questions if detail_editor else
        collect_revision_questions if revision else collect_questions
    )
    qs = {q["no"]: q for q in collect(task, base_dir)}
    # 업그레이드 전에 열린 revise 화면에는 커스텀 로직 고급 옵션이 없었다.
    # 그 payload는 기존 revision 질문 계약과 정확히 일치할 때만 계속 받는다.
    if (
        revision and detail_editor
        and answers.get("question_count") != len(qs)
        and not any(
            isinstance(item, dict) and item.get("qtype") == "custom_logic_opt"
            for item in (answers.get("answers") or [])
        )
    ):
        legacy_questions = collect_revision_questions(task, base_dir)
        if answers.get("question_count") == len(legacy_questions):
            collect = collect_revision_questions
            qs = {q["no"]: q for q in legacy_questions}
    if answers.get("question_count") != len(qs):
        return {"status": "stale",
                "reason": f"답변의 question_count({answers.get('question_count')})가 현재 "
                          f"질문 수({len(qs)})와 다릅니다 – 낡은 폼이거나 이미 적용된 "
                          "답변입니다(이중 적용 방지)",
                "instruction": STALE_INSTRUCTION}

    raw_items = answers.get("answers")
    if not isinstance(raw_items, list):
        return {
            "status": "invalid",
            "reason_code": "invalid_author_answers",
            "reason": "answers는 질문 답변 배열이어야 합니다",
            "written": None,
        }
    items = [item for item in raw_items if isinstance(item, dict)]
    exclusive_nodes = {
        item.get("node_id")
        for item in items
        if item.get("qtype") == "custom_logic_opt"
        and item.get("value") in ("커스텀 로직", "커스텀 로직 유지")
    }
    required_numbers = {
        number for number, question in qs.items()
        if not (
            question.get("node_id") in exclusive_nodes
            and question.get("qtype") != "custom_logic_opt"
        )
    }
    seen_numbers = set()
    for answer in items:
        number = answer.get("no")
        question = qs.get(number)
        if number in seen_numbers:
            return {
                "status": "stale",
                "reason_code": "duplicate_author_answer",
                "reason": f"같은 질문 번호가 중복 제출되었습니다: {number}",
                "instruction": STALE_INSTRUCTION,
            }
        seen_numbers.add(number)
        identity_keys = ("node_id", "qtype", "target", "system")
        if (
            question is None
            or any(
                answer.get(key) != question.get(key)
                for key in identity_keys
            )
        ):
            return {
                "status": "stale",
                "reason_code": "stale_author_question",
                "reason": "질문 종류나 적용 대상이 현재 질문지와 다릅니다",
                "instruction": STALE_INSTRUCTION,
            }
        expected_revision = question.get("current_revision")
        if (
            number in required_numbers
            and
            expected_revision is not None
            and answer.get("current_revision") != expected_revision
        ):
            return {
                "status": "stale",
                "reason_code": "stale_prompt_file",
                "reason": "판단 프롬프트 파일이 질문지를 연 뒤 변경되었습니다",
                "instruction": STALE_INSTRUCTION,
            }
    # 커스텀 로직은 같은 노드의 표준 실행 설정과 배타적이다. 브라우저의 disabled
    # 컨트롤은 값이 남아 payload에 포함될 수 있으므로, 대조는 하되 필수 답변 계산과
    # 실제 적용에서는 제외한다. 그렇지 않으면 비활성 답변이 Task에 반영되거나
    # revision의 정확 집합 비교가 실패한다.
    active_items = [
        item for item in items if item.get("no") in required_numbers
    ]
    active_numbers = {item.get("no") for item in active_items}
    raw_unanswered = answers.get("unanswered")
    unanswered_items = (
        [
            item for item in raw_unanswered
            if not isinstance(item, dict)
            or item.get("no") in required_numbers
        ]
        if isinstance(raw_unanswered, list) else raw_unanswered
    )
    if (
        revision
        and not allow_partial_revision
        and unanswered_items
    ):
        return {
            "status": "invalid",
            "reason_code": "revision_answers_incomplete",
            "reason": "재수정 질문지에 입력하지 않은 항목이 있습니다",
            "unanswered": unanswered_items,
            "written": None,
        }
    if (
        revision
        and not allow_partial_revision
        and active_numbers != required_numbers
    ):
        return {
            "status": "invalid",
            "reason_code": "revision_answers_incomplete",
            "reason": "재수정 질문지의 모든 항목을 제출해야 합니다",
            "written": None,
        }

    previous_catalog = task_catalog.build_previous_output_catalog(task, task_path)
    ap = _Apply(
        task, base_dir, previous_catalog=previous_catalog,
        revision=revision, persist_files=persist, task_path=task_path)

    def _match(ans, table):
        q = table.get(ans.get("no"))
        if (
            not q
            or any(
                ans.get(key) != q.get(key)
                for key in ("node_id", "qtype", "target", "system")
            )
        ):
            ap.stale.append("질문 대조 실패 – 낡은 답변 항목일 수 있습니다")
            return None, None
        node = ap.by_id.get(ans.get("node_id"))
        if node is None:
            ap.back(ans, "노드를 찾을 수 없습니다")
            return None, None
        return q, node

    # 1패스: 라벨 – 2패스의 프롬프트 초안이 갱신된 라벨을 담게 먼저 반영한다
    for ans in active_items:
        if ans.get("qtype") in ("labels_fixed", "labels_input"):
            q, node = _match(ans, qs)
            if node is not None:
                ap.apply_labels(ans, node)
    if ap.stale:
        restore_before()
        return {"status": "stale", "reason": " / ".join(ap.stale),
                "instruction": STALE_INSTRUCTION}
    # 1.5패스: 입출력 편집(폼 dict) – 뒤 질문(api 응답 추출·판단 초안)이 최종
    # 입출력을 봐야 한다. io_confirmed 확정은 마지막에(질문 번호 대조 유지).
    io_dict_ids = set()
    for ans in active_items:
        if ans.get("qtype") == "io_confirm" and isinstance(ans.get("value"), dict):
            q, node = _match(ans, qs)
            if node is not None:
                ap.apply_io(ans, node, ans["value"])
            io_dict_ids.add(id(ans))
    if ap.stale:
        restore_before()
        return {"status": "stale", "reason": " / ".join(ap.stale),
                "instruction": STALE_INSTRUCTION}
    # 라벨·입출력 반영 후 질문 객체 재계산 – 초안(suggestion)·입출력 표시가 갱신된다
    # (둘 다 질문 수·순서를 바꾸지 않는다 – io_confirmed는 아직 마커 상태)
    qs2 = {q["no"]: q for q in collect(task, base_dir)}
    # 최종 라벨·입출력을 반영해 다시 계산한 초안을 기준으로 파일 충돌을 먼저
    # 검사한다. 이 시점까지는 메모리만 바뀌었으므로 충돌 시 전체 롤백할 수 있다.
    prompt_conflicts = []
    for ans in active_items:
        if ans.get("qtype") != "decision_prompt":
            continue
        q = qs2.get(ans.get("no"))
        if (
            not q
            or q.get("node_id") != ans.get("node_id")
            or not q.get("prompt_path")
        ):
            continue
        value = ans.get("value")
        detail = ans.get("detail")
        if value in {"판단 기준 입력", "판단 기준 추가 반영"}:
            if not (detail and str(detail).strip()):
                continue
            content = str(detail)
        else:
            content = (q.get("suggestion") or "").rstrip("\n") + "\n"
        task_hint = os.path.join(base_dir or os.getcwd(), "task.json")
        actual_path = workspace.resolve_project_path(
            q["prompt_path"], task_hint)
        existing = _read_text(actual_path)
        current_answer = q.get("current_answer")
        candidate = {"value": value}
        if "detail" in ans:
            candidate["detail"] = detail
        unchanged_revision = (
            revision and current_answer is not None
            and candidate == current_answer
        )
        if existing is not None and existing != content and not revision:
            prompt_conflicts.append({
                "no": ans.get("no"),
                "node_id": ans.get("node_id"),
                "qtype": "decision_prompt",
                "action": "prompt_file_conflict",
                "path": actual_path,
                "todo": (
                    f"표준 경로({actual_path})에 내용이 다른 파일이 이미 있습니다. "
                    "덮어쓸지 확인하기 전에는 변경하지 않습니다."
                ),
            })
        elif unchanged_revision:
            continue
    if prompt_conflicts:
        restore_before()
        return {
            "status": "conflict",
            "reason_code": "prompt_file_conflict",
            "reason": prompt_conflicts[0]["todo"],
            "conflicts": prompt_conflicts,
            "written": None,
        }

    for ans in active_items:
        if ans.get("qtype") in ("labels_fixed", "labels_input"):
            continue
        if id(ans) in io_dict_ids:
            continue
        q, node = _match(ans, qs2)
        if node is not None:
            ap.apply_one(ans, q, node)
    # 입출력 편집이 끝난 노드의 io_confirmed 확정 – 여기서 바꿔야 위 대조가 안 어긋난다
    for ans, node in ap.io_pending:
        node["io_confirmed"] = True
        ap.ok(ans, "입출력 수정 반영 + io_confirmed=true")

    if ap.stale:
        restore_before()
        return {
            "status": "stale",
            "reason_code": "stale_author_question",
            "reason": " / ".join(ap.stale),
            "instruction": STALE_INSTRUCTION,
        }
    rejected_remaining = [
        item for item in ap.remaining
        if item.get("action") != "custom_logic"
    ]
    if revision and (rejected_remaining or ap.ask_back):
        restore_before()
        first = (ap.ask_back or rejected_remaining)[0]
        return {
            "status": "invalid",
            "reason_code": "revision_answer_rejected",
            "reason": first.get("reason") or first.get("todo")
                      or "재수정 답변을 적용할 수 없습니다",
            "remaining": ap.remaining,
            "ask_back": ap.ask_back,
            "written": None,
        }

    dangling = references.dangling_references(task)
    if ap.reference_issues or dangling:
        unresolved = ap.reference_issues + dangling
        restore_before()
        return {
            "status": "needs_rewire",
            "reason": "입출력 변경 후 자동으로 재배선할 수 없는 실행 참조가 남았습니다",
            "unresolved": unresolved,
            "written": None,
        }

    if ap.custom_logic_deletions:
        checked = validate.validate(task, task_path)
        if not checked.get("ok"):
            restore_before()
            return {
                "status": "invalid",
                "reason_code": "standard_execution_required",
                "reason": (
                    "커스텀 로직을 사용 안 함으로 바꾸려면 같은 화면에서 "
                    "표준 실행 설정을 모두 입력해야 합니다"
                ),
                "errors": checked.get("errors") or [],
                "written": None,
            }

    staged_by_path = {}
    for staged in ap.text_writes:
        previous = staged_by_path.get(staged["path"])
        if previous and previous["content"] != staged["content"]:
            restore_before()
            return {
                "status": "conflict",
                "reason_code": "prompt_file_conflict",
                "reason": "서로 다른 판단 노드가 같은 프롬프트 파일에 다른 내용을 저장하려 합니다",
                "written": None,
            }
        staged_by_path[staged["path"]] = staged
    for staged in staged_by_path.values():
        if _read_text(staged["path"]) != staged["before"]:
            restore_before()
            return {
                "status": "conflict",
                "reason_code": "stale_prompt_file",
                "reason": (
                    f"판단 프롬프트 파일({staged['path']})이 "
                    "질문지를 연 뒤 변경되었습니다"
                ),
                "written": None,
            }

    has_persistent_changes = bool(
        task != before or staged_by_path or ap.custom_logic_deletions)
    if persist and has_persistent_changes:
        written_text = []
        moved_logic = []
        try:
            for folder in ap.custom_logic_deletions:
                if not os.path.isdir(folder):
                    continue
                tombstone = folder.rstrip("\\/") + ".delete-" + hashlib.sha256(
                    (task_path + folder + str(time.time_ns())).encode("utf-8")
                ).hexdigest()[:12]
                os.replace(folder, tombstone)
                moved_logic.append((folder, tombstone))
            for staged in staged_by_path.values():
                _write_text(staged["path"], staged["content"])
                written_text.append(staged)
            util.atomic_write_json(task_path, task)
            for _folder, tombstone in moved_logic:
                shutil.rmtree(tombstone)
        except Exception:
            try:
                util.atomic_write_json(task_path, before)
            except OSError:
                pass
            for folder, tombstone in reversed(moved_logic):
                try:
                    if os.path.isdir(tombstone) and not os.path.exists(folder):
                        os.replace(tombstone, folder)
                except OSError:
                    pass
            for staged in reversed(written_text):
                try:
                    if staged["before"] is None:
                        if os.path.isfile(staged["path"]):
                            os.remove(staged["path"])
                    else:
                        _write_text(staged["path"], staged["before"])
                except OSError:
                    pass
            restore_before()
            raise
    vres = _validated(task_path, task)
    summary = {"applied": ap.applied, "remaining": ap.remaining,
               "ask_back": ap.ask_back, "notes": ap.notes}
    history = (
        _write_history(
            task_path, "revision-answers" if revision else "answers",
            before, copy.deepcopy(task), answers, summary, vres)
        if persist and has_persistent_changes else None
    )
    if ap.remaining or ap.ask_back or unanswered_items:
        next_action = _next_action(task_path, "complete_author_questions")
    else:
        next_action = {"type": "validate_task",
                       "command": f'python ops_runtime/validate.py "{task_path}" --rehearsal'}
    result = {
        "status": "ok",
        "written": task_path if persist else None,
        "applied": ap.applied,
        "remaining": ap.remaining,
        "ask_back": ap.ask_back,
        "unanswered": unanswered_items or [],
        "notes": ap.notes,
        "validate": vres,
        "history": history,
        "next_action": next_action,
        "instruction": RESULT_INSTRUCTION,
    }
    if not persist:
        result["_staged_prompt_writes"] = [
            {"path": staged["path"], "content": staged["content"]}
            for staged in staged_by_path.values()
        ]
    return result


@mutation_lock.serialized_path_mutation(path_arg=2, path_kw="task_path")
def apply_answers(task, answers, task_path, revision=False,
                  detail_editor=False):
    """질문 답변을 저장된 task와 prompt에 적용하고 변경 이력을 기록한다."""
    return _apply_answers_impl(
        task, answers, task_path, revision=revision, persist=True,
        detail_editor=detail_editor)


def preview_answers(task, answers, task_path, revision=False):
    """질문 답변의 적용 결과를 파일 쓰기 없이 미리 계산한다.

    전달받은 task와 정본 task JSON, 판단 prompt, history는 전혀 변경하지 않는다.
    재수정 질문지는 현재 입력된 일부 답변만으로도 candidate를 만들 수 있지만,
    question_count와 개별 답변 식별·revision 검사는 실제 적용과 동일하게 유지한다.
    """
    candidate = copy.deepcopy(task)
    result = _apply_answers_impl(
        candidate,
        answers,
        task_path,
        revision=revision,
        persist=False,
        allow_partial_revision=True,
    )
    result["candidate_task"] = candidate
    result["staged_prompts"] = {
        staged["path"]: staged["content"]
        for staged in (
            # 성공 결과의 내부 적용 세션은 반환하지 않으므로 candidate의 prompt
            # 변경분은 impl이 아래 비공개 키에 담아 전달한다.
            result.pop("_staged_prompt_writes", [])
        )
    }
    result["written"] = None
    result["history"] = None
    return result


# ------------------------------------------------------------- 구조 편집 적용

STRUCTURE_RESULT_INSTRUCTION = (
    "AI 에이전트: 구성 변경이 task JSON에 반영·저장되었다(같은 변경을 Edit로 다시 적용하지 "
    "마라). structure_confirmed는 false로 유지된다 – author_questions를 다시 실행해 "
    "도구가 렌더링한 새 【노드 구성 확인】으로 사용자 확인을 받아라. notes는 사용자 "
    "안내 문구다(요약해 전달). remaining이 있으면 그 항목만 수정 모드 규칙대로 처리하라.")


def _structure_validation_summary(result):
    """구조 편집 직후 예상되는 미정/재확인 오류를 실제 차단 오류와 분리한다."""
    expected, blocking = [], []
    for error in result.get("errors") or []:
        if ("노드 구성 확인이 끝나지 않았습니다" in error
                or "'__미정__' 마커가 남아 있습니다" in error):
            expected.append(error)
        else:
            blocking.append(error)
    return {
        "ok": not blocking,
        "state": "pending_authoring" if expected and not blocking else
                 ("blocked" if blocking else "ready"),
        "expected_pending_count": len(expected),
        "blocking_errors": blocking,
        "warnings": result.get("warnings") or [],
        "task_path": result.get("task_path"),
        "task_fingerprint": result.get("task_fingerprint"),
    }


def new_node_skeleton(action_type, node_id, name, schema_version="2.0"):
    """새 노드의 기본 구조를 만들고 확인이 필요한 값은 미정으로 남긴다.

    미정 값은 구성을 확정한 뒤 질문지에서 입력받는다.
    """
    node = {"id": node_id, "name": name, "action_type": action_type,
            "description": "", "custom_logic": None,
            "inputs": [], "outputs": [], "io_confirmed": PENDING}
    extra = {
        "system_read": {"method": PENDING},
        "system_write": {"method": PENDING},
        "decision": {"prompt": PENDING},
        "consult": {"topic": PENDING},
        "notify_send": {"channel": PENDING, "recipient": PENDING, "message": PENDING},
        "notify_receive": {"guide": PENDING},
        "file_read": {"path": PENDING},
        "file_write": {"path": PENDING, "generation_prompt": PENDING},
    }.get(action_type)
    if extra is None:
        return None
    node.update(extra)
    if schema_version in ("2.1", "2.2") and action_type in ("system_write", "notify_send"):
        node["approval_required"] = True
    return node


def _route_signature(task):
    """제어 경로 설정만 비교한다 — 표시명·입출력 변경은 승격 사유가 아니다."""
    order = []
    routes = []
    for node in task.get("nodes") or []:
        if not isinstance(node, dict) or not node.get("id"):
            continue
        node_id = node["id"]
        order.append(node_id)
        if node.get("type") == "if":
            routes.append((
                "if", node_id,
                tuple(case.get("next") for case in node.get("cases") or []
                      if isinstance(case, dict)),
            ))
        else:
            routes.append((
                "node", node_id, "next" in node, node.get("next"),
            ))
    return tuple(order), tuple(routes)


def _case_paths_to_consumer(task, if_node, consumer_id, successors=None):
    """실제 cursor 경로로 consumer에 도달하는 If case를 반환한다."""
    successors = successors or validate._control_successors(task)
    cases = [case for case in if_node.get("cases") or []
             if isinstance(case, dict) and case.get("next")]
    result = []
    for case in cases:
        start = case.get("next")
        # 같은 If로 되돌아오면 새 판단 회차다. 최초 case의 활성 경로가
        # sibling case를 타고 계속된 것으로 계산하지 않는다.
        blocked = {if_node.get("id")}
        if validate._reachable_without_other_cases(
                successors, start, consumer_id, blocked):
            result.append((case, blocked))
    return result


def _producer_case_values(task, if_node, consumer_id, producer_id,
                          successors=None):
    """producer가 consumer까지 이어지는 case 값을 결정적으로 찾는다."""
    successors = successors or validate._control_successors(task)
    result = []
    for case, blocked in _case_paths_to_consumer(
            task, if_node, consumer_id, successors):
        start = case.get("next")
        if validate._producer_precedes_consumer(
                successors, start, producer_id, consumer_id, blocked):
            result.append(case.get("value"))
    return result


def _upgrade_legacy_join_inputs(task):
    """legacy 고정 합류 입력을 안전하게 schema 2.2 when 입력으로 바꾼다.

    기존에 선택된 source가 실행되는 case 하나를 when 기준점으로 표시한다.
    여러 case에서 같은 source를 사용해도 입력을 복제하지 않으며, 다른 case의
    출처를 추측하거나 자동으로 추가하지 않는다.
    """
    successors = validate._control_successors(task)
    nodes = [node for node in task.get("nodes") or []
             if isinstance(node, dict)]
    by_id = {node.get("id"): node for node in nodes if node.get("id")}
    if_nodes = [node for node in nodes if node.get("type") == "if"]
    entry_id = next((node.get("id") for node in nodes if node.get("id")), None)

    replacements_by_consumer = []
    for consumer in nodes:
        if consumer.get("type") == "if" or not consumer.get("id"):
            continue
        replacements = []
        for index, spec in enumerate(consumer.get("inputs") or []):
            if not isinstance(spec, dict) or spec.get("when"):
                continue
            field = str(spec.get("field") or "").strip()
            source = references.resolve_output_source(task, spec.get("source"), by_id)
            if (not field or not source
                    or source.get("kind") not in ("canonical", "legacy_name")):
                continue
            relevant = []
            for if_node in if_nodes:
                if (entry_id and not validate._producer_precedes_consumer(
                        successors, entry_id, if_node.get("id"),
                        consumer["id"])):
                    continue
                paths = _case_paths_to_consumer(
                    task, if_node, consumer["id"], successors)
                if len(paths) < 2:
                    continue
                values = _producer_case_values(
                    task, if_node, consumer["id"], source.get("node_id"),
                    successors)
                if 0 < len(values) < len(paths):
                    relevant.append((if_node, values))
            if not relevant:
                # 호환 task의 저장된 제어 흐름만으로 source의 case를 결정할 수
                # 없으면 거짓 when을 만들지 않고 기존 일반 연결을 보존한다.
                # task_path를 아는 최종 Validator가 effective route로 검사한다.
                continue
            if len(relevant) != 1:
                # 둘 이상의 분기가 후보면 어느 when인지 추측하지 않는다.
                # 기존 일반 연결은 그대로 두고 effective task 검증에 맡긴다.
                continue
            if_node, values = relevant[0]
            conditioned_spec = copy.deepcopy(spec)
            conditioned_spec["when"] = {
                "if_node": if_node.get("id"), "value": values[0],
            }
            replacements.append((index, [conditioned_spec]))

        if replacements:
            replacements_by_consumer.append((consumer, replacements))
    for consumer, replacements in replacements_by_consumer:
        insertions = {index: items for index, items in replacements}
        consumer["inputs"] = [
            item
            for index, spec in enumerate(consumer.get("inputs") or [])
            for item in (insertions.get(index) or [spec])
        ]
    return []


def _upgrade_legacy_command_configs(task):
    """schema 2.0 shell command를 2.2 호환 command_spec으로 보존한다."""
    changed = 0
    for node in task.get("nodes") or []:
        if not isinstance(node, dict) or node.get("type") == "if":
            continue
        configs = [node]
        configs.extend(
            item for item in node.get("systems") or []
            if isinstance(item, dict)
        )
        for config in configs:
            if (config.get("method") != "command"
                    or isinstance(config.get("command_spec"), dict)):
                continue
            command = str(config.get("command") or "").strip()
            if not command:
                continue
            config["command_spec"] = {
                "legacy_shell_command": command,
                "timeout_seconds": 120,
            }
            config.pop("command", None)
            changed += 1
    return changed


def _schema_22_migration_contract_errors(task):
    """승격 과정에서 새 schema가 요구하는 command/승인 계약만 확인한다."""
    errors = []
    for node in task.get("nodes") or []:
        if not isinstance(node, dict) or node.get("type") == "if":
            continue
        configs = [node]
        configs.extend(
            item for item in node.get("systems") or []
            if isinstance(item, dict)
        )
        for config in configs:
            if (config.get("method") == "command"
                    and not isinstance(config.get("command_spec"), dict)):
                errors.append({
                    "node": node.get("id"),
                    "reason": "command_spec_required",
                })
        if (validate._automatic_write(node)
                and node.get("approval_required") is False
                and not str(node.get("approval_bypass_reason") or "").strip()):
            errors.append({
                "node": node.get("id"),
                "reason": "approval_bypass_reason_required",
            })
    return errors


def _apply_structure(task, edit, task_path, *, confirm, design=False,
                     before_write=None):
    before = copy.deepcopy(task)
    allowed_direct_self_loops = _legacy_direct_self_loops(before)
    expected_type = (
        "ops_design_commit" if design else
        "ops_structure_commit" if confirm else
        "ops_structure_edit"
    )
    if edit.get("type") != expected_type:
        return {"status": "error",
                "reason": f"편집 JSON의 type이 {expected_type}가 아닙니다 – 편집기의 "
                          "결과 JSON을 그대로 제출했는지 확인하세요"}
    if edit.get("task_id") != task.get("task_id"):
        return {"status": "stale",
                "reason": f"편집의 task_id({edit.get('task_id')})가 이 task"
                          f"({task.get('task_id')})와 다릅니다",
                "instruction": STALE_INSTRUCTION}
    if edit.get("task_fingerprint") != _task_fingerprint(task_path):
        return {"status": "stale",
                "reason": "task 파일이 편집기 생성 이후 변경되었습니다(지문 불일치) – "
                          "낡은 편집기의 결과입니다",
                "instruction": STALE_INSTRUCTION}

    old_by_id = {n.get("id"): n for n in task.get("nodes", [])}
    old_ifs = {n.get("source_node"): n for n in task.get("nodes", [])
               if n.get("type") == "if"}
    notes, remaining, summary = [], [], {"added": [], "renamed": [], "deleted": [],
                                         "type_changed": [], "branch_changed": []}
    if design:
        summary["io_updated"] = []
    new_nodes, seen = [], set()
    deferred_old_ifs = []
    items = edit.get("nodes")
    if (not isinstance(items, list)
            or any(not isinstance(item, dict) for item in items)):
        return {
            "status": "error",
            "reason": "편집 결과의 nodes는 노드 객체 배열이어야 합니다",
        }
    ids = [x.get("id") for x in items]
    if len(ids) != len(set(ids)):
        return {"status": "error", "reason": "편집 결과에 중복된 노드 id가 있습니다"}

    for item in items:
        nid = item.get("id")
        name = (item.get("name") or "").strip()
        if not name:
            return {"status": "error", "reason": f"노드 '{nid}'의 이름이 비었습니다"}
        if item.get("new"):
            node = new_node_skeleton(item.get("action_type"), nid, name,
                                     task.get("schema_version", "2.0"))
            if node is None:
                return {"status": "error",
                        "reason": f"알 수 없는 action_type: {item.get('action_type')}"}
            summary["added"].append(f"{name}({item.get('action_type')})")
        else:
            node = old_by_id.get(nid)
            if node is None or node.get("type") == "if":
                return {"status": "stale",
                        "reason": f"편집 결과의 노드 '{nid}'가 현재 task에 없습니다 – "
                                  "낡은 편집기의 결과입니다",
                        "instruction": STALE_INSTRUCTION}
            new_at = item.get("action_type")
            old_at = node.get("action_type")
            if new_at and new_at != old_at:
                # 타입 변경 – 공통 필드만 화이트리스트 복사하고 타입별 필드는 새
                # 스켈레톤으로 교체한다(구 타입 필드가 남으면 검증기가 걸린다)
                rebuilt = new_node_skeleton(new_at, nid, name,
                                            task.get("schema_version", "2.0"))
                if rebuilt is None:
                    return {"status": "error",
                            "reason": f"알 수 없는 action_type: {new_at}"}
                for k in ("description", "inputs", "outputs", "custom_logic"):
                    rebuilt[k] = node.get(k, rebuilt[k])
                if "next" in node:
                    rebuilt["next"] = node["next"]
                old_ko = ACTION_TYPE_KO.get(old_at, old_at)
                new_ko = ACTION_TYPE_KO.get(new_at, new_at)
                summary["type_changed"].append(f"{name}: {old_ko} → {new_ko}")
                note = (f"[{name}] 타입이 {old_ko} → {new_ko}로 바뀌어 실행 세부"
                        "(방식·경로 등)를 초기화했습니다 – 구성 확정 후 질문지에서 "
                        "다시 채웁니다(입출력은 유지)")
                if old_at == "decision" and old_ifs.get(nid) is not None:
                    note += ". 후속 분기(If)도 함께 제거되었습니다"
                if node.get("prompt_file"):
                    note += (f". 판단 프롬프트 파일({node['prompt_file']})은 "
                             "디스크에 남아 있습니다")
                if node.get("custom_logic"):
                    note += (". 연결된 커스텀 로직은 이전 타입 기준으로 작성된 "
                             "것이라 검토가 필요합니다")
                notes.append(note)
                node = rebuilt
            elif (node.get("name") or "") != name:
                summary["renamed"].append(f"{node.get('name')} → {name}")
            node["name"] = name
        if "next_present" in item:
            if not isinstance(item.get("next_present"), bool):
                return {"status": "error",
                        "reason": f"노드 '{name}'의 다음 단계 상태를 해석할 수 없습니다"}
            if item.get("next_present"):
                next_value = item.get("next")
                if (next_value is not None
                        and (not isinstance(next_value, str)
                             or not next_value.strip())):
                    return {"status": "error",
                            "reason": f"노드 '{name}'의 next는 null 또는 노드 ID "
                                      "문자열이어야 합니다"}
                node["next"] = next_value
            else:
                node.pop("next", None)
        seen.add(nid)
        new_nodes.append(node)

        if node.get("action_type") == "decision":
            branches = item.get("branches") or []
            if (not isinstance(branches, list)
                    or any(not isinstance(branch, dict) for branch in branches)):
                return {
                    "status": "error",
                    "reason": f"판단 '{name}'의 분기 형식이 올바르지 않습니다",
                }
            old_if = old_ifs.get(nid)
            old_cases = [(c.get("value"), c.get("next"))
                         for c in (old_if or {}).get("cases", [])]
            if branches:
                # 분기 판단은 바로 뒤의 If가 유일한 후속이다. 숨겨진 일반 next가
                # 남으면 Runner가 If를 건너뛰므로 조작된 UI payload에서도 제거한다.
                node.pop("next", None)
                labels = [b.get("label") for b in branches]
                if len(labels) != len(set(labels)):
                    return {"status": "error",
                            "reason": f"판단 '{name}'의 분기 라벨이 중복됩니다"}
                node["labels"] = labels
                ifn = old_if or {"id": f"if_{nid}", "type": "if", "source_node": nid}
                if old_if:
                    old_case_list = old_if.get("cases") or []
                    label_rewrites = {}
                    for branch in branches:
                        original_index = branch.get("orig_index")
                        if (isinstance(original_index, int)
                                and 0 <= original_index < len(old_case_list)):
                            old_value = old_case_list[original_index].get("value")
                            new_value = branch.get("label")
                            if old_value != new_value:
                                label_rewrites[old_value] = new_value
                    if label_rewrites:
                        for existing in task.get("nodes") or []:
                            for spec in existing.get("inputs") or []:
                                when = spec.get("when") if isinstance(spec, dict) else None
                                if (isinstance(when, dict)
                                        and when.get("if_node") == old_if.get("id")
                                        and when.get("value") in label_rewrites):
                                    when["value"] = label_rewrites[when["value"]]
                ifn["cases"] = [{"value": b.get("label"), "next": b.get("next") or None}
                                for b in branches]
                if old_if is not None:
                    deferred_old_ifs.append((nid, ifn))
                else:
                    new_nodes.append(ifn)
                if old_cases != [(b.get("label"), b.get("next") or None) for b in branches]:
                    summary["branch_changed"].append(name)
            else:
                had = bool(node.pop("labels", None)) or old_if is not None
                if had:
                    summary["branch_changed"].append(f"{name}(산출형 전환)")
                    notes.append(f"[{name}] 분기가 없어져 산출형 판단이 되었습니다 – 판단 "
                                 "결과를 담을 출력 필드(outputs)가 있어야 검증을 통과합니다"
                                 "(질문지 입출력 확인에서 채울 수 있습니다)")

    # 편집기에서는 If 행을 숨기지만 legacy task에서는 판단과 If 사이에 다른
    # 노드가 있을 수 있다. 이름·입출력만 수정했을 때 그 If를 판단 직후로
    # 당기면 실행 순서가 바뀌므로, 기존 If는 원래의 보이는 이웃 사이에 둔다.
    before_nodes = [node for node in before.get("nodes") or []
                    if isinstance(node, dict)]
    before_positions = {
        node.get("id"): index for index, node in enumerate(before_nodes)
        if node.get("id")
    }
    deferred_old_ifs.sort(
        key=lambda item: before_positions.get(item[1].get("id"), len(before_nodes))
    )
    current_ids = lambda: [node.get("id") for node in new_nodes]
    for source_id, if_node in deferred_old_ifs:
        old_index = next(
            (index for index, node in enumerate(before_nodes)
             if node.get("id") == if_node.get("id")),
            None,
        )
        ids_now = current_ids()
        source_index = ids_now.index(source_id)
        insertion = source_index + 1
        if old_index is not None:
            next_anchor = next(
                (node.get("id") for node in before_nodes[old_index + 1:]
                 if node.get("type") != "if" and node.get("id") in ids_now),
                None,
            )
            if next_anchor is not None:
                insertion = max(source_index + 1, ids_now.index(next_anchor))
            else:
                previous_anchor = next(
                    (node.get("id") for node in reversed(before_nodes[:old_index])
                     if node.get("type") != "if" and node.get("id") in ids_now),
                    None,
                )
                if previous_anchor is not None:
                    insertion = max(
                        source_index + 1, ids_now.index(previous_anchor) + 1)
        new_nodes.insert(insertion, if_node)

    deleted = [nid for nid, n in old_by_id.items()
               if nid not in seen and n.get("type") != "if"]
    summary["deleted"] = [old_by_id[d].get("name") or d for d in deleted]
    # 재구성에서 빠진 If(산출형 전환·타입 변경)는 deleted에 안 잡힌다 – next 정리에 포함
    kept_ids = {n.get("id") for n in new_nodes}
    gone = set(deleted) | {nid for nid, n in old_by_id.items()
                           if n.get("type") == "if" and nid not in kept_ids}
    task["nodes"] = new_nodes
    if design:
        previous_catalog = task_catalog.build_previous_output_catalog(task, task_path)
        ap = _Apply(
            task,
            os.path.dirname(task_path) or None,
            previous_catalog=previous_catalog,
            drop_connected_inputs=True,
        )
        for no, item in enumerate(items, 1):
            node = ap.by_id.get(item.get("id"))
            if node is None or node.get("type") == "if":
                task.clear()
                task.update(before)
                return {
                    "status": "stale",
                    "reason": f"설계 입력·출력을 적용할 노드 '{item.get('id')}'가 없습니다",
                    "instruction": STALE_INSTRUCTION,
                }
            if not isinstance(item.get("inputs"), list) or not isinstance(
                    item.get("outputs"), list):
                task.clear()
                task.update(before)
                return {
                    "status": "invalid",
                    "reason_code": "invalid_design_io",
                    "reason": f"[{node.get('name') or node.get('id')}] 입력·출력 배열이 없습니다",
                }
            answer = {
                "no": no,
                "node_id": node.get("id"),
                "qtype": "io_confirm",
                "target": "io_confirmed",
            }
            ap.apply_io(answer, node, {
                "inputs": item["inputs"],
                "outputs": item["outputs"],
            })
        if ap.stale or ap.ask_back or ap.reference_issues:
            reason_parts = list(ap.stale)
            reason_parts.extend(
                item.get("reason") or "입력·출력 형식을 확인해 주세요"
                for item in ap.ask_back
            )
            task.clear()
            task.update(before)
            return {
                "status": "stale" if ap.stale else "invalid",
                "reason_code": (
                    "stale_design_io" if ap.stale
                    else "invalid_design_io"
                ),
                "reason": " / ".join(reason_parts) or
                          "입력·출력을 안전하게 적용할 수 없습니다",
                "unresolved": ap.reference_issues,
                "written": None,
            }
        # 과거 Task는 출력 ID뿐 아니라 표시 이름으로도 연결할 수 있었다. 이름이
        # 유일했던 출력의 이름을 바꾸는 경우에만 화면 입력과 숨은 실행 요청을
        # 안정적인 출력 ID 참조로 옮긴다. 편집 전부터 동명이었던 이름 참조는 어느
        # 출력을 뜻하는지 추정하지 않고 아래 canonicalize 단계에서 재선택을 요구한다.
        blocked_legacy_sources = references.ambiguous_output_sources(before)
        before_nodes = {
            node.get("id"): node
            for node in before.get("nodes") or []
            if node.get("id") and node.get("type") != "if"
        }
        rename_rewrites = {}
        for node in task.get("nodes") or []:
            nid = node.get("id")
            old_node = before_nodes.get(nid)
            if old_node is None or node.get("type") == "if":
                continue
            old_outputs = {
                output.get("id"): output
                for output in old_node.get("outputs") or []
                if isinstance(output, dict) and output.get("id")
            }
            old_name_counts = {}
            old_output_ids = set(old_outputs)
            for old_output in old_outputs.values():
                old_name = str(old_output.get("name") or "").strip()
                if old_name:
                    old_name_counts[old_name] = old_name_counts.get(old_name, 0) + 1
            for output in node.get("outputs") or []:
                output_id = output.get("id")
                old_output = old_outputs.get(output_id)
                if old_output is None:
                    continue
                old_name = str(old_output.get("name") or "").strip()
                new_name = str(output.get("name") or "").strip()
                if not old_name or old_name == new_name:
                    continue
                old_source = f"$.nodes.{nid}.output.{old_name}"
                if (old_name_counts.get(old_name) == 1
                        and old_source not in blocked_legacy_sources
                        and (old_name not in old_output_ids or old_name == output_id)):
                    rename_rewrites[old_source] = (
                        f"$.nodes.{nid}.output.{output_id}")
        rewritten = references.rewrite_exact_sources(task, rename_rewrites)
        if rewritten:
            notes.append(
                f"이름이 바뀐 출력의 연결 {rewritten}개를 안정적인 출력 ID 참조로 "
                "갱신했습니다"
            )
        for answer, node in ap.io_pending:
            node["io_confirmed"] = True
            ap.ok(answer, "입출력 수정 반영 + io_confirmed=true")
            summary["io_updated"].append(node.get("name") or node.get("id"))
        notes.extend(ap.notes)

    reconciled = references.reconcile_removed(
        task,
        removed_nodes=deleted,
        drop_connected_inputs=design,
    )
    notes.extend(reconciled["notes"])
    if design:
        _prune_external_inputs(task)
    canonicalized = references.canonicalize_output_sources(
        task,
        blocked_sources=(
            blocked_legacy_sources if design else None
        ),
    )
    if canonicalized["changed"]:
        notes.append(
            f"과거 출력 이름 기반 연결 {canonicalized['changed']}개를 안정적인 "
            "출력 ID 참조로 갱신했습니다"
        )
    route_changed = _route_signature(before) != _route_signature(task)
    schema_upgrade = None
    legacy_version = str(before.get("schema_version") or "")
    if ((route_changed or design)
            and legacy_version in ("2.0", "2.1")):
        task["schema_version"] = "2.2"
        command_upgrades = _upgrade_legacy_command_configs(task)
        for node in task.get("nodes") or []:
            if (node.get("action_type") in ("system_write", "notify_send")
                    and "approval_required" not in node):
                node["approval_required"] = True
        _upgrade_legacy_join_inputs(task)
        migration_contract_errors = _schema_22_migration_contract_errors(task)
        effective = task_compat.effective_task(task, task_path)[0]
        conditional_errors = validate.conditional_input_errors(effective)
        if migration_contract_errors or conditional_errors:
            task.clear()
            task.update(before)
            errors = migration_contract_errors or conditional_errors
            reason_code = (
                "schema_upgrade_contract_invalid"
                if migration_contract_errors else "invalid_conditional_inputs"
            )
            return {
                "status": "invalid",
                "reason_code": reason_code,
                "reason": (
                    "schema 2.2 실행 설정을 안전하게 변환할 수 없습니다."
                    if migration_contract_errors else conditional_errors[0]
                ),
                "errors": errors,
                "schema_upgrade": {
                    "status": "skipped",
                    "from_version": legacy_version,
                    "to_version": legacy_version,
                    "reason_code": reason_code,
                    "errors": errors,
                },
                "written": None,
            }
        schema_upgrade = {
            "status": "upgraded",
            "from_version": legacy_version,
            "to_version": "2.2",
        }
        if route_changed:
            notes.append(
                "다음 단계 변경을 반영하기 위해 schema 2.2로 승격하고 "
                "분기 합류 입력을 선택 경로별로 정리했습니다"
            )
            if command_upgrades:
                notes.append(
                    f"기존 문자열 명령 {command_upgrades}개를 호환 명령 설정으로 전환했습니다"
                )
    if (design and task.get("schema_version") != "2.2"
            and any(
                isinstance(spec, dict) and spec.get("when")
                for node in task.get("nodes") or []
                if isinstance(node, dict)
                for spec in node.get("inputs") or []
            )):
        task.clear()
        task.update(before)
        return {
            "status": "invalid",
            "reason_code": "conditional_inputs_require_schema_22",
            "reason": "분기별 입력 연결은 실행 경로를 변경해 schema 2.2로 승격할 때만 저장할 수 있습니다.",
            "written": None,
        }
    if design or route_changed:
        effective = task_compat.effective_task(task, task_path)[0]
        conditional_errors = validate.conditional_input_errors(effective)
        if conditional_errors:
            task.clear()
            task.update(before)
            return {
                "status": "invalid",
                "reason_code": "invalid_conditional_inputs",
                "reason": conditional_errors[0],
                "errors": conditional_errors,
                "written": None,
            }
    unresolved = list(reconciled["unresolved"])
    unresolved.extend(canonicalized["unresolved"])
    # 명시적 제어 흐름은 값을 추정해 순차 진행으로 바꾸지 않는다.
    for n in new_nodes:
        if (n.get("type") != "if" and "next" in n
                and isinstance(n.get("next"), str) and n.get("next") in gone):
            unresolved.append({"path": f"nodes.{n.get('id')}.next",
                               "source": n.get("next"), "reason": "missing_node"})
    unresolved.extend(references.dangling_references(task))
    if unresolved:
        if design:
            task.clear()
            task.update(before)
        has_ambiguous_output = any(
            issue.get("reason") in ("ambiguous_output_name", "duplicate_output_id")
            for issue in unresolved
        )
        reason = (
            "이름이 같은 출력에 연결된 입력 또는 실행 설정이 있습니다. "
            "Creator에서 해당 출처를 다시 선택해 주세요."
            if has_ambiguous_output
            else "구조 변경 후 자동으로 재배선할 수 없는 참조가 남았습니다"
        )
        return {"status": "needs_rewire",
                "reason": reason,
                "unresolved": unresolved, "written": None,
                "summary": summary, "notes": notes}
    projection = structure_projection(
        task,
        apply=True,
        allowed_direct_self_loops=allowed_direct_self_loops,
    ) if confirm else None
    if projection is not None and not projection["ok"]:
        if design:
            task.clear()
            task.update(before)
        return {
            "status": "invalid",
            "reason_code": "invalid_structure_projection",
            "reason": projection["errors"][0],
            "errors": projection["errors"],
            "written": None,
            "summary": summary,
            "notes": notes,
        }
    task["structure_confirmed"] = bool(confirm)
    if before_write is not None:
        before_write()
    util.atomic_write_json(task_path, task)
    vres = _validated(task_path, task)
    history = _write_history(task_path, (
        "design-commit" if design else
        "structure-commit" if confirm else
        "structure"
    ),
                             before, copy.deepcopy(task),
                             edit, summary, vres)
    result = {
        "status": "ok",
        "written": task_path,
        "summary": summary,
        "notes": notes,
        "remaining": remaining,
        "structure_confirmed": bool(confirm),
        "validate": _structure_validation_summary(vres),
        "history": history,
        "next_action": _next_action(
            task_path, "open_author_questionnaire") if confirm
            else _next_action(task_path),
        "instruction": (
            "노드 구성과 입력·출력이 한 번에 확정되었습니다. "
            "판단 노드가 있으면 전체 흐름을 바탕으로 AI 프롬프트 초안을 만든 뒤 "
            "상세 설정 화면을 여세요."
            if design else
            "구성 변경과 확정이 한 번에 저장되었습니다. "
            "next_action을 실행해 입출력 확인 화면을 여세요."
            if confirm else STRUCTURE_RESULT_INSTRUCTION
        ),
    }
    if schema_upgrade is not None:
        result["schema_upgrade"] = schema_upgrade
    if projection is not None:
        result["synchronized_branch_labels"] = sorted(
            projection["label_updates"])
        result["removed_unbranched_labels"] = projection["removed_labels"]
    return result


@mutation_lock.serialized_path_mutation(path_arg=2, path_kw="task_path")
def apply_structure(task, edit, task_path):
    """기존 CLI 편집 계약: 변경을 적용하되 구성 게이트는 확정하지 않는다."""
    return _apply_structure(task, edit, task_path, confirm=False)


@mutation_lock.serialized_path_mutation(path_arg=2, path_kw="task_path")
def commit_structure(task, edit, task_path):
    """Connected UI 계약: 화면의 전체 구성을 적용하고 같은 쓰기에서 확정한다."""
    return _apply_structure(task, edit, task_path, confirm=True)


@mutation_lock.serialized_path_mutation(path_arg=2, path_kw="task_path")
def commit_design(task, edit, task_path, before_write=None):
    """Connected Creator의 노드 구성·입출력을 한 번의 쓰기로 확정한다."""
    return _apply_structure(
        task, edit, task_path, confirm=True, design=True,
        before_write=before_write)


def _legacy_direct_self_loops(task):
    """편집 전에 이미 있던 직접 재시도 경로만 schema와 무관하게 식별한다."""
    result = set()
    for node in task.get("nodes") or []:
        if not isinstance(node, dict) or node.get("type") != "if":
            continue
        source_id = node.get("source_node")
        for case in node.get("cases") or []:
            if (isinstance(case, dict)
                    and case.get("next") == source_id
                    and isinstance(case.get("value"), str)):
                result.add((node.get("id"), source_id, case.get("value")))
    return result


def structure_projection(task, apply=False, allowed_direct_self_loops=None):
    """구성 화면이 표현하는 분기 상태와 task의 labels를 같은 상태로 맞춘다."""
    nodes = [
        node for node in (task.get("nodes") or [])
        if isinstance(node, dict)
    ]
    nodes_by_id = {}
    errors = []
    for node in nodes:
        node_id = node.get("id")
        if not node_id:
            errors.append("id가 없는 노드가 있습니다.")
            continue
        if node_id in nodes_by_id:
            errors.append(f"중복 노드 id가 있습니다: {node_id}")
            continue
        nodes_by_id[node_id] = node

    allowed_direct_self_loops = set(allowed_direct_self_loops or ())
    branches_by_source = {}
    desired_labels = {}
    for branch in nodes:
        if branch.get("type") != "if":
            continue
        source_id = branch.get("source_node")
        source = nodes_by_id.get(source_id)
        if source is None:
            errors.append(
                f"분기 '{branch.get('id')}'의 판단 노드가 존재하지 않습니다: {source_id}")
            continue
        if source.get("action_type") != "decision":
            errors.append(
                f"분기 '{branch.get('id')}'가 판단 노드가 아닌 '{source_id}'를 참조합니다.")
            continue
        if source_id in branches_by_source:
            errors.append(f"판단 노드 '{source_id}'에 분기 노드가 둘 이상 연결되어 있습니다.")
            continue
        branches_by_source[source_id] = branch
        raw_cases = branch.get("cases")
        if not isinstance(raw_cases, list) or not raw_cases:
            errors.append(
                f"판단 노드 '{source.get('name') or source_id}'의 분기가 비었습니다.")
            continue
        values = []
        for case in raw_cases:
            if not isinstance(case, dict):
                errors.append(
                    f"판단 노드 '{source.get('name') or source_id}'의 분기 형식이 잘못되었습니다.")
                continue
            value = case.get("value")
            if not isinstance(value, str) or not value.strip():
                errors.append(
                    f"판단 노드 '{source.get('name') or source_id}'의 분기 이름이 비었습니다.")
            else:
                values.append(value.strip())
            target = case.get("next")
            if target is not None and target not in nodes_by_id:
                errors.append(
                    f"분기 '{value}'의 대상 노드가 존재하지 않습니다: {target}")
            loop_key = (branch.get("id"), source_id, value)
            if (target == source_id
                    and loop_key not in allowed_direct_self_loops):
                errors.append(
                    f"분기 '{value}'가 같은 판단 노드를 바로 다시 가리킬 수 없습니다.")
        if len(values) != len(set(values)):
            errors.append(
                f"판단 노드 '{source.get('name') or source_id}'의 분기 이름이 중복되었습니다.")
        desired_labels[source_id] = values

    updates = {}
    removals = []
    for node in nodes:
        if node.get("type") == "if" or node.get("action_type") != "decision":
            continue
        node_id = node.get("id")
        desired = desired_labels.get(node_id, [])
        current = node.get("labels") or []
        if current == desired:
            continue
        if desired:
            updates[node_id] = desired
        elif "labels" in node:
            removals.append(node_id)

    if errors:
        return {
            "ok": False,
            "changed": False,
            "errors": errors,
            "label_updates": updates,
            "removed_labels": removals,
        }
    if apply:
        for node_id, labels in updates.items():
            nodes_by_id[node_id]["labels"] = list(labels)
        for node_id in removals:
            nodes_by_id[node_id].pop("labels", None)
    return {
        "ok": True,
        "changed": bool(updates or removals),
        "errors": [],
        "label_updates": updates,
        "removed_labels": removals,
    }


@mutation_lock.serialized_path_mutation(path_arg=1, path_kw="task_path")
def confirm_structure(task, task_path, fingerprint=None):
    """구성을 유지한다는 답변을 JSON 수동 편집 없이 반영한다."""
    current = _task_fingerprint(task_path)
    if fingerprint and fingerprint != current:
        return {"status": "stale", "reason": "구성 확인 이후 task가 변경되었습니다",
                "task_fingerprint": current, "instruction": STALE_INSTRUCTION}
    before = copy.deepcopy(task)
    projection = structure_projection(
        task,
        apply=True,
        allowed_direct_self_loops=_legacy_direct_self_loops(before),
    )
    if not projection["ok"]:
        return {
            "status": "invalid",
            "reason_code": "invalid_structure_projection",
            "reason": projection["errors"][0],
            "errors": projection["errors"],
            "written": None,
        }
    if task.get("structure_confirmed") is True and not projection["changed"]:
        return {"status": "ok", "written": task_path, "already_confirmed": True,
                "next_action": _next_action(task_path, "open_author_questionnaire")}
    task["structure_confirmed"] = True
    util.atomic_write_json(task_path, task)
    vres = _validated(task_path, task)
    payload = {"type": "ops_structure_confirm", "task_id": task.get("task_id"),
               "task_fingerprint": fingerprint or current}
    history = _write_history(task_path, "structure-confirm", before, copy.deepcopy(task),
                             payload, {
                                 "structure_confirmed": True,
                                 "synchronized_branch_labels":
                                     sorted(projection["label_updates"]),
                                 "removed_unbranched_labels":
                                     projection["removed_labels"],
                             }, vres)
    return {"status": "ok", "written": task_path, "structure_confirmed": True,
            "synchronized_branch_labels": sorted(projection["label_updates"]),
            "removed_unbranched_labels": projection["removed_labels"],
            "validate": _structure_validation_summary(vres), "history": history,
            "next_action": _next_action(task_path, "open_author_questionnaire"),
            "instruction": "구성이 확정되었습니다. next_action을 실행해 질문지 폼을 여세요."}


def main(argv=None):
    util.utf8_stdout()
    p = argparse.ArgumentParser(description="질문지 답변·구조 편집 적용기")
    sub = p.add_subparsers(dest="cmd", required=True)
    ap = sub.add_parser("answers", help="폼 답변 JSON(ops_author_answers)을 task JSON에 반영")
    ap.add_argument("task_json")
    ap.add_argument("answers_json")
    st = sub.add_parser("structure", help="구성 편집 JSON(ops_structure_edit)을 task JSON에 반영")
    st.add_argument("task_json")
    st.add_argument("edit_json")
    cf = sub.add_parser("confirm-structure", help="노드 구성을 확정하고 질문지 단계로 진행")
    cf.add_argument("task_json")
    cf.add_argument("--fingerprint", help="구성 게이트가 반환한 task 지문")
    args = p.parse_args(argv)
    task = util.load_json(args.task_json)
    if args.cmd == "structure":
        res = apply_structure(task, util.load_json(args.edit_json), args.task_json)
    elif args.cmd == "confirm-structure":
        res = confirm_structure(task, args.task_json, args.fingerprint)
    else:
        res = apply_answers(task, util.load_json(args.answers_json), args.task_json)
    payload_path = (getattr(args, "edit_json", None)
                    or getattr(args, "answers_json", None))
    if (payload_path and res.get("status") in ("ok", "stale")
            and workspace.is_consumable_payload(payload_path)):
        try:
            os.remove(payload_path)
            res["payload_consumed"] = True
        except OSError:
            pass
    print(json.dumps(res, ensure_ascii=False, indent=2))
    return 0 if res.get("status") == "ok" else 1


if __name__ == "__main__":
    sys.exit(main())
