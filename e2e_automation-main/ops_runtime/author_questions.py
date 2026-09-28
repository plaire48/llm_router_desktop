# -*- coding: utf-8 -*-
"""task JSON의 미완성 실행 설정을 채울 질문지를 생성한다.

``__미정__`` 항목을 노드별로 묶어 한 번에 표시할 질문 목록을 만든다.

- 사실값(endpoint·명령어·인증 이름·경로)은 빈칸으로 묻는다 — 추정 금지.
- 문구(안내문·판단 프롬프트)는 노드 이름·필드 기반 '추천' 초안을 붙인다 —
  사용자는 "그대로/수정"만 답하면 된다(문구류 기본 초안은 허용).

CLI (AI 에이전트의 /e2e-agent-creator가 실행):
  python ops_runtime/author_questions.py workflows/<활동>/<task>.json
"""
import argparse
import copy
import hashlib
import json
import os
import re
import sys

if __package__ in (None, ""):
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from ops_runtime import (author_form, author_structure, custom_logic_jobs,
                             task_catalog, util, workspace)
    from ops_runtime.engine import ACTION_TYPE_KO, _sanitize, _task_fingerprint
else:
    from . import (author_form, author_structure, custom_logic_jobs, task_catalog,
                   util, workspace)
    from .engine import ACTION_TYPE_KO, _sanitize, _task_fingerprint

PENDING = "__미정__"

# 질답 채널(채팅/HTML 폼)별 프리앰블 + 공유 적용 규칙 — 최종 상수는 이 둘의 연결이다.
# 적용 규칙을 공유해야 폼으로 받은 답도 채팅 답과 같은 규칙으로 JSON에 반영된다.
_CHAT_PREAMBLE = (
    "AI 에이전트: 아래 questionnaire를 **한 번의 채팅 메시지로 그대로** 사용자에게 보여주고 답을 받아라. "
    "질문 번호는 '노드번호-질문번호'다(예: 3-2 = 3번 노드의 2번째 질문) — 사용자가 "
    "'1-1. oo 3-2. 그대로'처럼 번호로 답하면 해당 노드의 항목에 대응시켜라. "
    "ask_user 도구 사용 금지 — 노드 정보 질답은 전부 채팅으로 한다(도구는 한 줄·200자 제한). ")

_APPLY_RULES = (
    "답을 받으면 JSON을 수정(Edit)하라: 확인된 노드는 io_confirmed를 true로, 확인이 끝난 "
    "automation_note는 삭제, 출력 필드를 바꿨으면 그 필드를 참조하는 다른 노드의 source도 함께 수정. "
    "'자동 전달'로 표시된 입력 연결은 사용자가 바꾸자고 하지 않는 한 지우지 마라 — "
    "지우면 실행 때 사용자가 같은 값을 다시 타이핑하게 된다. "
    "'추천:'이 붙은 문구는 사용자가 그대로 쓰겠다고 하면 사용해도 된다. "
    "사실값(endpoint·명령어·인증 이름·경로)은 절대 추정하지 마라 — 답이 없으면 그 항목만 다시 물어라. "
    "file_read에서 사용자가 폴더+파일 힌트를 선택하면 path 키를 지우고 directory와 file_hint를 채워라"
    "(둘 다 사용자가 준 값만 — 실행 때 엔진이 llm_find_file로 정지해 AI가 폴더에서 파일을 찾는다). "
    "file_read에서 'manual'을 선택하면 path 키를 지우고 method를 manual로 바꾸고 "
    "확인받은 안내문(추천 그대로 가능)을 manual_guide에 채워라 — 안내문 없이 지어 넣는 것 금지. "
    "실행 방식이 mcp면 mcp_server(서버 이름)와 mcp_instruction(지시문 — 입력값 자리는 "
    "{필드명} 표기)을 채워라 — 서버 이름은 사실값이라 추정 금지, 불명확하면 되물어라. "
    "decision의 판단 기준은 항상 파일로 관리한다 — 질문지에 표시된 표준 판단 폴더"
    "(workflows/<활동>/decisions/<task이름>__<노드이름>/)를 만들고 그 안의 main_prompt.md에 "
    "질문지의 추천 초안(md)을 Write한 뒤 prompt 키를 지우고 prompt_file에 그 파일 경로를, "
    "references에 그 폴더 경로를 채워라(파일이 이미 있으면 덮어쓰기 전에 사용자에게 확인). "
    "답이 '판단 기준 입력'이고 detail에 사용자가 준 내용이 있으면 다른 문구를 덧붙이거나 "
    "재작성하지 말고 detail 원문 전체를 그대로 main_prompt.md로 만들어라. 작성한 파일 "
    "내용을 채팅에 그대로 보여주고 경로를 안내하라. 가이드가 없으면(또는 답이 "
    "'추천 초안 사용'/'그대로'면) 초안 그대로 만들고, 괄호 안내가 남아 있으면 사용자에게 "
    "그 파일을 열어 실행 전까지 직접 채워 달라고 안내하라. "
    "판단 폴더는 참조자료 폴더를 겸한다 — 과거 사례·기준 문서를 그 폴더에 넣어두면 실행 때 "
    "AI가 직접 읽고 판단에 반영한다고 사용자에게 안내하라(main_prompt.md는 참조 목록에서 "
    "자동 제외된다). "
    "'커스텀 로직' 답(고급, 기본은 '사용 안 함')이면 함께 받은 로직 설명을 근거로: "
    "① 질문지에 표시된 로직 폴더(workflows/<활동>/logic/<task이름>__<노드이름>/)를 만들고 "
    "LOGIC.md를 작성하라 — 사용자의 로직 설명(원문 보존)·노드 목적·입력/출력 필드 계약과 "
    "실행 계약을 담는다. 실행 계약: run.py는 stdin으로 {\"inputs\": {필드: 값}, "
    "\"outputs\": [필드id 목록], \"key\": 건ID}(후속 If가 참조하는 판단 노드면 \"labels\" "
    "배열 포함 — 라벨 없는 산출형 판단은 미포함) JSON을 받고, stdout에는 {\"output\": "
    "{필드id: 값}}(stdin에 labels가 있으면 \"label\"도 포함 — 없으면 label을 내지 마라) "
    "JSON 객체 하나만 출력한다 — 로그·중간 출력은 stderr로, 인코딩 UTF-8, 제한 시간 120초, "
    "상대경로 기준은 리포 루트이며 자기 폴더 접근은 __file__ 기준. "
    "task JSON과 설명에 없는 사실값을 LOGIC.md에 지어 넣지 마라. "
    "② 같은 폴더에 run.py를 작성하라 — LOGIC.md 사양을 실행 계약대로 구현한다. 사용자 "
    "설명을 코드로 옮기는 것이며, 설명에 없는 사실값(경로·주소·명령어)이 필요하면 지어내지 "
    "말고 되물어라. 로직 설명이 없으면 run.py를 만들지 말고 설명부터 받아라. "
    "③ python ops_runtime/logic_draft.py mark <로직폴더> 를 실행해 run.py를 AI 초안으로 "
    "표시하라. ④ 노드의 custom_logic에 그 폴더 경로를 채워라. "
    "그 노드의 타입별 미정 필드(method·prompt·path 등)는 값을 채우지 말고 키 자체를 "
    "지워라 — 단 후속 If가 참조하는 판단(decision)의 labels는 지우지 마라(엔진이 run.py가 "
    "낸 라벨을 labels와 대조해 분기한다). If가 참조하지 않는 판단(산출형)은 labels가 "
    "없어도 되며 run.py는 label 없이 output만 낸다. "
    "⑤ 사용자에게 안내하라: run.py는 AI가 작성한 초안이라 검증에서 "
    "'검토 후 실행' 안내가 뜬다 — 코드를 수정하면(표현만 고쳐도) 검토로 간주되고, 수정 "
    "없이 확정하려면 python ops_runtime/logic_draft.py approve <로직폴더> 로 확정 처리한다. "
    "이 단계에서 사용자가 노드 구성(추가·삭제·순서·분기)을 바꾸자고 하면 SKILL.md 수정 모드 "
    "규칙대로 JSON을 편집한 뒤 이 명령을 다시 실행해 새 질문지를 받아라. "
    "labels 답이 {from, to} 쌍(이름 변경)이면 decision의 labels에서 from을 to로 바꾸고, "
    "후속 If의 cases[].value 중 from과 같은 값도 함께 to로 바꿔라(검증기가 집합 일치를 "
    "강제한다). prompt나 prompt_file 내용에 그 라벨 문자열이 있으면 확인해 함께 수정하라. "
    "from이 현재 labels에 없으면 낡은 질문지다 — 적용하지 말고 이 명령을 다시 실행하라. "
    "라벨 추가·삭제는 질문지 폼이 최종 배열로 받아 적용기가 처리한다 — 채팅 답으로는 이름 "
    "변경만 받고, 추가·삭제 요청이 오면 폼을 재생성해 폼에서 진행하게 하라. "
    "후속 If가 참조하지 않는 판단은 산출형이다 — 라벨 질문이 나오지 않으며 labels가 "
    "없어도 된다. 그 노드의 labels가 \"__미정__\" 마커로만 남아 있으면(구버전 초안) 질문 "
    "없이 labels 키를 삭제하라. 산출형은 판단 결과를 담을 출력 필드(outputs)가 반드시 "
    "있어야 한다(없으면 검증 불합격). "
    "수정 후 /e2e-agent-validator를 실행하고, 미정 항목이 남았으면 이 명령을 다시 실행해 새 질문지를 받아라.")

INSTRUCTION = _CHAT_PREAMBLE + _APPLY_RULES


def _is_pending(v):
    return v == PENDING or (isinstance(v, str) and PENDING in v)


def _node_label(node):
    ko = ACTION_TYPE_KO.get(node.get("action_type"))
    name = node.get("name") or node.get("id", "")
    return f"[{ko}] {name}" if ko else name


def _names(fields):
    return ", ".join(f.get("name") or f.get("id", "?") for f in fields) or "(없음)"


_SYS_HINT_RE = re.compile(r"\[시스템: ([^\]]+)\]")


def _single_system_name(node):
    """단일 시스템 노드는 변환기가 description에 '[시스템: 이름]' 힌트를 남긴다."""
    m = _SYS_HINT_RE.search(node.get("description") or "")
    return m.group(1) if m else None


def _guide_suggestion(node, system_name=None):
    at = node.get("action_type")
    where = f"{system_name}에서 " if system_name else ""
    outs = _names(node.get("outputs") or [])
    if at == "system_read":
        return f"{where}아래 항목이 보이는 화면을 열어 통째로 복사해 붙여넣어 주세요: {outs}"
    if at == "system_write":
        return f"{where}위 데이터를 직접 입력해 주세요."
    return None


_NOTE_METHODS_RE = re.compile(r"방식:\s*(.+)$")

_SYSTEM_METHOD_POLICIES = {
    "jsm": {
        "label": "JSM",
        "default": "manual",
        "recommendation": "JSM: 수동 권장",
    },
    "confluence": {
        "label": "Confluence",
        "default": "mcp",
        "recommendation": "Confluence: MCP 권장",
    },
}


def _system_method_policy(system_name):
    """알려진 시스템의 표시 이름과 권장 실행 방식을 반환한다.

    시스템 identity는 답변 적용 시 원문 이름과 정확히 대조하므로 여기서는 바꾸지
    않는다. trim+casefold한 정확한 시스템 토큰에만 정책을 적용해 비슷한 이름의
    다른 시스템까지 잘못 추천하지 않는다.
    """
    if not isinstance(system_name, str):
        return None
    return _SYSTEM_METHOD_POLICIES.get(system_name.strip().casefold())


def _note_methods(note):
    """automation_note 파싱 — 형식 계약은 yaml_to_task._note()가 생산하는 문자열:
    'YAML 표기: 자동화 가능 — 방식: a, b' / 'YAML 표기: 자동화 불가 — 사유'."""
    if not note:
        return None, []
    if "자동화 불가" in note:
        return "impossible", []
    m = _NOTE_METHODS_RE.search(note)
    methods = [
        s.strip().casefold()
        for s in m.group(1).split(",")
        if s.strip()
    ] if m else []
    return "possible", methods


def _method_default(note):
    """YAML에 기록된 실행 가능 방식으로 HTML 폼의 기본 선택을 정한다.

    실행 불가로 표시된 경우에는 manual을 선택한다. 실행 가능한 방식에 api가 있으면
    api를, api 없이 mcp가 있으면 mcp를 선택한다. 지원 여부가 불분명하면 선택하지 않는다.
    """
    kind, methods = _note_methods(note)
    if kind == "impossible":
        return "manual"
    if kind == "possible" and "api" in methods:
        return "api"
    if kind == "possible" and "mcp" in methods:
        return "mcp"
    return None


def _method_q(node, cfg, system_name=None, task=None):
    """실행 방식이 미정인 노드/시스템의 질문 객체 (방식별 상세는 공통 안내에).

    input_sources/output_fields는 폼의 구조화 api 상세용 — 요청 파라미터의 '입력
    필드 전달' select와 출력별 응답 추출 행을 도구 산출물로 그린다(즉흥 금지)."""
    note = cfg.get("automation_note")
    policy = _system_method_policy(system_name)
    system_label = policy["label"] if policy else system_name
    nodes_by_id = {
        item.get("id"): item
        for item in (task or {}).get("nodes") or []
        if isinstance(item, dict) and item.get("id")
    }
    seen, sources = set(), []
    for i in node.get("inputs") or []:
        f = i.get("field")
        source = i.get("source", "")
        identity = (f, source)
        if f and identity not in seen:
            seen.add(identity)
            label = f
            match = _NODE_SRC_RE.match(source)
            if match and match.group(1) in nodes_by_id:
                producer = nodes_by_id[match.group(1)]
                output = next(
                    (item for item in producer.get("outputs") or []
                     if item.get("id") == match.group(2)),
                    None,
                )
                output_name = (
                    (output or {}).get("name")
                    or (output or {}).get("id")
                    or f
                )
                label = (
                    f"{producer.get('name') or producer.get('id')} · "
                    f"{output_name}"
                )
            elif source == "$.key":
                label = "건 ID"
            elif _EXTERNAL_SRC_RE.match(source):
                label = f"실행 입력 · {f}"
            sources.append({"field": f, "source": source, "label": label})
    return {"qtype": "method_choice", "target": "method", "system": system_name,
            "system_label": system_label,
            "note": note, "choices": ["mcp", "manual", "command", "api"],
            "default": policy["default"] if policy else _method_default(note),
            "recommendation": policy["recommendation"] if policy else None,
            "suggestion": _guide_suggestion(node, system_label),
            "manual_copy_automation_allowed": (
                node.get("action_type") == "system_read"),
            "input_sources": sources,
            "output_fields": [{"id": o.get("id"), "name": o.get("name") or o.get("id")}
                              for o in node.get("outputs") or [] if o.get("id")]}


def _guide_q(prefix_system, suggestion):
    """수동 안내문 질문 객체 — prefix_system은 시스템 단위 질문일 때만 이름 표기."""
    return {"qtype": "manual_guide", "target": "manual_guide",
            "system": prefix_system, "suggestion": suggestion}


def _render_method(q):
    """실행 방식 질문 텍스트.

    한 줄에 다 붙이면 읽기 어렵다는 실사용 피드백 — 표기·추천을 줄로 나눈다.
    알려진 시스템은 대소문자나 YAML 가능성 표기 대신 제품 권장을 간결하게
    보여주고, 그 외 시스템만 YAML 원본 표기를 보여준다.
    """
    system_label = q.get("system_label") or q.get("system")
    target = f"({system_label}) " if system_label else ""
    lines = [f"{target}실행 방식은? — api / command / mcp / manual"]
    note = q.get("note")
    recommendation = q.get("recommendation")
    if recommendation:
        lines.append(f"※ {recommendation}")
    elif note and "자동화 불가" in note:
        lines.append(f"※ {note} → manual 추정, 확인 필요")
    elif note:
        lines.append(f"※ {note}")
    if q.get("suggestion"):
        lines.append("manual이면 추천 안내문 (그대로/수정):")
        lines.append(f'  "{q["suggestion"]}"')
    return "\n".join(lines)


def _render_guide(q):
    prefix = f"({q['system']}) " if q.get("system") else ""
    if not q.get("suggestion"):
        return f"{prefix}수동 안내문을 알려주세요"
    return f'{prefix}수동 안내문 · 추천 (그대로/수정):\n  "{q["suggestion"]}"'


def _std_name(task, node):
    """표준 프롬프트 파일/참고 폴더의 이름 — <task이름>__<노드이름>.

    실사용 피드백: <task_id>__<노드id>(예: activity_2_task_1__decide_3_copy_1_copy_2_1)는
    사람이 읽고 관리할 수 없다. 노드 이름은 중복될 수 있으므로 같은 task 안의 동명
    노드는 nodes 배열 순서 기준 _2, _3 접미로 구분한다(결정적)."""
    tname = _sanitize(task.get("task_name") or task.get("task_id", ""))
    nname = node.get("name") or node.get("id", "")
    seq = 0
    for n in task.get("nodes", []):
        if (n.get("name") or n.get("id", "")) == nname:
            seq += 1
        if n.get("id") == node.get("id"):
            break
    suffix = f"_{seq}" if seq > 1 else ""
    return f"{tname}__{_sanitize(nname)}{suffix}"


def _std_paths(task, node, base_dir=None):
    """decision 노드의 표준 판단 파일과 자료 폴더 경로를 만든다.

    판단 기준 ``main_prompt.md``와 참고 자료는 같은 폴더에 둔다. 반환값은
    ``(저장 경로, 폴더 경로, 표시 경로, 표시 폴더)``이며 슬래시 표기를 사용한다.
    """
    base = os.path.abspath(
        base_dir or os.path.join("workflows", _sanitize(task.get("activity", ""))))
    name = _std_name(task, node)
    folder_abs = os.path.join(base, "decisions", name)
    task_hint = os.path.join(base, "task.json")
    folder = workspace.project_relative(folder_abs, task_hint).rstrip("/") + "/"
    folder_display = folder_abs.replace("\\", "/").rstrip("/") + "/"
    return (folder + "main_prompt.md", folder,
            folder_display + "main_prompt.md", folder_display)


def _logic_paths(task, node, base_dir=None):
    """custom_logic 노드의 표준 로직 폴더 경로를 만든다.

    task JSON과 같은 활동 폴더의 ``logic/`` 아래에 두며, 반환 경로는 슬래시로 끝난다.
    """
    base = base_dir or os.path.join("workflows", _sanitize(task.get("activity", "")))
    return os.path.join(base, "logic", _std_name(task, node)).replace("\\", "/") + "/"


def _custom_logic_question(task, node, base_dir=None):
    """신규·수정 상세 편집기가 공유하는 커스텀 로직 질문을 만든다."""
    current = node.get("custom_logic")
    current = current if isinstance(current, str) and not _is_pending(current) else None
    logic_dir = current or _logic_paths(task, node, base_dir)
    task_hint = os.path.join(
        os.path.abspath(base_dir or os.path.join(
            "workflows", _sanitize(task.get("activity", "")))),
        (task.get("task_id") or "task") + ".json",
    )
    try:
        actual = custom_logic_jobs.resolve_logic_folder(task_hint, logic_dir)
        fingerprint = custom_logic_jobs.asset_fingerprint(actual) if current else None
        display = actual.replace("\\", "/").rstrip("/") + "/"
    except (OSError, ValueError, PermissionError):
        fingerprint = None
        display = str(logic_dir).replace("\\", "/")
    return {
        "qtype": "custom_logic_opt",
        "target": "custom_logic",
        "logic_dir": logic_dir,
        "logic_dir_display": display,
        "current_custom_logic": current,
        "asset_fingerprint": fingerprint,
        "revision": bool(current),
        "current_answer": (
            {"value": "커스텀 로직 유지"} if current
            else {"value": "사용 안 함"}
        ),
    }


_DATEISH_RE = re.compile(r"날짜|일자|예정일|기한|일정|date", re.IGNORECASE)


def _decision_prompt_draft(task, node):
    """task JSON에 기록된 정보만 사용해 판단 프롬프트 초안을 만든다.

    판단 근거가 없는 값은 추측하지 않고 null로 남기도록 안내한다.
    """
    name = node.get("name") or node.get("id", "")
    desc = node.get("description") or name
    labels = [x for x in (node.get("labels") or []) if x and not _is_pending(x)]
    # 배선상 같은 필드가 여러 source로 들어올 수 있다 — 초안에는 한 번만
    inputs = list(dict.fromkeys(i.get("field", "?") for i in node.get("inputs") or []))
    outputs = node.get("outputs") or []
    lines = [f"# 판단: {name}", "", "## 목적", desc, "", "## 입력"]
    if inputs:
        lines.extend(f"- {f}" for f in inputs)
    else:
        lines.append("(없음)")
    lines += ["", "## 판단 기준",
              "입력과 참고 자료에 명시된 사실만 근거로 목적에 맞게 판단하라. 필요한 "
              "정보가 없으면 임의로 보완하지 말고 해당 출력은 null로 두고 판단 근거에 "
              "정보 부족 사실을 명시하라."]
    if len(labels) >= 2:
        lines += ["", "## 라벨 선택 기준"]
        lines.extend(f"- \"{lb}\": 입력과 참고 자료에 이 조건을 뒷받침하는 사실이 "
                     "명시되어 있을 때만 선택한다. 라벨 문구만 보고 조건 충족을 추정하지 않는다."
                     for lb in labels)
    else:
        # 라벨 1개(방침결정형)와 0개(산출형) 공통 — 결과는 출력 필드로 후속 전달
        lines += ["", "## 방침 작성 지침",
                  "판단 결과는 후속 노드가 그대로 사용한다 — 무엇을 어떻게 처리할지 "
                  "구체적으로 서술하라."]
    if outputs:
        lines += ["", "## 출력 필드"]
        lines.extend(f"- {f.get('name') or f.get('id', '?')}: 입력·참고 자료에 같은 값이 "
                     "명시되어 있으면 추출한다. 새 값을 계산·산정하려면 판단 기준에 "
                     "계산 규칙이 명시되어 있어야 하며, 근거가 없으면 null"
                     for f in outputs)
        if any(_DATEISH_RE.search(f.get("name") or "") for f in outputs):
            lines.append("- 날짜·기한 필드는 실행 시점(오늘)을 기준으로 산정하라 — "
                        "과거 날짜를 예정일로 쓰지 마라.")
    lines += ["", "## 근거 기록",
              "선택한 라벨의 근거와 null이 아닌 각 출력의 근거를 입력·참고 자료의 "
              "구체적인 필드 또는 문장으로 기록하라. 근거를 기록할 수 없으면 값을 만들지 마라."]
    return "\n".join(lines)


_NODE_SRC_RE = re.compile(r"^\$\.nodes\.([^.]+)\.output\.(.+)$")
_EXTERNAL_SRC_RE = re.compile(r"^\$\.inputs_from\.(.+)$")


def _input_desc(spec, names_by_id, nos_by_id=None, external_by_name=None):
    """입력 하나의 출처 구조 — 배선(이전 노드 출력 연결)이 있으면 출처를 밝힌다.

    실측: 배선이 저작 때 지워져 사용자가 직전 노드가 낸 값을 다시 타이핑했다.
    출처가 보여야 '유지'가 기본 선택이 된다. 문자열이 아니라 객체를 반환해야
    폼이 표(필드|출처 배지)로, 채팅이 한 줄(_input_line)로 각자 렌더할 수 있다.

    반환에는 원본 source를 포함한다. removed는 구조 편집으로 생산자가 삭제되어
    임시 외부 입력으로 보존된 상태다.
    """
    field = spec.get("field", "?")
    src = spec.get("source", "")
    m = _NODE_SRC_RE.match(src)
    if m and m.group(1) in names_by_id:
        return {"field": field, "kind": "prev", "source": src,
                "node_no": (nos_by_id or {}).get(m.group(1)),
                "node_name": names_by_id[m.group(1)], "output_id": m.group(2)}
    if src == "$.key":
        return {"field": field, "kind": "key", "source": src}
    em = _EXTERNAL_SRC_RE.match(src)
    if em:
        root = (external_by_name or {}).get(em.group(1)) or {}
        if root.get("source_status") == "removed_producer":
            kind = "removed"
        elif all(root.get(key) for key in ("from_task", "from_node", "from_field")):
            kind = "previous_task"
        else:
            kind = "external"
        return {"field": field, "kind": kind, "source": src,
                "previous_source": root.get("previous_source"),
                "previous_node_name": root.get("description"),
                "from_task": root.get("from_task"),
                "from_node": root.get("from_node"),
                "from_field": root.get("from_field")}
    return {"field": field, "kind": "plain", "source": src}


def _input_line(d):
    """구조화된 입력 출처 → 채팅 질문지 한 줄. 출처 노드는 번호로 짚을 수 있게
    '[3. 유관 코드 판단]' 표기(섹션 번호와 동일 순번)."""
    if d["kind"] == "prev":
        no = f"{d['node_no']}. " if d.get("node_no") else ""
        return f"{d['field']} ← [{no}{d['node_name']}]의 출력 (자동 전달 — 유지 권장)"
    if d["kind"] == "key":
        return f"{d['field']} ← 건ID (자동 전달)"
    if d["kind"] == "external":
        return f"{d['field']} ← 시작 시 사용자에게 묻는 외부 입력"
    if d["kind"] == "previous_task":
        producer = d.get("previous_node_name") or "선행 작업"
        return f"{d['field']} ← 이전 task [{producer}]의 출력 (자동 전달 — 유지 권장)"
    if d["kind"] == "removed":
        return f"{d['field']} ← 삭제된 노드에서 전달받던 입력 — 수정 필요"
    return d["field"]


def _generation_prompt_draft(node):
    """task에 이미 있는 정보만으로 file_write 생성 프롬프트 초안을 만든다."""
    name = node.get("name") or node.get("id", "문서")
    desc = node.get("description") or f"{name}을 작성한다."
    inputs = list(dict.fromkeys(i.get("field", "?") for i in node.get("inputs") or []))
    outputs = [o.get("name") or o.get("id", "?") for o in node.get("outputs") or []]
    lines = [f"# {name} 생성 지시", "", "## 목적", desc, "", "## 입력 자료"]
    lines.extend(f"- {value}" for value in inputs) if inputs else lines.append("- (없음)")
    lines += ["", "## 작성 지침",
              "- 입력 자료에 있는 내용만 근거로 작성한다.",
              "- 확인할 수 없는 값은 임의로 만들지 말고 미확인으로 표시한다.",
              "", "## 결과"]
    lines.extend(f"- {value}" for value in outputs) if outputs else lines.append(f"- {name}")
    return "\n".join(lines)


def _node_questions(task, node, names_by_id, base_dir=None):
    """노드 하나의 질문 객체 리스트 (미정 없으면 빈 리스트).

    채팅 질문지(_render_q)와 HTML 폼(author_form)이 같은 객체를 소비한다 —
    질문의 단일 소스. 문자열이 아니라 객체를 반환해야 폼이 위젯·기본값을
    만들 수 있다.
    """
    qs = []
    at = node.get("action_type")
    nos_by_id, _no = {}, 0
    for n in task.get("nodes", []):
        if n.get("type") == "if":
            continue
        _no += 1
        nos_by_id[n.get("id")] = _no

    def io_q():
        roots = {r.get("name"): r for r in task.get("inputs_from") or []
                 if isinstance(r, dict) and r.get("name")}
        source_options = [
            {"value": "__external__", "label": "실행 시작 시 사용자 입력", "kind": "external"},
            {"value": "$.key", "label": "건 ID", "kind": "key"},
        ]
        for candidate in task.get("nodes") or []:
            if candidate is node:
                break
            if candidate.get("type") == "if":
                continue
            cno = nos_by_id.get(candidate.get("id"))
            candidate_outputs = candidate.get("outputs") or []
            output_name_counts = {}
            for output in candidate_outputs:
                output_name = output.get("name") or output.get("id")
                output_name_counts[output_name] = (
                    output_name_counts.get(output_name, 0) + 1)
            output_name_seen = {}
            for output in candidate_outputs:
                oid = output.get("id")
                if not oid:
                    continue
                oname = output.get("name") or oid
                output_name_seen[oname] = output_name_seen.get(oname, 0) + 1
                display_name = oname
                if output_name_counts.get(oname, 0) > 1:
                    display_name += f" · {output_name_seen[oname]}번째"
                source_options.append({
                    "value": f"$.nodes.{candidate.get('id')}.output.{oid}",
                    "label": (
                        f"[{cno}. {candidate.get('name') or candidate.get('id')}]의 "
                        f"{display_name} 출력"),
                    "kind": "prev",
                })
        return {"qtype": "io_confirm", "target": "io_confirmed",
                "inputs": [_input_desc(i, names_by_id, nos_by_id, roots)
                           for i in node.get("inputs") or []],
                "outputs": [{"id": f.get("id"), "name": f.get("name") or f.get("id", "?")}
                            for f in node.get("outputs") or []],
                "source_options": source_options}

    needs_read_output = at in ("system_read", "file_read") and not node.get("outputs")

    if node.get("custom_logic") and not _is_pending(node.get("custom_logic")):
        # 커스텀 로직 노드 — 엔진이 핸들러 대신 run.py를 실행하므로 타입별
        # 세부 필드는 쓰이지 않는다. 입출력이 곧 실행 계약이라 확인만 남긴다.
        if _is_pending(node.get("io_confirmed")) or needs_read_output:
            qs.append(io_q())
        return qs

    # 입력/출력 확인이 모든 타입 질문보다 먼저다 — 실행 방식의 추천 안내문 등
    # 뒤 질문들이 출력 필드에서 파생되므로, 입출력을 먼저 확정받아야 순서가 맞다
    # (실사용 피드백 260716).
    if _is_pending(node.get("io_confirmed")) or needs_read_output:
        qs.append(io_q())

    if _is_pending(node.get("method")):
        qs.append(_method_q(
            node, node, _single_system_name(node), task))
    for s in node.get("systems") or []:
        if _is_pending(s.get("method")):
            qs.append(_method_q(
                node, s, s.get("name", "?"), task))
        elif s.get("method") == "manual" and _is_pending(s.get("manual_guide")):
            qs.append(_guide_q(s.get("name"), _guide_suggestion(node, s.get("name"))))
    if node.get("method") == "manual" and _is_pending(node.get("manual_guide")):
        qs.append(_guide_q(None, _guide_suggestion(node, _single_system_name(node))))

    if at == "decision":
        labels = node.get("labels") or []
        # 라벨은 후속 If의 분기 근거일 때만 존재 의미가 있다. If가 참조하지
        # 않는 판단은 산출형(라벨 없음)이므로 라벨 질문 자체를 내지 않는다.
        referenced = node.get("id") in {n.get("source_node")
                                        for n in task.get("nodes", [])
                                        if n.get("type") == "if"}
        if _is_pending(node.get("prompt")) and not node.get("prompt_file"):
            prompt_path, decision_dir, prompt_display, decision_display = _std_paths(
                task, node, base_dir)
            qs.append({"qtype": "decision_prompt", "target": "prompt",
                       "suggestion": _decision_prompt_draft(task, node),
                       "prompt_path": prompt_path, "decision_dir": decision_dir,
                       "prompt_path_display": prompt_display,
                       "decision_dir_display": decision_display})
        if referenced:
            if not labels or any(_is_pending(x) for x in labels):
                # 손저작 초안이 labels 키를 빠뜨렸어도 If 연동이면 회수해야 한다
                qs.append({"qtype": "labels_input", "target": "labels"})
            elif qs or _is_pending(node.get("io_confirmed")):
                # 확정된 라벨도 노드가 질문지에 나오는 한 항상 보여준다 — 폼에서 이름
                # 변경·추가·삭제가 가능하므로 prompt 확정 여부와 무관하게 고칠 기회를
                # 준다. targets(분기 대상 후보)·cases(현재 If 연결)를 함께 실어
                # 폼이 대상 select를 그린다(구성 편집기 targetOptions와 같은 의미).
                ifn = next((n for n in task.get("nodes", [])
                            if n.get("type") == "if"
                            and n.get("source_node") == node.get("id")), None)
                qs.append({"qtype": "labels_fixed", "target": "labels",
                           "labels": labels,
                           "cases": [{"label": c.get("value"), "next": c.get("next")}
                                     for c in (ifn or {}).get("cases", [])],
                           "targets": [{"id": n.get("id"), "no": nos_by_id.get(n.get("id")),
                                        "name": n.get("name") or n.get("id", "")}
                                       for n in task.get("nodes", [])
                                       if n.get("type") != "if"
                                       and n.get("id") != node.get("id")]})
    if at == "consult" and _is_pending(node.get("topic")):
        qs.append({"qtype": "free_text", "target": "topic"})
    if at == "notify_send":
        if _is_pending(node.get("channel")):
            qs.append({"qtype": "notify_channel", "target": "channel",
                       "choices": ["ba_entity", "api", "manual"]})
        if _is_pending(node.get("recipient")):
            qs.append({"qtype": "free_text", "target": "recipient"})
        if _is_pending(node.get("message")):
            qs.append({"qtype": "free_text", "target": "message"})
    if at == "notify_receive" and _is_pending(node.get("guide")):
        qs.append({"qtype": "free_text", "target": "guide"})
    if at == "file_read" and _is_pending(node.get("path")) and not (
            node.get("directory") and node.get("file_hint")):
        # manual 선택 시 쓸 안내문 추천 — 실측: 추천이 없으니 검증 오류 뒤 AI가
        # 안내문을 확인 없이 지어 넣었다. 추천+그대로/수정 확인 구조로 막는다.
        outs = _names(node.get("outputs") or [])
        path_input = next((i.get("field") for i in node.get("inputs") or []
                           if re.search(r"파일\s*경로|file.*path|path", i.get("field") or "",
                                        re.IGNORECASE)), "파일 경로")
        qs.append({"qtype": "file_read_spec", "target": "path",
                   "path_input_suggestion": path_input,
                   "suggestion": f"{outs} 문서를 열어 내용을 통째로 복사해 "
                                 "붙여넣어 주세요."})
    if at == "file_write" and _is_pending(node.get("path")):
        qs.append({"qtype": "file_write_path", "target": "path"})
    if at == "file_write" and _is_pending(node.get("generation_prompt")):
        qs.append({"qtype": "file_write_content", "target": "generation_prompt",
                   "suggestion": _generation_prompt_draft(node),
                   "input_fields": [i.get("field") for i in node.get("inputs") or []]})

    if qs:
        # 예외 탈출구 — 질문이 있는 노드에만, 항상 마지막에. 기본 '사용 안 함'.
        qs.append(_custom_logic_question(task, node, base_dir))
    return qs


# free_text 질문의 문구 — target별 고정. 채팅·폼이 같은 질문을 쓰기 위한 단일 소스다.
_FREE_TEXTS = {
    "topic": "협의 주제는 무엇인가요?",
    "recipient": "수신자는 누구인가요?",
    "message": "보낼 메시지 내용(템플릿)은?",
    "guide": "무엇이 수신되는지 설명해 주세요(재개 때 사용자에게 보여줄 안내)",
    "generation_prompt": "문서를 LLM이 생성해야 하나요? 그렇다면 생성 프롬프트는? (템플릿이면 template로)",
}


def _render_q(q):
    """질문 객체 → 채팅 질문지 텍스트. 문구는 종전 질문지에서 그대로 옮긴 것이다."""
    qt = q["qtype"]
    if qt == "method_choice":
        return _render_method(q)
    if qt == "manual_guide":
        return _render_guide(q)
    if qt == "decision_prompt":
        shown_path = q.get("prompt_path_display") or q["prompt_path"]
        shown_dir = q.get("decision_dir_display") or q["decision_dir"]
        draft = "\n".join("  | " + ln for ln in q["suggestion"].splitlines())
        return (f"판단 기준 프롬프트 — 파일로 관리합니다 (저장 위치: {shown_path})\n"
                "① '추천 초안 사용': 아래 추천 초안 그대로 파일 생성 — 실행 전까지 직접 "
                "수정하셔도 됩니다\n"
                "② '판단 기준 입력': 입력한 내용 전체를 가공하지 않고 판단 기준 파일로 저장합니다\n"
                f"※ 판단 폴더({shown_dir})는 자동 생성됩니다 — 과거 사례·기준 문서를 "
                "이 폴더에 넣어두시면 실행 때 AI가 함께 읽고 판단에 반영합니다\n"
                "추천 초안:\n" + draft)
    if qt == "labels_fixed":
        return (f"라벨(후속 분기와 연동): {', '.join(q['labels'])} — "
                "이름을 바꾸려면 '기존 라벨 → 새 이름'으로, 유지하면 '그대로' "
                "(라벨 추가·삭제는 질문지 폼에서 할 수 있습니다)")
    if qt == "labels_input":
        return ("판단 결과 라벨 — 이 판단의 결과에 따라 흐름이 갈라집니다. 각 갈래의 "
                "이름을 알려주세요 (예: 승인 / 반려). 후속 분기(If)의 조건과 연동됩니다")
    if qt == "notify_channel":
        return "알림 채널은? — ba_entity / api / manual"
    if qt == "file_read_spec":
        return ("읽을 파일을 어떻게 지정할까요? 넷 중 하나로 답해 주세요\n"
                "· 정확한 경로: 지정한 텍스트 파일을 프로그램이 바로 읽습니다 — 파일 경로를 "
                "알려주세요\n"
                "· 실행 시 경로 입력값: 사용자 입력이나 선행 노드 출력에서 경로를 받아 "
                "프로그램이 읽습니다 — 입력 이름을 알려주세요\n"
                "· 폴더에서 찾기: Code Assistant가 폴더와 힌트로 파일을 찾아 경로를 "
                "제출할 때까지 실행이 대기합니다 — 폴더 경로와 파일 힌트를 알려주세요\n"
                "· 내용 직접 붙여넣기: 파일 경로로 접근하기 어려울 때 실행 중 "
                "사용자가 내용을 입력합니다 — 추천 안내문 (그대로/수정):\n"
                f"  \"{q.get('suggestion') or ''}\"")
    if qt == "file_write_path":
        return "실제 파일 경로는? (모르면 manual — 내용 복붙 방식)"
    if qt == "custom_logic_opt":
        return ("(고급) 위 방식(JSON)으로 표현하기 어려운 로직(반복 처리·계산·형식 변환 등)이 "
                "필요한가요? 보통은 '사용 안 함'입니다.\n"
                "'커스텀 로직'이라 답하고 원하는 로직을 설명해 주시면 "
                f"{q['logic_dir']} 폴더에 사양서(LOGIC.md)와 실행 코드(run.py) 초안을 만들어 "
                "연결합니다 — 실행 때 엔진이 run.py를 자동 수행합니다. "
                "이 노드의 위 세부 질문들은 무시됩니다.")
    if qt == "io_confirm":
        lines = ["입력/출력 확인 — 이대로 쓸까요, 고칠까요?"]
        if q["inputs"]:
            lines.append("입력:")
            lines.extend(f"  - {_input_line(d)}" for d in q["inputs"])
        else:
            lines.append("입력: (없음)")
        lines.append("출력: " + (", ".join(o.get("name") or o.get("id", "?")
                                             for o in q["outputs"]) or "(없음)"))
        return "\n".join(lines)
    if qt == "file_write_content":
        return ("문서 작성 방식은? — LLM 생성 또는 template\n"
                "· LLM 생성: 추천 초안을 수정하거나 그대로 사용\n"
                "· template: 입력 필드 이름을 {필드명}으로 넣은 템플릿 본문 작성")
    return _FREE_TEXTS.get(q.get("target"), "")


def _structure_lines(task):
    names = {n.get("id"): (n.get("name") or n.get("id", ""))
             for n in task.get("nodes", [])}
    lines, i = [], 0
    for node in task.get("nodes", []):
        if node.get("type") == "if":
            branches = " / ".join(
                f"'{c.get('value')}' → {names.get(c.get('next')) if c.get('next') else '(종료)'}"
                for c in node.get("cases", []))
            lines.append(f"    (분기) {branches}")
        else:
            i += 1
            lines.append(f"  {i}) {_node_label(node)}")
    return lines


def build_structure_gate(task):
    """세부 설정을 묻기 전에 노드 구성의 유지 또는 변경 여부를 확인한다."""
    return (f"【노드 구성 확인】 {task.get('task_name', task.get('task_id', ''))}\n"
            "초안의 노드 구성입니다. 이 구성/순서 그대로 진행할까요?\n"
            + "\n".join(_structure_lines(task)) + "\n"
            "① 그대로 진행 ② 부분 수정(구성 편집기가 열립니다) "
            "③ 전면 재설계(업무 흐름을 처음부터 설명해 주시면 구성을 새로 만듭니다)")


def collect_questions(task, base_dir=None):
    """모든 노드의 질문을 한 목록으로 만들고 표시 번호를 부여한다.

    ``no``는 폼과 답변 JSON에서 사용하는 전체 일련번호이고, ``node_no``는 If를
    제외한 노드 순번이다. ``disp``는 사용자에게 보여 주는 ``노드-질문`` 번호다.
      고급 옵션(커스텀 로직)은 표시 번호를 차지하지 않는다 — 노드당 질문
      개수를 부풀리지 않기 위해서다(실사용 피드백).
    """
    names_by_id = {n.get("id"): (n.get("name") or n.get("id", ""))
                   for n in task.get("nodes", [])}
    out, counter, node_no = [], 0, 0
    for node in task.get("nodes", []):
        if node.get("type") == "if":
            continue
        node_no += 1
        sub = 0
        for q in _node_questions(task, node, names_by_id, base_dir):
            counter += 1
            q["no"] = counter
            q["node_id"] = node.get("id")
            q["node_label"] = _node_label(node)
            q["node_no"] = node_no
            if q["qtype"] != "custom_logic_opt":
                sub += 1
                q["disp"] = f"{node_no}-{sub}"
            out.append(q)
    return out


def _configured_prompt_question(task, node, base_dir):
    """완성된 판단 노드의 현재 프롬프트를 재수정 질문으로 만든다."""
    prompt_path, decision_dir, prompt_display, decision_display = _std_paths(
        task, node, base_dir)
    configured_path = node.get("prompt_file")
    if isinstance(configured_path, str) and configured_path.strip() and not _is_pending(
            configured_path):
        prompt_path = configured_path.strip()
        task_hint = os.path.join(base_dir or os.getcwd(), "task.json")
        try:
            actual_path = workspace.resolve_project_path(
                prompt_path, task_hint)
            with open(actual_path, encoding="utf-8") as handle:
                content = handle.read()
            prompt_display = actual_path.replace("\\", "/")
        except (OSError, ValueError, PermissionError):
            content = ""
    else:
        content = ""
    references = [
        value for value in (node.get("references") or [])
        if isinstance(value, str) and value.strip()
    ]
    if references:
        decision_dir = references[0]
        task_hint = os.path.join(base_dir or os.getcwd(), "task.json")
        try:
            decision_display = workspace.resolve_project_path(
                decision_dir, task_hint).replace("\\", "/").rstrip("/") + "/"
        except (OSError, ValueError, PermissionError):
            decision_display = decision_dir
    content = content or _decision_prompt_draft(task, node)
    return {
        "qtype": "decision_prompt",
        "target": "prompt",
        "suggestion": content,
        "prompt_path": prompt_path,
        "decision_dir": decision_dir,
        "prompt_path_display": prompt_display,
        "decision_dir_display": decision_display,
        "agent_draft": content,
        "revision": True,
        "current_revision": hashlib.sha256(
            content.encode("utf-8")).hexdigest(),
        "current_answer": {
            "value": "판단 기준 입력",
            "detail": content,
        },
    }


def _configured_method_question(node, cfg, system_name=None, task=None):
    """현재 실행 설정을 보존한 채 다시 고를 수 있는 질문을 만든다."""
    q = _method_q(node, cfg, system_name, task)
    method = cfg.get("method")
    if method not in q["choices"]:
        return None
    q["revision"] = True
    q["default"] = method
    if method == "manual":
        guide = str(cfg.get("manual_guide") or q.get("suggestion") or "")
        url = str(cfg.get("manual_url") or "")
        q["suggestion"] = guide
        q["manual_url"] = url
        q["manual_copy_automation"] = (
            cfg.get("manual_copy_automation") is True)
        detail = {"guide": "그대로"}
        if url:
            detail["url"] = url
        if q["manual_copy_automation"]:
            detail["copy_automation"] = True
        q["current_answer"] = {"value": method, "detail": detail}
    elif method == "command":
        spec = cfg.get("command_spec")
        compat_command = (
            str(spec.get("legacy_shell_command") or "")
            if isinstance(spec, dict) else ""
        )
        program = (
            compat_command or str(spec.get("program") or "")
            if isinstance(spec, dict)
            else str(cfg.get("command") or "")
        )
        q["command_path"] = program
        q["legacy_command"] = (
            bool(compat_command)
            or (not isinstance(spec, dict) and bool(cfg.get("command")))
        )
        q["current_answer"] = {
            "value": method,
            "detail": (
                {"command": program}
                if q["legacy_command"] else {"path": program}
            ),
        }
    elif method == "mcp":
        server = str(cfg.get("mcp_server") or "")
        instruction = str(cfg.get("mcp_instruction") or "")
        q["mcp_server"] = server
        q["mcp_instruction"] = instruction
        q["current_answer"] = {
            "value": method,
            "detail": {
                "server": server,
                "instruction": instruction,
            },
        }
    elif method == "api":
        integration = cfg.get("integration")
        integration = integration if isinstance(integration, dict) else {}
        detail = {
            "endpoint": str(integration.get("endpoint") or ""),
            "http_method": str(
                integration.get("http_method") or "GET").upper(),
        }
        auth = integration.get("auth")
        if isinstance(auth, dict) and auth.get("kind") and auth.get("name"):
            detail["auth"] = {
                "kind": auth["kind"],
                "name": auth["name"],
            }
        request = integration.get("request")
        if isinstance(request, dict) and request:
            detail["request"] = dict(request)
        response_fields = integration.get("response_fields")
        if isinstance(response_fields, dict) and response_fields:
            detail["response_fields"] = dict(response_fields)
        q["api_detail"] = detail
        q["current_answer"] = {"value": method, "detail": detail}
    return q


def _configured_file_read_question(node):
    q = {
        "qtype": "file_read_spec",
        "target": "path",
        "path_input_suggestion": (
            str(node.get("path_input") or "").strip() or "파일 경로"),
        "suggestion": str(node.get("manual_guide") or ""),
        "revision": True,
    }
    if node.get("path") and not _is_pending(node.get("path")):
        q["current_mode"] = "path"
        q["path"] = node["path"]
        answer = {"value": {"mode": "path", "path": node["path"]}}
    elif node.get("path_input"):
        q["current_mode"] = "runtime_path"
        answer = {
            "value": {
                "mode": "runtime_path",
                "path_input": node["path_input"],
            },
        }
    elif node.get("directory") and node.get("file_hint"):
        q["current_mode"] = "folder_hint"
        q["directory"] = node["directory"]
        q["file_hint"] = node["file_hint"]
        answer = {
            "value": {
                "mode": "folder_hint",
                "directory": node["directory"],
                "file_hint": node["file_hint"],
            },
        }
    elif node.get("method") == "manual":
        q["current_mode"] = "manual"
        answer = {"value": "manual", "detail": "그대로"}
    else:
        return None
    q["current_answer"] = answer
    return q


def _revision_node_questions(task, node, base_dir=None, include_custom=False):
    """완성된 노드에서 상세 설정 편집기가 지원하는 현재값 질문만 만든다."""
    questions = []
    action_type = node.get("action_type")
    has_custom_logic = bool(
        node.get("custom_logic") and not _is_pending(node.get("custom_logic")))

    # 커스텀 로직 사용 중에도 같은 상세 화면에서 표준 실행으로 되돌릴 수 있어야 한다.
    # 현재 custom_logic과 배타적이라 빠져 있는 표준 필드만 미정으로 채운 복사본으로
    # 기존 질문 생성기를 재사용한다. 실제 Task는 건드리지 않는다.
    if has_custom_logic:
        if not include_custom:
            return []
        standard_task = copy.deepcopy(task)
        standard_node = next(
            item for item in standard_task.get("nodes") or []
            if item.get("id") == node.get("id"))
        standard_node.pop("custom_logic", None)
        if action_type in ("system_read", "system_write"):
            if standard_node.get("systems"):
                for system in standard_node.get("systems") or []:
                    if isinstance(system, dict):
                        system.setdefault("method", PENDING)
            else:
                standard_node.setdefault("method", PENDING)
        elif action_type == "decision":
            if not standard_node.get("prompt_file"):
                standard_node["prompt"] = PENDING
        elif action_type == "consult":
            standard_node.setdefault("topic", PENDING)
        elif action_type == "notify_send":
            for key in ("channel", "recipient", "message"):
                standard_node.setdefault(key, PENDING)
        elif action_type == "notify_receive":
            standard_node.setdefault("guide", PENDING)
        elif action_type == "file_read":
            standard_node.setdefault("path", PENDING)
        elif action_type == "file_write":
            standard_node.setdefault("path", PENDING)
            standard_node.setdefault("generation_prompt", PENDING)
        names_by_id = {
            item.get("id"): (item.get("name") or item.get("id", ""))
            for item in standard_task.get("nodes") or []
        }
        questions.extend(
            question for question in _node_questions(
                standard_task, standard_node, names_by_id, base_dir)
            if question.get("qtype") not in ("io_confirm", "custom_logic_opt")
        )
        questions.append(_custom_logic_question(task, node, base_dir))
        return questions

    if action_type in ("system_read", "system_write"):
        configured = _configured_method_question(
            node, node, _single_system_name(node), task)
        if configured:
            questions.append(configured)
    for system in node.get("systems") or []:
        if not isinstance(system, dict):
            continue
        configured = _configured_method_question(
            node, system, system.get("name", "?"), task)
        if configured:
            questions.append(configured)

    if action_type == "decision" and (
            node.get("prompt_file")
            and not _is_pending(node.get("prompt_file"))):
        questions.append(_configured_prompt_question(
            task, node, base_dir))
    if action_type == "consult" and not _is_pending(node.get("topic")):
        value = str(node.get("topic") or "")
        questions.append({
            "qtype": "free_text",
            "target": "topic",
            "default_value": value,
            "revision": True,
            "current_answer": {"value": value},
        })
    if action_type == "notify_send":
        channel = node.get("channel")
        if channel and not _is_pending(channel):
            questions.append({
                "qtype": "notify_channel",
                "target": "channel",
                "choices": ["ba_entity", "api", "manual"],
                "default": channel,
                "revision": True,
                "current_answer": {"value": channel},
            })
        for target in ("recipient", "message"):
            value = node.get(target)
            if value is not None and not _is_pending(value):
                questions.append({
                    "qtype": "free_text",
                    "target": target,
                    "default_value": str(value),
                    "revision": True,
                    "current_answer": {"value": str(value)},
                })
    if action_type == "notify_receive":
        value = node.get("guide")
        if value is not None and not _is_pending(value):
            questions.append({
                "qtype": "free_text",
                "target": "guide",
                "default_value": str(value),
                "revision": True,
                "current_answer": {"value": str(value)},
            })
    if action_type == "file_read":
        configured = _configured_file_read_question(node)
        if configured:
            questions.append(configured)
    if action_type == "file_write":
        path = node.get("path")
        if path and not _is_pending(path):
            questions.append({
                "qtype": "file_write_path",
                "target": "path",
                "default_value": str(path),
                "revision": True,
                "current_answer": {"value": str(path)},
            })
        if node.get("generation_prompt") and not _is_pending(
                node.get("generation_prompt")):
            content = str(node["generation_prompt"])
            questions.append({
                "qtype": "file_write_content",
                "target": "generation_prompt",
                "suggestion": content,
                "agent_draft": content,
                "current_mode": "generate",
                "revision": True,
                "current_answer": {
                    "value": {"mode": "generate", "content": content},
                },
            })
        elif node.get("template") and not _is_pending(node.get("template")):
            content = str(node["template"])
            questions.append({
                "qtype": "file_write_content",
                "target": "generation_prompt",
                "suggestion": "",
                "agent_draft": "",
                "current_mode": "template",
                "current_template": content,
                "revision": True,
                "current_answer": {
                    "value": {"mode": "template", "content": content},
                },
            })
    if include_custom:
        questions.append(_custom_logic_question(task, node, base_dir))
    return questions


def _collect_revision_questions(task, base_dir=None, include_custom=False):
    """재수정 세션용 질문 목록.

    기본 ``collect_questions``는 미정 항목만 수집한다. 이 함수는 그 계약을
    바꾸지 않고, 완료된 현재 설정을 같은 질문지 위젯으로 다시 편집할 수 있게
    보강한다. 설계 화면에서 다룬 입출력·분기는 여기서 중복 질문하지 않는다.
    """
    pending_by_node = {}
    for question in collect_questions(task, base_dir):
        if question.get("qtype") == "io_confirm":
            continue
        pending_by_node.setdefault(question.get("node_id"), []).append(question)

    out, counter, node_no = [], 0, 0
    for node in task.get("nodes", []):
        if node.get("type") == "if":
            continue
        node_no += 1
        combined = list(pending_by_node.get(node.get("id"), []))
        existing = {
            (q.get("qtype"), q.get("target"), q.get("system"))
            for q in combined
        }
        for question in _revision_node_questions(
                task, node, base_dir, include_custom=include_custom):
            identity = (
                question.get("qtype"),
                question.get("target"),
                question.get("system"),
            )
            if identity not in existing:
                combined.append(question)
                existing.add(identity)
        sub = 0
        for question in combined:
            counter += 1
            question["no"] = counter
            question["node_id"] = node.get("id")
            question["node_label"] = _node_label(node)
            question["node_no"] = node_no
            if question.get("qtype") != "custom_logic_opt":
                sub += 1
                question["disp"] = f"{node_no}-{sub}"
            else:
                question.pop("disp", None)
            out.append(question)
    return out


def collect_revision_questions(task, base_dir=None):
    """기존 revision 질문 계약을 유지한다."""
    return _collect_revision_questions(task, base_dir, include_custom=False)


def collect_detail_questions(task, base_dir=None):
    """신규·수정 Connected Creator가 함께 사용하는 전체 상세 질문 모델."""
    return _collect_revision_questions(task, base_dir, include_custom=True)


def build_questionnaire(task, base_dir=None):
    pending = json.dumps(task, ensure_ascii=False).count(PENDING)
    questions = collect_questions(task, base_dir)
    numbered = sum(1 for q in questions if q.get("disp"))
    sections, cur = [], None
    for q in questions:
        if q["node_id"] != cur:
            cur = q["node_id"]
            sections.append(f"■ {q['node_no']}. {q['node_label']}")
        # 고급 옵션(disp 없음)은 번호 대신 불릿 — 질문 개수를 부풀리지 않는다
        prefix = f"  {q['disp']}. " if q.get("disp") else "  · "
        # 여러 줄 질문은 이어지는 줄을 번호에 맞춰 들여쓴다
        sections[-1] += "\n" + prefix + _render_q(q).replace("\n", "\n" + " " * len(prefix))
    # 헤더 숫자는 질문 개수다 — 마커 수를 쓰면 질문 번호 최대값과 어긋난다
    # (실측: "미정 항목 12개"인데 질문은 14번까지 매겨져 혼란)
    header = (f"【초안 생성 질문지】 {task.get('task_name', task.get('task_id', ''))} — "
              f"질문 {numbered}개\n"
              "아래 항목을 채워 주세요. '추천'이 붙은 문구는 그대로 쓰셔도 됩니다.\n"
              "번호는 '노드-질문' 번호입니다 — 답은 \"1-1. api, 주소는 oo  3-2. 그대로\"처럼 "
              "번호별로 한 번에 주시면 됩니다.\n"
              "실행 방식을 고를 때는 다음도 함께 알려주세요 —\n"
              "  · api: 주소(endpoint)·HTTP method·인증 방식과 등록된 참조 이름"
              "(예: 환경변수 BA_TOKEN — 토큰·비밀번호 값은 입력 금지)·"
              "요청 파라미터·응답에서 뽑을 값\n"
              "  · command: 실행할 배치/스크립트 파일 경로 (예: scripts\\조회.bat — 실행 때 "
              "노드 입력값이 순서대로 인자 %1 %2…로 전달되고, 표준출력이 첫 출력 필드에 "
              "저장됩니다)\n"
              "  · mcp: 사용할 MCP 서버 이름과 지시문 — 입력값은 {필드명}으로 쓰면 실행 때 "
              "실제 값으로 치환됩니다 (실행 환경의 AI에 그 MCP 서버가 연결되어 있어야 합니다)\n"
              "  · manual: 사용자에게 보여줄 안내문 (추천이 있으면 그대로 가능)\n")
    return header + "\n\n".join(sections), pending


def build_output(task, base_dir=None, chat=False, task_path=None):
    """task 상태에 맞는 구성 확인 또는 세부 질문지 출력을 만든다.

    구성이 확정되지 않았으면 구성 확인만 반환한다. 세부 설정이 남아 있으면
    ``.ops/ui``에 HTML 폼을 만들며, ``chat=True``일 때만 채팅용 질문지를 사용한다.
    """
    pending = json.dumps(task, ensure_ascii=False).count(PENDING)
    if task_path:
        workspace.ensure_dirs(workspace.project_root(task_path))
    if task.get("structure_confirmed") is False:
        fingerprint = (_task_fingerprint(task_path)
                       if task_path and os.path.isfile(task_path) else None)
        out = {
            "stage": "structure_gate",
            "pending_markers": pending,
            "questionnaire": build_structure_gate(task),
            # ask_user에 넣을 문자열을 도구가 산출한다 — 노드 목록이 도구 질문칸에
            # 우겨넣어져 UI가 깨진 실측 사고의 재발 방지(산문 지시가 아니라 산출물로 강제)
            "gate_question": {
                "question": "이 구성 그대로 진행할까요?",
                "options": ["그대로 진행", "부분 수정", "전면 재설계"],
            },
            "task_fingerprint": fingerprint,
            "next_actions": {
                "confirm": {
                    "type": "confirm_structure",
                    "command": (f'python ops_runtime/author_apply.py confirm-structure '
                                f'"{task_path}" --fingerprint {fingerprint}'
                                if fingerprint else None),
                },
                "edit": {"type": "open_structure_editor"},
                "redesign": {"type": "redesign_structure"},
            },
            "instruction": (
                "노드 목록과 gate_question을 사용자에게 보여주세요. '그대로 진행'이면 "
                "next_actions.confirm.command를 실행하고, '부분 수정'이면 생성된 구성 편집기를 "
                "여세요. 구성 확정 전에는 노드 세부 질문을 시작하지 마세요."
            ),
        }
        if task_path and os.path.isfile(task_path):
            # '부분 수정'용 구성 편집기를 항상 생성해 둔다 — "필요하면 만들라"는
            # 별도 지시는 재실행 경로에서 유실된다(폼 기본화와 같은 교훈).
            # 파일 실존 조건: 편집 결과 적용 시 낡음 판정에 쓸 지문(sha256)이 필요하다.
            out["structure_form_path"] = author_structure.write_editor(task, task_path)
            out["next_actions"]["edit"]["path"] = out["structure_form_path"]
        return out
    questions = collect_questions(task, base_dir)
    if questions and not chat and task_path:
        display_count = sum(1 for q in questions if q.get("disp"))
        advanced_count = len(questions) - display_count
        previous_catalog = task_catalog.build_previous_output_catalog(task, task_path)
        out = {
            "stage": "questionnaire",
            "pending_markers": pending,
            "display_question_count": display_count,
            "advanced_option_count": advanced_count,
            "total_answer_slots": len(questions),
            "previous_task_count": len(previous_catalog.get("tasks") or []),
        }
        if previous_catalog.get("diagnostics"):
            out["previous_task_catalog_diagnostics"] = previous_catalog["diagnostics"]
        out["form_path"] = author_form.write_form(
            task, task_path, questions, previous_task_catalog=previous_catalog)
        out["next_action"] = {
            "type": "open_author_form",
            "path": out["form_path"],
            "submission": "clipboard_paste",
        }
        out["instruction"] = (
            "form_path의 질문지를 브라우저로 열어주세요. 사용자가 확정하면 결과가 "
            "클립보드에 복사되므로 채팅에 붙여넣도록 안내하세요. 자동 복사가 실패하면 "
            "결과 영역의 복사 버튼을 누르거나 텍스트를 직접 복사하도록 안내하세요."
        )
        return out

    text, pending = build_questionnaire(task, base_dir)
    out = {"stage": "questionnaire", "pending_markers": pending}
    if chat:
        out["questionnaire"] = text
        out["instruction"] = INSTRUCTION if questions else (
            "미정 항목이 없습니다 — /e2e-agent-validator를 실행해 검증하라.")
    else:
        out["form_skipped"] = "미정 항목이 없어 폼을 만들지 않았습니다."
        out["next_action"] = {"type": "validate_task"}
        out["instruction"] = "미정 항목이 없습니다. Validator로 최종 검증하세요."
    return out


def main(argv=None):
    util.utf8_stdout()
    p = argparse.ArgumentParser(description="저작 질문지 생성 (AI 에이전트의 /e2e-agent-creator가 실행)")
    p.add_argument("task_json")
    # --form은 구버전 호환 no-op — 질문지 단계는 이제 기본이 폼 생성이다
    p.add_argument("--form", action="store_true", help=argparse.SUPPRESS)
    p.add_argument("--chat", action="store_true",
                   help="채팅 질답용 questionnaire만 출력(폼 미생성) — 폼을 열 수 없는 환경 전용")
    args = p.parse_args(argv)
    task = util.load_json(args.task_json)
    # 표준 경로(prompts/·references/)는 task 파일이 있는 활동 폴더 기준으로 계산한다
    base_dir = os.path.dirname(args.task_json) or None
    print(json.dumps(build_output(task, base_dir, chat=args.chat, task_path=args.task_json),
                     ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
