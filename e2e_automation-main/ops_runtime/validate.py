# -*- coding: utf-8 -*-
"""task JSON을 다음 세 단계로 검증한다.

1. 스키마 검증    : 필수 필드·타입·action_type enum·schema_version 지원 범위
2. 의미 검증      : 참조 무결성 / 가짜값(placeholder·__미정__)
3. 리허설(선택)   : --rehearsal 로 전 노드를 모의 순회해 사람·LLM 개입 지점 리포트
                    (실제 실행/API 호출 없음. --mock은 하위 호환 동의어)

CLI (AI 에이전트의 /e2e-agent-validator가 실행):
  python ops_runtime/validate.py <task.json> [--rehearsal]
"""
import argparse
import json
import re
import sys
import os

if __package__ in (None, ""):
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from ops_runtime import logic_draft, references, task_compat, util, workspace
    from ops_runtime.engine import (
        ACTION_TYPE_KO, _coactive_duplicate_input_fields, _input_runtime_keys,
        _norm_label,
        _safe_task_id_component, _task_fingerprint)
else:
    from . import logic_draft, references, task_compat, util, workspace
    from .engine import (
        ACTION_TYPE_KO, _coactive_duplicate_input_fields, _input_runtime_keys,
        _norm_label,
        _safe_task_id_component, _task_fingerprint)

SUPPORTED_VERSIONS = {"2.0", "2.1", "2.2"}
ACTION_TYPES = {"file_read", "file_write", "system_read", "system_write",
                "notify_send", "notify_receive", "consult", "decision"}
PENDING = "__미정__"
ROOT_REQUIRED = ["schema_version", "activity", "task_id", "task_name",
                 "author", "created_at", "source_yaml", "inputs_from", "nodes"]

PLACEHOLDER_PATTERNS = ("example.", "example.com", "<", ">", "your-", "yourdomain",
                        "your_", "changeme", "todo", "placeholder", "xxx",
                        "domain.com", "host:port", "sample.", "foo.bar")
URLISH_KEYS = {"endpoint", "path", "base_url", "directory", "prompt_file", "manual_url"}


def _looks_placeholder(value):
    s = str(value or "").strip().lower()
    if not s or PENDING in str(value):
        return True
    return any(p in s for p in PLACEHOLDER_PATTERNS)


# 임시 폴더 판정 — 경로 구획으로 appdata/temp/tmp가 들어가면 세션 임시 산출물로 본다
_TEMP_PATH_RE = re.compile(r"(?i)(?:[\\/]|^)(appdata|temp|tmp)(?:[\\/]|$)")


def _is_temp_path(p):
    return bool(_TEMP_PATH_RE.search(p))


def _is_abs_path(p):
    return os.path.isabs(p) or bool(re.match(r"(?i)^[a-z]:[\\/]", p))


def _check_style(task, errors, warnings):
    """표기 위생 — 라벨/If case의 앞뒤·이중 공백(관용 매칭이 흡수하지만
    신규 저작에서는 원천 정리 권장), command 개행, verify_tls 타입."""
    for n in _iter_nodes(task):
        nid = n.get("id")
        if n.get("type") == "if":
            for c in n.get("cases", []):
                v = c.get("value")
                if isinstance(v, str) and PENDING not in v and v != _norm_label(v):
                    warnings.append(f"[{nid}] If case 값에 앞뒤/이중 공백이 있습니다: '{v}' — "
                                    "decision labels와 함께 정리를 권장합니다")
            continue
        for lb in (n.get("labels") or []):
            if isinstance(lb, str) and PENDING not in lb and lb != _norm_label(lb):
                warnings.append(f"[{nid}] 라벨에 앞뒤/이중 공백이 있습니다: '{lb}' — "
                                "정리를 권장합니다(실행은 정규화 유일 일치로 수용되지만 "
                                "원천 정리가 안전합니다)")
        for cfg in [n] + (n.get("systems") or []):
            cmd = cfg.get("command")
            if isinstance(cmd, str) and "\n" in cmd:
                warnings.append(f"[{nid}] schema 2.0 legacy command에 개행이 있습니다 — "
                                "명시적인 스크립트 또는 schema 2.1 command_spec으로 전환하세요")
            integ = cfg.get("integration") or {}
            if "verify_tls" in integ and not isinstance(integ["verify_tls"], bool):
                errors.append(f"[{nid}] integration.verify_tls는 true/false여야 합니다: "
                              f"{integ['verify_tls']!r}")
            cab = integ.get("ca_bundle")
            if isinstance(cab, str) and PENDING not in cab and not os.path.isfile(cab):
                warnings.append(f"[{nid}] ca_bundle 파일이 로컬에 없습니다: {cab} — "
                                "실행 PC에 있어야 TLS 검증이 됩니다")


def _check_path_hygiene(task, errors, warnings):
    """저작 산출물 경로 위생 — 실측 사고 유형: AI가 세션 임시 폴더(Temp/AppData)에
    만든 파일을 task가 참조하면 다른 PC·다음 세션에서 깨진다.

    prompt_file·custom_logic은 저작이 만드는 산출물이라 프로젝트 내부 상대경로
    (workflows/<활동>/ 아래)가 표준 — 임시 폴더는 오류, 그 외 절대경로는 경고.
    references는 외부 자료(공유 드라이브 등)를 정당하게 가리킬 수 있어 임시 폴더만
    경고한다."""
    for n in _iter_nodes(task):
        if n.get("type") == "if":
            continue
        nid = n.get("id")
        for key in ("prompt_file", "custom_logic"):
            p = n.get(key)
            if not isinstance(p, str) or not p.strip() or PENDING in p:
                continue
            if _is_temp_path(p):
                errors.append(f"[{nid}] {key}가 임시 폴더(Temp/AppData) 경로입니다: {p} — "
                              "세션이 끝나면 사라질 수 있는 위치입니다. 파일을 표준 경로"
                              "(workflows/<활동>/ 아래)로 옮기고 경로를 고쳐 주세요")
            elif _is_abs_path(p):
                warnings.append(f"[{nid}] {key}가 절대경로입니다: {p} — 다른 PC에서 깨질 수 "
                                "있습니다. 프로젝트 내부 상대경로(workflows/<활동>/ 아래)를 "
                                "권장합니다")
        refs = n.get("references")
        if isinstance(refs, list):
            for r in refs:
                if isinstance(r, str) and PENDING not in r and _is_temp_path(r):
                    warnings.append(f"[{nid}] references가 임시 폴더(Temp/AppData) 경로를 "
                                    f"가리킵니다: {r} — 세션이 끝나면 사라질 수 있습니다. "
                                    "프로젝트 내부나 공유 경로로 자료를 옮기는 것을 권장합니다")


def _iter_nodes(task):
    for n in task.get("nodes", []):
        yield n


# ------------------------------------------------------------------ 1) 스키마

def _check_schema(task, errors):
    for key in ROOT_REQUIRED:
        if key not in task:
            errors.append(f"루트 필수 필드가 없습니다: {key}")
    if "task_id" in task:
        try:
            _safe_task_id_component(task.get("task_id"))
        except ValueError as exc:
            errors.append(str(exc))
    # 노드 구성 확인 게이트 — 사용자가 구성을 예/아니오로 확정하기 전의 산출물은
    # 유통 불가. 필드가 없는 레거시 산출물은 확정된 것으로 간주한다.
    if task.get("structure_confirmed") is False:
        errors.append("노드 구성 확인이 끝나지 않았습니다 — /e2e-agent-creator에서 사용자에게 구성 "
                      "확인(예/아니오)을 받은 뒤 structure_confirmed를 true로 바꿔야 합니다")
    if task.get("schema_version") not in SUPPORTED_VERSIONS:
        errors.append(f"지원하지 않는 schema_version: {task.get('schema_version')} "
                      f"(지원: {', '.join(sorted(SUPPORTED_VERSIONS))})")
    if "max_auto_steps_per_pump" in task:
        value = task.get("max_auto_steps_per_pump")
        if not isinstance(value, int) or isinstance(value, bool) or not 1 <= value <= 10000:
            errors.append("max_auto_steps_per_pump는 1~10000 정수여야 합니다")
    nodes = task.get("nodes")
    if not isinstance(nodes, list) or not nodes:
        errors.append("nodes가 비어 있습니다")
        return
    seen = set()
    for n in nodes:
        nid = n.get("id")
        if not nid:
            errors.append("id가 없는 노드가 있습니다")
            continue
        if nid in seen:
            errors.append(f"중복 노드 id: {nid}")
        seen.add(nid)
        if n.get("type") == "if":
            if not n.get("source_node"):
                errors.append(f"[{nid}] if 노드에 source_node가 없습니다")
            if not n.get("cases"):
                errors.append(f"[{nid}] if 노드에 cases가 없습니다")
            continue
        if "next" in n:
            nxt = n.get("next")
            if nxt is not None and (not isinstance(nxt, str) or not nxt.strip()):
                errors.append(
                    f"[{nid}] next는 null 또는 노드 ID 문자열이어야 합니다")
        at = n.get("action_type")
        if at not in ACTION_TYPES:
            errors.append(f"[{nid}] 알 수 없는 action_type: {at}")
        if at in ("system_read", "file_read") and not n.get("outputs"):
            errors.append(f"[{nid}] 조회 노드에는 결과를 전달할 outputs(출력 필드)가 최소 "
                          "1개 필요합니다 — Creator 입출력 편집에서 조회 결과 필드를 "
                          "추가하세요")
        input_bindings = set()
        for i in n.get("inputs", []):
            if "field" not in i or "source" not in i:
                errors.append(f"[{nid}] inputs 항목에 field/source가 없습니다")
                continue
            if "when" in i and task.get("schema_version") != "2.2":
                errors.append(
                    f"[{nid}] 조건부 입력 when은 schema 2.2에서만 사용할 수 있습니다")
            field = str(i.get("field") or "").strip()
            if not field:
                errors.append(f"[{nid}] 이름이 비어 있는 입력 필드가 있습니다")
                continue
            when_identity = (
                json.dumps(i.get("when"), ensure_ascii=False, sort_keys=True)
                if "when" in i else ""
            )
            binding = (
                field, str(i.get("source") or "").strip(), when_identity)
            if binding in input_bindings:
                errors.append(
                    f"[{nid}] 같은 입력 연결이 중복됩니다: {field} ← {binding[1]}")
            input_bindings.add(binding)
        output_ids = set()
        for output in n.get("outputs") or []:
            if not isinstance(output, dict):
                errors.append(f"[{nid}] outputs 항목은 객체여야 합니다")
                continue
            output_id = str(output.get("id") or "").strip()
            if not output_id:
                errors.append(f"[{nid}] id가 비어 있는 출력 필드가 있습니다")
            elif output_id in output_ids:
                errors.append(f"[{nid}] 출력 필드 id가 중복됩니다: {output_id}")
            output_ids.add(output_id)
        if at == "decision":
            if "evidence_required" in n and not isinstance(n.get("evidence_required"), bool):
                errors.append(f"[{nid}] evidence_required는 true/false여야 합니다")
            if not n.get("custom_logic"):
                if not n.get("prompt") and not n.get("prompt_file"):
                    errors.append(f"[{nid}] decision 노드에 prompt(또는 prompt_file)가 없습니다")
            # labels는 후속 If가 참조할 때만 필수(_check_refs가 잡는다) — 라벨 없는
            # decision은 판단 결과 산출형이며 결과를 담을 outputs가 필수다.
            # custom_logic도 동일(run.py의 stdout 계약이 outputs다).
            if (not [x for x in (n.get("labels") or []) if x]
                    and not n.get("outputs")):
                errors.append(f"[{nid}] 산출형 decision(labels 없음)인데 outputs(출력 필드)도 "
                              "없습니다 — 판단 결과를 담을 출력 필드를 선언하거나, 분기가 "
                              "필요하면 labels를 선언하세요")


# ------------------------------------------------------ 2) 의미 — 참조 무결성

def _check_inputs_from(task, errors):
    """inputs_from 항목이 이전 task 참조 또는 외부 입력 형식을 완전히 갖췄는지 검사한다.

    - from_task/from_node/from_field 셋 다 있음 → 같은 건ID의 이전 task 출력 참조
    - 셋 다 없음 → 시작 시 사용자에게 물어 받는 외부 입력 (예: JSM Issue Key)
    """
    for i, s in enumerate(task.get("inputs_from") or []):
        if not isinstance(s, dict) or not s.get("name"):
            errors.append(f"inputs_from[{i}]에 name이 없습니다")
            continue
        present = [k for k in ("from_task", "from_node", "from_field") if s.get(k)]
        if present and len(present) < 3:
            errors.append(f"inputs_from '{s['name']}': from_task/from_node/from_field는 셋 다 "
                          "있거나(이전 task 참조) 셋 다 없어야(시작 시 사용자에게 묻는 외부 입력) "
                          f"합니다 — 현재: {', '.join(present)}만 있음")
        elif len(present) == 3:
            try:
                _safe_task_id_component(s.get("from_task"))
            except ValueError as exc:
                errors.append(f"inputs_from '{s['name']}'의 from_task가 안전하지 않습니다: {exc}")


def _possible_runtime_input_keys(task, node):
    """현재 실행에서 handler에 전달될 수 있는 안정적인 입력 키를 반환한다."""
    specs = [
        item for item in node.get("inputs") or []
        if isinstance(item, dict)
    ]
    coactive_fields = _coactive_duplicate_input_fields(task, node, specs)
    counts = {}
    for item in specs:
        field = str(item.get("field") or "").strip()
        counts[field] = counts.get(field, 0) + 1

    known = set()
    runtime_keys = _input_runtime_keys(task, dict(node, inputs=specs))
    for item, runtime_key in zip(specs, runtime_keys):
        field = str(item.get("field") or "").strip()
        if counts.get(field, 0) <= 1 or field not in coactive_fields:
            if field:
                known.add(field)
        elif runtime_key is not None:
            known.add(runtime_key)
    return known


def _check_duplicate_input_contract(task, errors):
    """동명 표시 입력이 실행 시에도 출처별로 구분되는지 검사한다.

    field는 표시 이름이므로 서로 다른 source라면 반복할 수 있다. Runner는 동시에
    활성 가능한 동명 입력에 ``생산 노드 > field`` 키를 전달한다. 같은 If의 실제
    상호 배타 case라면 원래 field를 유지할 수 있다. 생산 노드 이름까지 같아 표시
    키가 충돌하거나, deterministic 설정이 동시에 활성 가능한 원래 field를 직접
    참조하면 실행 의미를 정할 수 없으므로 저작 단계에서 거부한다.
    """
    for node in task.get("nodes") or []:
        if node.get("type") == "if":
            continue
        nid = node.get("id")
        all_specs = [
            spec for spec in node.get("inputs") or [] if isinstance(spec, dict)
        ]
        duplicate_fields = _coactive_duplicate_input_fields(task, node, all_specs)
        if not duplicate_fields:
            continue
        specs = [
            spec for spec in all_specs
            if str(spec.get("field") or "").strip() in duplicate_fields
        ]

        runtime_keys = _input_runtime_keys(task, dict(node, inputs=specs))
        unresolved = {
            str(spec.get("field") or "").strip()
            for spec, key in zip(specs, runtime_keys)
            if isinstance(spec, dict) and key is None
        }
        for field in sorted(unresolved):
            errors.append(
                f"[{nid}] 동명 입력 '{field}'의 출처 이름을 만들 수 없습니다 — "
                "유효한 source 연결인지 확인하세요")

        seen_keys = set()
        collided_keys = set()
        for key in runtime_keys:
            if key is None:
                continue
            if key in seen_keys:
                collided_keys.add(key)
            seen_keys.add(key)
        for key in sorted(collided_keys):
            errors.append(
                f"[{nid}] 출처를 포함해도 동명 입력 키가 충돌합니다: {key} — "
                "생산 노드 이름을 서로 다르게 지정하세요")

        if node.get("custom_logic"):
            errors.append(
                f"[{nid}] custom_logic 노드는 동명 입력을 field 이름으로 안전하게 구분할 "
                "수 없습니다 — 입력 이름을 고유하게 지정하세요")

        path_input = str(node.get("path_input") or "")
        if path_input in duplicate_fields:
            errors.append(
                f"[{nid}] path_input이 동명 입력을 모호하게 참조합니다: {path_input} — "
                "'생산 노드 > 입력 이름' 키를 사용하세요")

        configs = [node] + [
            cfg for cfg in node.get("systems") or [] if isinstance(cfg, dict)
        ]
        for cfg in configs:
            formatted = []
            for config_key in ("command", "mcp_instruction", "template", "message",
                               "file_hint"):
                value = cfg.get(config_key)
                if isinstance(value, str):
                    formatted.append((config_key, value))
            command_spec = cfg.get("command_spec")
            if isinstance(command_spec, dict):
                legacy_shell = command_spec.get("legacy_shell_command")
                if isinstance(legacy_shell, str):
                    formatted.append(("command_spec.legacy_shell_command", legacy_shell))
                for arg in command_spec.get("args") or []:
                    if isinstance(arg, str):
                        formatted.append(("command_spec.args", arg))

            for config_key, value in formatted:
                clean = value.replace("{{", "").replace("}}", "")
                refs = set(re.findall(r"\{([^{}]+)\}", clean))
                for field in sorted(refs & duplicate_fields):
                    errors.append(
                        f"[{nid}] {config_key}가 동명 입력을 모호하게 참조합니다: "
                        f"{{{field}}} — '생산 노드 > 입력 이름' 키를 사용하세요")


def _control_successors(task):
    """Validator가 사용하는 task JSON의 명시적/순차 제어 흐름."""
    nodes = task.get("nodes") or []
    successors = {}
    for index, node in enumerate(nodes):
        nid = node.get("id")
        if not nid:
            continue
        if node.get("type") == "if":
            successors[nid] = [
                case.get("next") for case in node.get("cases") or []
                if case.get("next") is not None
            ]
        elif "next" in node:
            successors[nid] = [] if node.get("next") is None else [node.get("next")]
        else:
            following = nodes[index + 1].get("id") if index + 1 < len(nodes) else None
            successors[nid] = [following] if following else []
    return successors


def _reachable_without_other_cases(successors, start, target, blocked=()):
    blocked = set(blocked or ())
    pending, seen = [start], set()
    while pending:
        current = pending.pop()
        if current == target:
            return True
        if current in seen or current in blocked:
            continue
        seen.add(current)
        pending.extend(successors.get(current) or [])
    return False


def _producer_precedes_consumer(successors, start, producer, consumer,
                                blocked=()):
    """consumer에 닿는 모든 경로에서 producer가 먼저 실행되는지 본다."""
    blocked = set(blocked or ())
    pending, seen = [(start, False)], set()
    reached_consumer = False
    while pending:
        current, produced = pending.pop()
        state = (current, produced)
        if not current or state in seen or current in blocked:
            continue
        seen.add(state)
        if current == consumer:
            if not produced:
                return False
            reached_consumer = True
            continue
        produced = produced or current == producer
        pending.extend(
            (successor, produced)
            for successor in successors.get(current) or []
        )
    return reached_consumer


def _check_conditional_inputs(task, errors):
    """schema 2.2의 분기 합류 입력 계약을 검사한다.

    선언된 각 when의 If/case가 존재하는지만 검사한다. 로컬 source의 실제 활성
    여부는 Runner가 현재 실행에서 생산된 출력 epoch로 판단하므로, when.value와
    저장된 경로의 일치는 실행 권위로 사용하지 않는다.
    """
    if task.get("schema_version") != "2.2":
        return
    nodes = task.get("nodes") or []
    by_id = {node.get("id"): node for node in nodes if node.get("id")}
    for consumer in nodes:
        if consumer.get("type") == "if":
            continue
        groups = {}
        for spec in consumer.get("inputs") or []:
            if isinstance(spec, dict):
                groups.setdefault(str(spec.get("field") or "").strip(), []).append(spec)
        for field, specs in groups.items():
            conditional = [spec for spec in specs if "when" in spec]
            if not conditional:
                continue
            for spec in conditional:
                when = spec.get("when")
                if not isinstance(when, dict):
                    errors.append(
                        f"[{consumer.get('id')}] 입력 '{field}'의 when은 "
                        "if_node/value 객체여야 합니다")
                    continue
                if_id = str(when.get("if_node") or "").strip()
                value = str(when.get("value") or "")
                if_node = by_id.get(if_id)
                if not if_id or not if_node or if_node.get("type") != "if":
                    errors.append(
                        f"[{consumer.get('id')}] 입력 '{field}'의 when.if_node가 "
                        f"존재하는 If 노드가 아닙니다: {if_id}")
                    continue
                case_targets = {
                    str(case.get("value") or ""): case.get("next")
                    for case in if_node.get("cases") or []
                }
                if not value or value not in case_targets:
                    errors.append(
                        f"[{consumer.get('id')}] 입력 '{field}'의 when.value가 "
                        f"존재하는 분기 케이스가 아닙니다: {value}")


def conditional_input_errors(task):
    """Creator가 저장 전에 재사용하는 조건부 합류 입력 계약 검사."""
    errors = []
    _check_conditional_inputs(task, errors)
    return errors


def _check_refs(task, errors, warnings):
    nodes = task.get("nodes", [])
    by_id = {n.get("id"): n for n in nodes}
    from_names = {s.get("name") for s in task.get("inputs_from", [])}
    pos = {n.get("id"): p for p, n in enumerate(nodes)}
    has_if = any(n.get("type") == "if" for n in nodes)

    for n in nodes:
        nid = n.get("id")
        for i in n.get("inputs", []):
            src = i.get("source", "")
            if src.startswith("$.nodes."):
                parts = src.split(".")
                ref = parts[2] if len(parts) > 3 else ""
                if ref not in by_id:
                    errors.append(f"[{nid}] 입력이 존재하지 않는 노드를 참조합니다: {ref}")
                elif len(parts) > 4 and parts[3] == "output":
                    # 필드 존재 대조 — 노드만 검사하고 필드를 안 보면 오타/삭제된
                    # 출력 참조가 통과해 실행 때 빈 값으로 사용자에게 되묻게 된다
                    # (실측: 존재하지 않는 출력 '담당자' 참조가 검증을 통과했다)
                    field = ".".join(parts[4:])
                    resolved = references.resolve_output_source(task, src, by_id)
                    kind = (resolved or {}).get("kind")
                    if kind in ("missing_output", "duplicate_output_id"):
                        errors.append(f"[{nid}] 입력이 노드 '{ref}'에 없는 출력 필드를 "
                                      f"참조하거나 출력 ID가 중복됩니다: {field}")
                    elif kind == "ambiguous_output_name":
                        errors.append(
                            f"[{nid}] 입력이 노드 '{ref}'의 동명 출력 '{field}'을 "
                            "이름으로 참조해 어느 출력인지 알 수 없습니다 — Creator에서 "
                            "출처를 다시 선택해 출력 ID로 연결하세요")
                    elif kind == "legacy_name":
                        warnings.append(
                            f"[{nid}] 입력이 노드 '{ref}'의 출력 이름 '{field}'을 "
                            "참조합니다 — Creator에서 다시 확정하면 안정적인 출력 ID "
                            "참조로 자동 변환됩니다")
                if ref in by_id and pos[ref] >= pos[nid]:
                    # 전방 참조 — 배열 기본 진행 기준으로 생산 노드가 아직 실행 전이라
                    # 값이 없어 사용자에게 되묻게 된다. If 루프백이 있으면 재방문으로
                    # 값이 존재할 수 있어 경고로 낮춘다.
                    msg = (f"[{nid}] 배열 순서상 아직 실행되지 않은 노드의 출력을 "
                           f"참조합니다: {ref} — 실행 시 값이 없어 사용자에게 되묻게 됩니다")
                    (warnings if has_if else errors).append(msg)
            elif src.startswith("$.inputs_from."):
                name = src[len("$.inputs_from."):]
                if name not in from_names:
                    errors.append(f"[{nid}] 입력이 선언되지 않은 inputs_from을 참조합니다: {name}")
            elif src == "$.key":
                pass  # 건ID(시작 시 --key로 받은 티켓 키) — 항상 존재
            else:
                errors.append(f"[{nid}] 해석할 수 없는 입력 source: {src}")
        if "next" in n and n["next"] is not None:
            nxt = n["next"]
            if isinstance(nxt, str) and nxt.strip() and nxt not in by_id:
                errors.append(f"[{nid}] next가 존재하지 않는 노드를 가리킵니다: {nxt}")

    # If ↔ decision 라벨 집합 대조 (라벨 오타 = 분기 침묵 실패 → 저작 단계에서 차단)
    for n in nodes:
        if n.get("type") != "if":
            continue
        nid = n.get("id")
        src = by_id.get(n.get("source_node"))
        if src is None:
            errors.append(f"[{nid}] source_node가 존재하지 않습니다: {n.get('source_node')}")
            continue
        if src.get("action_type") != "decision":
            errors.append(f"[{nid}] source_node '{src.get('id')}'는 decision 노드가 아닙니다")
            continue
        labels = {x for x in (src.get("labels") or []) if x}
        if not labels:
            errors.append(f"[{nid}] source_node '{src.get('id')}'는 labels가 없는 산출형 "
                          "decision입니다 — If 분기의 근거로 쓰려면 그 decision에 "
                          "labels(=case 값 집합)를 선언해야 합니다")
        else:
            case_values = {c.get("value") for c in n.get("cases", [])}
            for extra in sorted(labels - case_values):
                errors.append(f"[{nid}] decision 라벨 '{extra}'에 해당하는 case가 없습니다 "
                              f"(decision: {src.get('id')})")
            for extra in sorted(case_values - labels):
                errors.append(f"[{nid}] case 값 '{extra}'이 decision '{src.get('id')}'의 "
                              f"labels에 없습니다")
        for c in n.get("cases", []):
            nxt = c.get("next")
            if nxt is not None and nxt not in by_id:
                errors.append(f"[{nid}] case '{c.get('value')}'의 대상이 존재하지 않습니다: {nxt}")
        # 배치 검사 — 엔진은 배열 순서+점프로 실행하므로, 판단 노드와 If 사이에 낀
        # case 대상은 라우팅 전에 무조건 실행된다 (실측: 같은 노드가 무한 반복됐다)
        src_pos, if_pos = pos.get(src.get("id")), pos.get(nid)
        if src_pos is not None and if_pos is not None:
            for c in n.get("cases", []):
                nxt = c.get("next")
                if nxt in by_id and src_pos < pos[nxt] < if_pos:
                    errors.append(f"[{nid}] case '{c.get('value')}'의 대상 '{nxt}'이 판단 노드와 If "
                                  f"사이에 배치되어 있습니다 — 라우팅 전에 무조건 실행되어 중복/무한 "
                                  f"실행됩니다. If 노드를 판단 노드 바로 뒤로 옮기세요")

    # 도달 가능성 — 배열 기본 진행 + if 라우팅으로 닿지 않는 노드는 경고
    ids = [n.get("id") for n in nodes]
    reachable = set()
    stack = [ids[0]] if ids else []
    idx = {i: p for p, i in enumerate(ids)}
    while stack:
        cur = stack.pop()
        if not isinstance(cur, str) or cur in reachable or cur not in by_id:
            continue
        reachable.add(cur)
        n = by_id[cur]
        if n.get("type") == "if":
            for c in n.get("cases", []):
                if c.get("next"):
                    stack.append(c["next"])
        else:
            nxt = n["next"] if "next" in n else (
                ids[idx[cur] + 1] if idx[cur] + 1 < len(ids) else None)
            if isinstance(nxt, str) and nxt:
                stack.append(nxt)
    for nid in ids:
        if nid not in reachable:
            warnings.append(f"[{nid}] 어떤 경로로도 도달할 수 없는 노드입니다")

    # API request 등 inputs[] 밖의 실행 참조까지 공용 인덱스로 검사한다.
    reported = set(errors)
    for issue in references.dangling_references(task):
        if re.match(r"^nodes\[\d+\]\.inputs\[\d+\]\.source$", issue["path"]):
            # 바로 위 입력 검사에서 사용자 친화적인 원인으로 이미 보고했다.
            continue
        msg = (f"실행 참조가 유효하지 않습니다: {issue['path']} → {issue.get('source')} "
               f"({issue['reason']})")
        if msg not in reported:
            errors.append(msg)
            reported.add(msg)


# ---------------------------------------------------- 2) 의미 — 가짜값·시크릿

def _walk_strings(obj, path=""):
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield from _walk_strings(v, f"{path}.{k}" if path else k)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from _walk_strings(v, f"{path}[{i}]")
    elif isinstance(obj, str):
        yield path, obj


def _check_fabrication(task, errors):
    for path, s in _walk_strings(task):
        if PENDING in s:
            errors.append(f"'{PENDING}' 마커가 남아 있습니다: {path} — 저작 질답으로 채워야 합니다")
    for n in _iter_nodes(task):
        nid = n.get("id")
        candidates = []
        integ = n.get("integration") or {}
        for key in URLISH_KEYS:
            if key in n:
                candidates.append((key, n[key]))
            if key in integ:
                candidates.append((key, integ[key]))
        for s in n.get("systems", []) or []:
            sub = s.get("integration") or {}
            for key in URLISH_KEYS:
                if key in s:
                    candidates.append((key, s[key]))
                if key in sub:
                    candidates.append((key, sub[key]))
        for key, val in candidates:
            if PENDING in str(val):
                continue  # 위에서 이미 보고
            if _looks_placeholder(val):
                errors.append(f"[{nid}] {key}가 예시/placeholder 값으로 보입니다: {val}")


def _check_methods(task, errors, warnings):
    """각 실행 방식에 필요한 설정이 빠짐없이 들어 있는지 검사한다.

    - manual인데 manual_guide 없음 → 실행 시 범용 문구만 나와 안내 정보가 사라진다.
    - automation_note 잔존 → 저작 질답의 확인 절차를 건너뛴 반쪽 산출물.
    - command: 명령 필수, 시스템 노드 전용, 출력 필드는 1개(stdout 전체가 들어간다).
    - mcp: 서버 이름·지시문 필수, 시스템 노드 전용, 지시문의 {필드} 참조 무결성.
    - method 오타는 핸들러가 조용히 manual로 폴백하므로 enum을 검사한다.
    - manual_url: 실행 때 엔진이 브라우저로 여는 값 — http(s)가 아니면 경고.
    - manual_copy_automation: system_read+manual+http(s) manual_url에서 boolean만 허용.
    """
    def check_cfg(nid, cfg, node):
        method = cfg.get("method")
        if (method and PENDING not in str(method)
                and method not in ("api", "command", "mcp", "manual")):
            errors.append(f"[{nid}] method 값이 올바르지 않습니다: {method} — "
                          "api/command/mcp/manual 중 하나여야 합니다 "
                          "(오타면 실행 때 조용히 manual로 처리됩니다)")
        if method == "manual" and not cfg.get("manual_guide"):
            errors.append(f"[{nid}] method가 manual인데 manual_guide(사용자 안내문)가 없습니다 — "
                          "저작 질답에서 안내문을 받아야 합니다")
        mu = cfg.get("manual_url")
        if mu and not str(mu).lower().startswith(("http://", "https://")):
            warnings.append(f"[{nid}] manual_url이 http(s) 주소가 아닙니다: {mu} — "
                            "실행 때 브라우저 자동 열기가 실패할 수 있습니다")
        if "manual_copy_automation" in cfg:
            copy_automation = cfg.get("manual_copy_automation")
            if not isinstance(copy_automation, bool):
                errors.append(f"[{nid}] manual_copy_automation은 boolean이어야 합니다")
            if copy_automation is True:
                if node.get("action_type") != "system_read":
                    errors.append(f"[{nid}] manual_copy_automation은 system_read에서만 "
                                  "사용할 수 있습니다")
                if method != "manual":
                    errors.append(f"[{nid}] manual_copy_automation은 manual 방식에서만 "
                                  "사용할 수 있습니다")
                if not mu:
                    errors.append(f"[{nid}] manual_copy_automation에는 manual_url이 필요합니다")
                elif not (isinstance(mu, str)
                          and mu.lower().startswith(("http://", "https://"))):
                    errors.append(f"[{nid}] manual_copy_automation의 manual_url은 http(s) "
                                  "주소여야 합니다")
        if method == "command":
            if node.get("action_type") not in ("system_read", "system_write"):
                errors.append(f"[{nid}] command 방식은 시스템 조회/실행에서만 쓸 수 있습니다")
            spec = cfg.get("command_spec")
            legacy = cfg.get("command")
            if task.get("schema_version") in ("2.1", "2.2") and not isinstance(spec, dict):
                errors.append(
                    f"[{nid}] schema 2.1/2.2 command는 command_spec 객체가 필요합니다")
            if isinstance(spec, dict):
                legacy_shell = spec.get("legacy_shell_command")
                if legacy_shell is not None:
                    if not isinstance(legacy_shell, str) or not legacy_shell.strip():
                        errors.append(
                            f"[{nid}] command_spec.legacy_shell_command가 비었습니다")
                    elif _looks_placeholder(legacy_shell):
                        errors.append(
                            f"[{nid}] legacy_shell_command가 예시/placeholder로 보입니다: "
                            f"{legacy_shell}")
                    program = "legacy-shell"
                    args = []
                else:
                    program = spec.get("program")
                    args = spec.get("args", [])
                timeout = spec.get("timeout_seconds", 120)
                if not isinstance(program, str) or not program.strip() or _looks_placeholder(program):
                    errors.append(f"[{nid}] command_spec.program이 비었거나 예시값입니다: {program}")
                if not isinstance(args, list) or not all(isinstance(x, str) for x in args):
                    errors.append(f"[{nid}] command_spec.args는 문자열 배열이어야 합니다")
                else:
                    known = _possible_runtime_input_keys(task, node)
                    for arg in args:
                        clean = arg.replace("{{", "").replace("}}", "")
                        for ref in re.findall(r"\{([^{}]+)\}", clean):
                            if ref not in known:
                                errors.append(f"[{nid}] command_spec 인자가 노드 입력에 없는 "
                                              f"필드를 참조합니다: {{{ref}}}")
                if not isinstance(timeout, int) or isinstance(timeout, bool) or not 1 <= timeout <= 3600:
                    errors.append(f"[{nid}] command_spec.timeout_seconds는 1~3600 정수여야 합니다")
            elif not legacy:
                errors.append(f"[{nid}] method가 command인데 command_spec/command가 없습니다")
            else:
                warnings.append(f"[{nid}] legacy command 셸 문자열을 사용합니다 — schema 2.1의 "
                                "command_spec(program+args) 전환을 권장합니다")
                cmd = str(legacy)
                if _looks_placeholder(cmd):
                    errors.append(f"[{nid}] command가 예시/placeholder로 보입니다: {cmd}")
            if len(node.get("outputs") or []) > 1:
                errors.append(f"[{nid}] command 노드의 출력 필드는 1개여야 합니다 "
                              "(명령의 stdout 전체가 그 필드에 기록됩니다)")
        if method == "mcp":
            if node.get("action_type") not in ("system_read", "system_write"):
                errors.append(f"[{nid}] mcp 방식은 시스템 조회/실행에서만 쓸 수 있습니다")
            server = str(cfg.get("mcp_server") or "").strip()
            if not server:
                errors.append(f"[{nid}] method가 mcp인데 MCP 서버 이름(mcp_server)이 없습니다 — "
                              "저작 질답에서 받아야 합니다")
            elif PENDING not in server and _looks_placeholder(server):
                errors.append(f"[{nid}] mcp_server가 예시/placeholder 값으로 보입니다: {server}")
            instr = str(cfg.get("mcp_instruction") or "").strip()
            if not instr:
                errors.append(f"[{nid}] method가 mcp인데 지시문(mcp_instruction)이 없습니다 — "
                              "저작 질답에서 받아야 합니다")
            else:
                known = _possible_runtime_input_keys(task, node)
                clean = util.normalize_named_placeholders(instr, known)
                for ref in util.named_placeholder_refs(clean):
                    if ref not in known:
                        errors.append(f"[{nid}] mcp_instruction이 노드 입력에 없는 필드를 "
                                      f"참조합니다: {{{ref}}} — 실행 때 치환되지 않습니다")
        if cfg.get("automation_note"):
            errors.append(f"[{nid}] automation_note가 남아 있습니다 — 저작 질답에서 자동화 가능 "
                          "여부를 확인해 method를 확정한 뒤 지워야 합니다")

    for n in _iter_nodes(task):
        # custom_logic 노드는 엔진이 핸들러 대신 run.py를 실행한다.
        # method 등 타입별 필드를 쓰지 않으므로 완결성을 요구하지 않는다
        if n.get("type") == "if" or n.get("custom_logic"):
            continue
        nid = n.get("id")
        if ("method" in n or "automation_note" in n
                or "manual_copy_automation" in n):
            check_cfg(nid, n, n)
        for s in n.get("systems", []) or []:
            check_cfg(nid, s, n)


def _check_file_read(task, errors):
    """file_read 경로 완결성 — 고정 path / 실행 시 path_input / 폴더+힌트 /
    manual(복붙) 중 하나여야 한다. 짝이 안 맞거나 충돌하면 런타임에야 터지므로
    저작 단계로 당겨 거부한다."""
    for n in _iter_nodes(task):
        if (n.get("type") == "if" or n.get("action_type") != "file_read"
                or n.get("custom_logic")):
            continue
        nid = n.get("id")
        has_dir, has_hint = bool(n.get("directory")), bool(n.get("file_hint"))
        if has_dir != has_hint:
            errors.append(f"[{nid}] directory와 file_hint는 함께 있어야 합니다 — 폴더+힌트 "
                          "방식은 둘 다 채워야 실행 때 AI가 파일을 찾을 수 있습니다")
        modes = [bool(n.get("path")), bool(n.get("path_input")), has_dir and has_hint,
                 n.get("method") == "manual"]
        if sum(modes) != 1:
            errors.append(f"[{nid}] file_read 방식은 고정 경로·실행 시 경로 입력·"
                          "폴더+힌트·직접 붙여넣기 중 정확히 하나여야 합니다")
        if (n.get("path_input")
                and n.get("path_input") not in _possible_runtime_input_keys(task, n)):
            errors.append(f"[{nid}] path_input '{n.get('path_input')}'이 inputs에 없습니다")


def _check_decision_files(task, errors, warnings, task_path=None):
    """decision 노드의 판단 파일과 참고 자료 설정을 검사한다.

    참고 자료는 실행할 때 AI가 직접 읽는다. 저작 PC와 실행 PC가 다를 수 있으므로
    로컬 파일이 없거나 폴더가 비어 있는 경우에는 오류가 아닌 경고로 알린다.
    """
    for n in _iter_nodes(task):
        if n.get("type") == "if" or n.get("custom_logic"):
            continue
        nid = n.get("id")
        is_decision = n.get("action_type") == "decision"
        if "references" in n and not is_decision:
            errors.append(f"[{nid}] references는 decision 노드 전용입니다")
            continue
        if not is_decision:
            continue
        if n.get("prompt") and n.get("prompt_file"):
            warnings.append(f"[{nid}] prompt와 prompt_file이 둘 다 있습니다 — 실행은 "
                            "prompt_file을 우선 사용하므로 prompt는 지워도 됩니다")
        elif n.get("prompt") and PENDING not in str(n["prompt"]):
            # 기존 task 호환을 위해 오류는 아니다 — 신규 저작은 항상 파일 관리한다.
            warnings.append(f"[{nid}] 판단 프롬프트가 JSON 인라인입니다 — 파일 관리"
                            "(prompt_file)를 권장합니다 (저작 질문지가 표준 경로에 "
                            "초안을 만들어 줍니다)")
        pf = n.get("prompt_file")
        actual_pf = workspace.resolve_project_path(pf, task_path) if task_path else pf
        if pf and PENDING not in pf and not os.path.isfile(actual_pf):
            warnings.append(f"[{nid}] 판단 프롬프트 파일이 로컬에 없습니다: {pf} — "
                            "실행 PC에 이 경로가 있어야 실행됩니다")
        refs = n.get("references")
        if refs is None:
            continue
        if not isinstance(refs, list) or not all(isinstance(r, str) for r in refs):
            errors.append(f"[{nid}] references는 파일/폴더 경로 문자열의 배열이어야 합니다")
            continue
        for r in refs:
            if PENDING in r:
                continue  # 마커는 _check_fabrication이 이미 보고
            actual_ref = workspace.resolve_project_path(r, task_path) if task_path else r
            if _looks_placeholder(r):
                errors.append(f"[{nid}] references 항목이 예시/placeholder 값으로 보입니다: {r}")
            elif os.path.isdir(actual_ref):
                if not os.listdir(actual_ref):
                    warnings.append(f"[{nid}] 참고 자료 폴더가 비어 있습니다: {r} — "
                                    "실행 전까지 자료를 넣어두면 AI가 읽고 판단에 반영합니다")
            elif not os.path.exists(actual_ref):
                warnings.append(f"[{nid}] 참고 자료 경로가 로컬에 없습니다: {r} — "
                                "실행 PC에 있는지 확인하세요")


def _check_decision_evidence(task, errors, warnings):
    """판단 근거 기록 계약만 검사한다.

    라벨과 입력 이름의 의미 일치는 문자열 휴리스틱으로 판정하지 않는다. 페이지 전체
    내용이나 참고 자료 안에 판단 근거가 있을 수 있고, Creator에서 사용자가 입출력과
    라벨을 직접 확정하기 때문이다.
    """
    for node in _iter_nodes(task):
        if node.get("type") == "if" or node.get("action_type") != "decision":
            continue
        nid = node.get("id")
        if node.get("evidence_required") is not True:
            warnings.append(f"[{nid}] 판단 결과의 근거 기록이 필수가 아닙니다 — "
                            "evidence_required=true를 권장합니다")


def _group_results(errors, warnings):
    """기존 errors/warnings 호환성을 유지하며 사용자 보고용 세 그룹을 만든다."""
    incomplete, structure = [], []
    for message in errors:
        if "'__미정__' 마커" in message:
            incomplete.append({"code": "pending_value", "message": message})
        elif "automation_note가 남아" in message:
            incomplete.append({"code": "automation_setup_pending", "message": message})
        elif "structure_confirmed=false" in message:
            incomplete.append({"code": "structure_confirmation_pending", "message": message})
        else:
            structure.append({"code": "validation_error", "message": message})
    advisory = [{"code": "warning", "message": message} for message in warnings]
    return {
        "structure": {"blocking": True, "count": len(structure), "issues": structure},
        "incomplete": {"blocking": True, "count": len(incomplete), "issues": incomplete},
        "advisory": {"blocking": False, "count": len(advisory), "issues": advisory},
    }


def _check_unused_terminal_outputs(task, warnings):
    """마지막 수동 쓰기가 입력을 그대로 재출력해 불필요한 확인을 만드는 경우를 알린다."""
    consumers = set()
    for node in _iter_nodes(task):
        for spec in node.get("inputs") or []:
            source = str(spec.get("source") or "")
            match = re.match(r"^\$\.nodes\.([^.]+)\.output\.(.+)$", source)
            if match:
                consumers.add((match.group(1), match.group(2)))
    for node in _iter_nodes(task):
        if node.get("type") == "if" or node.get("action_type") != "system_write":
            continue
        outputs = node.get("outputs") or []
        if not outputs:
            continue
        input_names = {str(i.get("field") or "") for i in node.get("inputs") or []}
        mirrored = [o for o in outputs if str(o.get("name") or o.get("id") or "") in input_names]
        unconsumed = [o for o in mirrored
                      if (node.get("id"), o.get("id")) not in consumers
                      and (node.get("id"), o.get("name")) not in consumers]
        if unconsumed and len(unconsumed) == len(outputs):
            warnings.append(f"[{node.get('id')}] 시스템 실행의 출력이 입력값을 그대로 반복하고 "
                            "후속 노드도 사용하지 않습니다 — 출력을 제거하면 완료 여부만 확인해 "
                            "중복 payload와 값 재입력을 줄일 수 있습니다")


def _check_custom_skill_removed(task, errors):
    """custom_skill은 현재 런타임에서 지원하지 않는다. 값이 남아 있는
    레거시 task는 조용히 무시하지 않고 오류로 알린다(None은 무해한 잔존 필드)."""
    for n in _iter_nodes(task):
        if n.get("type") != "if" and n.get("custom_skill"):
            errors.append(f"[{n.get('id')}] custom_skill은 지원하지 않는 기능입니다 — "
                          "커스텀 로직으로 전환하거나 표준 방식으로 재저작하세요")


def _check_custom_logic(task, errors, warnings):
    """custom_logic 검사 — 상호배타·placeholder는 오류,
    폴더·파일 부재는 경고(references와 같은 이유 — 저작 PC와 실행 PC가 다를 수 있다),
    run.py가 AI 초안 그대로면 검토 안내 경고(사용자가 수정하면 자동 해소)."""
    for n in _iter_nodes(task):
        folder = n.get("custom_logic")
        if not folder or n.get("type") == "if" or PENDING in str(folder):
            continue
        nid = n.get("id")
        if n.get("systems"):
            errors.append(f"[{nid}] custom_logic 노드에는 systems(복수 시스템)를 함께 쓸 수 "
                          "없습니다 — 시스템 분기는 run.py 안에서 처리하거나 노드를 나누세요")
        if not isinstance(folder, str) or _looks_placeholder(folder):
            errors.append(f"[{nid}] custom_logic이 폴더 경로가 아니거나 예시/placeholder "
                          f"값으로 보입니다: {folder}")
            continue
        if not os.path.isdir(folder):
            warnings.append(f"[{nid}] 커스텀 로직 폴더가 로컬에 없습니다: {folder} — "
                            "실행 PC에 이 폴더가 있어야 실행됩니다")
            continue
        if not os.path.isfile(os.path.join(folder, "LOGIC.md")):
            warnings.append(f"[{nid}] 커스텀 로직 사양서가 없습니다: {folder}LOGIC.md — "
                            "사양서가 있어야 로직을 검토·수정할 수 있습니다")
        run_py = os.path.join(folder, "run.py")
        if not os.path.isfile(run_py):
            warnings.append(f"[{nid}] 커스텀 로직 스크립트가 아직 없습니다: {folder}run.py — "
                            "사양 확정 후 run.py를 작성해야 실행됩니다")
            continue
        if logic_draft.draft_status(folder) == "ai_draft":
            warnings.append(f"[{nid}] 커스텀 로직 run.py가 AI 초안 그대로입니다 — 내용을 "
                            "검토한 뒤 실행하세요 (코드를 수정하면 검토로 간주됩니다. 수정 "
                            "없이 확정하려면: python ops_runtime/logic_draft.py approve "
                            f"{folder})")

def _graph(task):
    nodes = task.get("nodes") or []
    ids = [n.get("id") for n in nodes]
    by_id = {n.get("id"): n for n in nodes}
    adj = {nid: set() for nid in ids}
    for i, node in enumerate(nodes):
        nid = node.get("id")
        if node.get("type") == "if":
            adj[nid].update(c.get("next") for c in node.get("cases") or [] if c.get("next"))
        else:
            nxt = node.get("next") if "next" in node else (ids[i + 1] if i + 1 < len(ids) else None)
            if isinstance(nxt, str) and nxt:
                adj[nid].add(nxt)
    return by_id, adj


def _reachable(adj, start, target):
    seen, stack = set(), [start]
    while stack:
        cur = stack.pop()
        if cur == target:
            return True
        if cur in seen:
            continue
        seen.add(cur)
        stack.extend(adj.get(cur, ()))
    return False


def _automatic_write(node):
    configs = (node.get("systems") or [node])
    if node.get("action_type") == "system_write":
        return any(c.get("method") in ("api", "command", "mcp") for c in configs)
    if node.get("action_type") == "notify_send":
        return node.get("channel") in ("api", "ba_entity")
    return False


def _check_execution_safety(task, errors, warnings):
    """승인 정책과 쓰기 후 검증 노드 연결을 검사한다."""
    by_id, adj = _graph(task)
    pos = {n.get("id"): i for i, n in enumerate(task.get("nodes") or [])}
    for node in task.get("nodes") or []:
        if node.get("type") == "if" or not _automatic_write(node):
            continue
        nid = node.get("id")
        if task.get("schema_version") in ("2.1", "2.2"):
            if "approval_required" not in node:
                errors.append(
                    f"[{nid}] schema 2.1/2.2 자동 쓰기 노드에 approval_required가 없습니다")
            elif node.get("approval_required") is False and not str(
                    node.get("approval_bypass_reason") or "").strip():
                errors.append(f"[{nid}] approval_required=false이면 approval_bypass_reason이 필요합니다")
        elif "approval_required" not in node:
            warnings.append(f"[{nid}] schema 2.0 자동 쓰기 노드에 사전 승인 정책이 없습니다")

        verifier = node.get("verifies_node")
        if not verifier:
            warnings.append(f"[{nid}] 외부 쓰기 후 결과를 확인할 verifies_node가 없습니다")
            continue
        target = by_id.get(verifier)
        if target is None:
            errors.append(f"[{nid}] verifies_node가 존재하지 않습니다: {verifier}")
            continue
        if target.get("action_type") not in ("system_read", "decision"):
            errors.append(f"[{nid}] verifies_node는 system_read 또는 decision이어야 합니다: {verifier}")
        if pos.get(verifier, -1) <= pos.get(nid, -1):
            errors.append(f"[{nid}] verifies_node는 쓰기 노드 뒤에 있어야 합니다: {verifier}")
        if not _reachable(adj, nid, verifier):
            errors.append(f"[{nid}] verifies_node에 실행 경로로 도달할 수 없습니다: {verifier}")


def _pause_capable(node):
    if node.get("type") == "if" or node.get("custom_logic"):
        return False
    at = node.get("action_type")
    if at in ("decision", "consult", "notify_receive"):
        return True
    if at == "file_read":
        return node.get("method") == "manual" or not node.get("path")
    if at == "file_write":
        return bool(node.get("generation_prompt"))
    if at in ("system_read", "system_write"):
        configs = node.get("systems") or [node]
        return any(c.get("method") in ("manual", "mcp") for c in configs)
    if at == "notify_send":
        return node.get("channel") not in ("api", "ba_entity")
    return False


def _check_cycles(task, errors, warnings):
    """SCC 단위로 자동 무한 순환과 개입형 재작업 순환을 구분한다."""
    by_id, adj = _graph(task)
    index, stack, on_stack, idx, low, components = 0, [], set(), {}, {}, []

    def visit(v):
        nonlocal index
        idx[v] = low[v] = index
        index += 1
        stack.append(v)
        on_stack.add(v)
        for w in adj.get(v, ()):
            if w not in by_id:
                continue
            if w not in idx:
                visit(w)
                low[v] = min(low[v], low[w])
            elif w in on_stack:
                low[v] = min(low[v], idx[w])
        if low[v] == idx[v]:
            comp = []
            while True:
                w = stack.pop()
                on_stack.remove(w)
                comp.append(w)
                if w == v:
                    break
            components.append(comp)

    for nid in by_id:
        if nid not in idx:
            visit(nid)
    for comp in components:
        cyclic = len(comp) > 1 or (len(comp) == 1 and comp[0] in adj.get(comp[0], set()))
        if not cyclic:
            continue
        labels = ", ".join(comp)
        if any(_pause_capable(by_id[nid]) for nid in comp):
            warnings.append(f"재작업 순환 경로가 있습니다(사람/AI 개입 포함): {labels}")
        else:
            errors.append(f"사용자·AI 정지 없이 반복되는 자동 순환 경로가 있습니다: {labels}")


# ------------------------------------------------------------------ 3) 리허설

def _rehearse_label(n):
    """[타입 한글명] 노드 이름 — 미리보기에서 노드 id를 노출하지 않기 위한 표기."""
    ko = ACTION_TYPE_KO.get(n.get("action_type"))
    name = n.get("name") or n.get("id", "")
    return f"[{ko}] {name}" if ko else name


def _short(text, limit=60):
    """detail용 한 줄 요약 — 개행을 접고 앞부분만."""
    s = " ".join(str(text).split())
    return s if len(s) <= limit else s[:limit] + "…"


def _ref_detail(path, task_path=None):
    """참고 자료 경로의 리허설 표기 — 실사용 요청: 어느 폴더에 파일이 몇 개 있는지
    미리보기에서 바로 보이게 한다(로컬 부재는 warning과 별개로 detail에도 표기)."""
    actual_path = workspace.resolve_project_path(path, task_path) if task_path else path
    if os.path.isdir(actual_path):
        total = 0
        for _, _, files in os.walk(actual_path):
            total += len(files)
            if total > 100:
                return f"{path} (파일 100개 이상)"
        return f"{path} (파일 {total}개)"
    if os.path.isfile(actual_path):
        return f"{path} (파일)"
    return f"{path} (로컬에 없음)"


def rehearse(task, task_path=None):
    """모의 순회 — 각 노드가 자동 실행인지, 어떤 kind로 멈추는지 리포트.

    label(사람이 읽는 표기)과 detail(개입 내용 요약)을 함께 싣는다 — 실측: '실행 시
    흐름 미리보기'를 AI 에이전트가 재량으로 그리다 판단 노드의 프롬프트 파일·참고 자료
    정보가 누락됐다. 미리보기 내용도 도구 산출물이어야 한다."""
    if task_path:
        task = task_compat.effective_task(task, task_path)[0]
    report = []
    for n in task.get("nodes", []):
        nid = n.get("id")
        if n.get("type") == "if":
            report.append({"node": nid, "label": n.get("name") or "If 분기", "mode": "auto",
                           "kind": "if_routing", "detail": "판단 라벨에 따라 자동 분기"})
            continue
        at = n.get("action_type")
        entry = {"node": nid, "label": _rehearse_label(n)}
        if n.get("custom_logic"):
            folder = n["custom_logic"]
            actual_folder = (workspace.resolve_project_path(folder, task_path)
                             if task_path else folder)
            mark = ""
            if not os.path.isfile(os.path.join(actual_folder, "run.py")):
                mark = " (run.py 로컬에 없음)"
            elif logic_draft.draft_status(actual_folder) == "ai_draft":
                mark = " (AI 초안 — 검토 필요)"
            entry.update(mode="auto", kind=None,
                         detail=f"커스텀 로직 실행: {folder}run.py{mark}")
        elif n.get("systems"):
            names = ", ".join(s.get("name", "?") for s in n["systems"])
            entry.update(mode="pause", kind="choose_system", detail=f"시스템 선택: {names}")
        elif at == "decision":
            parts = []
            if n.get("prompt_file"):
                pf = n["prompt_file"]
                actual_pf = (workspace.resolve_project_path(pf, task_path)
                             if task_path else pf)
                miss = "" if os.path.isfile(actual_pf) else " (로컬에 없음)"
                parts.append(f"판단 프롬프트 파일: {pf}{miss}")
            elif n.get("prompt"):
                parts.append(f"판단 기준(인라인): \"{_short(n['prompt'])}\"")
            refs = n.get("references") or []
            if refs:
                parts.append("참고 자료를 AI가 직접 읽고 판단: "
                             + ", ".join(_ref_detail(r, task_path) for r in refs))
            labels = [x for x in (n.get("labels") or []) if x]
            outs = ", ".join(f.get("name") or f.get("id", "?")
                             for f in n.get("outputs") or [])
            if not labels:
                # 판단 결과 산출형 — 라벨 없이 출력 필드로만 결과 전달
                parts.append("판단 결과 산출(분기·라벨 없음)" + (f" — 출력: {outs}" if outs else ""))
            elif len(labels) == 1:
                # 방침결정형 — 분기 없이 판단 내용을 출력 필드로 후속에 전달
                parts.append("방침 결정(분기 없음)" + (f" — 출력: {outs}" if outs else ""))
            else:
                parts.append("분기 라벨: " + " / ".join(labels))
            entry.update(mode="pause",
                         kind="llm_decision" if labels else "llm_decision_output",
                         detail=" · ".join(parts) or "LLM 판단")
        elif at == "consult":
            entry.update(mode="pause", kind="ask_user_deferrable",
                         detail=f"협의 — 주제: {n.get('topic', '?')} "
                                "(지금 입력·다음에 재진행·미진행 선택)")
        elif at == "notify_receive":
            entry.update(mode="pause", kind="ask_user_deferrable",
                         detail=f"수신 대기 — {n.get('guide', '?')} "
                                "(지금 입력·다음에 재진행·미수신 처리 선택)")
        elif at == "file_write" and n.get("generation_prompt"):
            dest = f" → {n['path']}" if n.get("path") else ""
            entry.update(mode="pause", kind="llm_generate",
                         detail=f"AI가 문서 내용을 생성{dest}")
        elif at == "notify_send" and n.get("channel") == "manual":
            detail = f"수동 발송 — 수신자: {n.get('recipient') or '?'}"
            entry.update(mode="pause", kind="ask_user", detail=detail)
        elif n.get("method") == "mcp":
            detail = f"MCP 호출({n.get('mcp_server') or '?'})"
            if n.get("mcp_instruction"):
                detail += f" — 지시: \"{_short(n['mcp_instruction'])}\""
            if at == "system_write" and not (n.get("outputs") or []):
                detail += " (완료 확인형)"
            entry.update(mode="pause", kind="mcp_call", detail=detail)
        elif n.get("method") == "manual":
            detail = "수동 처리 — 안내문에 따라 사용자가 수행·입력"
            if n.get("manual_guide"):
                detail = f"수동 처리 — 안내: \"{_short(n['manual_guide'])}\""
            entry.update(mode="pause", kind="ask_user", detail=detail)
        elif at == "file_read" and not n.get("path") and n.get("directory") and n.get("file_hint"):
            entry.update(mode="pause", kind="llm_find_file",
                         detail=f"AI가 {n['directory']} 폴더에서 '{n['file_hint']}' 파일 탐색")
        elif at == "file_write" and n.get("template"):
            entry.update(mode="auto", kind=None,
                         detail=f"template 기반 자동 생성 → {n.get('path') or '?'}")
        else:
            entry.update(mode="auto", kind=None, detail=None)
        report.append(entry)
    return report


# ------------------------------------------------------------------- 공개 API

def validate(task, task_path=None):
    if task_path:
        task = task_compat.effective_task(task, task_path)[0]
    errors, warnings = [], []
    _check_schema(task, errors)
    if not errors or task.get("nodes"):
        _check_inputs_from(task, errors)
        _check_conditional_inputs(task, errors)
        _check_duplicate_input_contract(task, errors)
        _check_refs(task, errors, warnings)
        _check_fabrication(task, errors)
        _check_methods(task, errors, warnings)
        _check_file_read(task, errors)
        _check_decision_files(task, errors, warnings, task_path)
        _check_decision_evidence(task, errors, warnings)
        _check_unused_terminal_outputs(task, warnings)
        _check_custom_skill_removed(task, errors)
        _check_custom_logic(task, errors, warnings)
        _check_path_hygiene(task, errors, warnings)
        _check_style(task, errors, warnings)
        _check_execution_safety(task, errors, warnings)
        _check_cycles(task, errors, warnings)
    result = {"ok": not errors, "errors": errors, "warnings": warnings,
              "groups": _group_results(errors, warnings)}
    if errors:
        result["next_action"] = {"type": "continue_authoring"}
    return result


def main(argv=None):
    util.utf8_stdout()
    p = argparse.ArgumentParser(description="task JSON 검증 (AI 에이전트의 /e2e-agent-validator가 실행)")
    p.add_argument("task_json")
    p.add_argument("--rehearsal", "--mock", dest="rehearsal", action="store_true",
                   help="모의 리허설 리포트 포함 — 실제 실행/API 호출은 하지 않는다"
                        " (--mock은 하위 호환 동의어)")
    args = p.parse_args(argv)

    task = util.load_json(args.task_json)
    result = validate(task, args.task_json)
    result["task_path"] = os.path.abspath(args.task_json)
    result["task_fingerprint"] = _task_fingerprint(args.task_json)
    if result.get("next_action"):
        result["next_action"]["task_path"] = result["task_path"]
    if args.rehearsal:
        result["rehearsal"] = rehearse(task, args.task_json)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
