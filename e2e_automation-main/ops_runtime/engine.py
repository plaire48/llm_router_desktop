# -*- coding: utf-8 -*-
"""task의 자동 노드를 실행하고 사람 또는 AI 작업 경계에서 일시정지하는 엔진.

파이썬 엔진이 자동 실행 가능한 노드를 연속으로 처리하다가, 사람 또는 LLM이 필요한
지점에서 멈추고 JSON("일시정지 프로토콜")을 stdout으로 출력한 뒤 종료한다(펌프 방식).
이 CLI는 전부 AI 에이전트가 실행한다 — 운영담당자가 직접 치지 않는다.

CLI:
  python ops_runtime/engine.py start  <task.json> --key <건ID> [--debug]
  python ops_runtime/engine.py resume <run.json> --node <id> --payload-file <p.json> [--debug]
  python ops_runtime/engine.py status <run.json>
  python ops_runtime/engine.py runs   <task.json>   # 이 task의 기존 건 목록 + 다음 건ID 제안
"""
import argparse
from copy import deepcopy
import datetime
import hashlib
import json
import os
import re
import sys
import time

if __package__ in (None, ""):  # 파일 직접 실행 지원
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from ops_runtime.handlers import HANDLERS, WRITE_TYPES
    from ops_runtime import mutation_lock, references, task_compat, util, workspace
else:
    from .handlers import HANDLERS, WRITE_TYPES
    from . import mutation_lock, references, task_compat, util, workspace

# kind → resume payload에서 읽을 슬롯
KIND_SLOT = {
    "ask_user": "output",
    "ask_user_deferrable": "output",
    "ask_dependency_dummy": "inputs",
    "llm_decision": "label",
    "llm_decision_output": "output",
    "llm_generate": "content",
    "llm_find_file": "path",
    "choose_system": "system",
    "confirm": "confirm",
    "mcp_call": "output",
}

# 일시정지의 실제 수행 주체. Claude/Codex가 kind 설명을 보수적으로 해석해
# agent-owned 작업까지 사용자에게 되묻는 일을 막기 위해 출력 계약에 함께 싣는다.
PAUSE_ACTOR = {
    "ask_user": "user",
    "ask_user_deferrable": "user",
    "ask_dependency_dummy": "user",
    "choose_system": "user",
    "confirm": "user",
    "llm_decision": "agent",
    "llm_decision_output": "agent",
    "llm_generate": "agent",
    "llm_find_file": "agent",
    "mcp_call": "agent",
}

DEFAULT_AUTO_STEPS_PER_PUMP = 500
SUPPORTED_SCHEMA_VERSIONS = {"2.0", "2.1", "2.2"}

# 사용자에게 노드를 표시할 때 쓰는 action_type 한글명 — node id를 사용자에게 노출하지 않는다
ACTION_TYPE_KO = {
    "system_read": "시스템 조회", "system_write": "시스템 실행",
    "file_read": "파일 조회", "file_write": "파일 작성",
    "notify_send": "알림 송신", "notify_receive": "알림 수신",
    "consult": "협의", "decision": "판단",
}

# payload와 run은 사용자 산출물과 분리된 .ops 아래에 두고, payload는 소비 후 삭제한다.
PAYLOADS_DIR = workspace.PAYLOADS_DIR

INSTRUCTIONS = {
    "ask_dependency_dummy": (
        "이전 Task 실행 결과가 없어 Runner가 사용자 입력을 기다립니다. fields의 출처와 설명을 "
        "보여주고, 사용자가 검토한 값을 {\"output\": {필드id: 값}} 형태로 제출하세요. "
        "문자열이 유효한 JSON 객체나 배열이면 구조화 값으로 저장하고 그 밖의 값은 문자열로 "
        "유지합니다. AI 초안은 자동 제출하지 않습니다."
    ),
    "ask_user": ("AI 에이전트: 위 prompt를 사용자에게 채팅으로 질문하라. 자유 입력에 ask_user 도구를 쓰는 것은 "
                 "금지(도구는 선택지형 전용 — 한 줄·200자 제한). 확인할 항목이 여러 개면 항목별로 받지 말고 "
                 "해당 화면/문서 내용을 통째로 붙여넣어 달라고 요청한 뒤 네가 파싱해 필드에 배정하고, 못 찾은 "
                 "필드만 되물어라. fields에 suggested가 있으면 그 값을 보여주고 사용자가 '그대로'라고 "
                 "확인하면 suggested 값을 payload에 넣어라(확인 없이 쓰는 것은 금지). "
                 "사용자에게서 받지 않은 값을 채우는 것은 금지 — 빈 문자열로 채우는 것도 "
                 "금지이며, 사용자가 '없음'이라고 확인한 필드만 null로 보내라. 받은 값을 payload_file 경로에 "
                 "{\"output\": {필드id: 값}}로 저장한 뒤 resume_command를 그대로 실행하라."),
    "ask_user_deferrable": ("AI 에이전트: '지금 입력' / '다음에 재진행' / '미진행(결과 없이 진행)' 중 고르게 하라"
                 "(선택지형이므로 ask_user 도구 사용 가능). 다음에 재진행이면 아무것도 실행하지 "
                 "말고 종료하라(상태는 이미 저장됨). 지금 입력이면 값은 채팅으로 받아 "
                 "{\"output\": {...}}를 payload_file에 저장해 resume_command를 실행하라. "
                 "미진행은 사용자가 명시적으로 선택한 경우에만 — 모든 출력 필드를 null로 채운 "
                 "{\"output\": {...}}로 resume하고, 후속 자동 단계가 빈 값으로 실행될 수 있음을 "
                 "사용자에게 알려라. 값을 임의로 지어내는 것도, 임의로 건너뛰는 것도 금지."),
    "llm_decision": ("AI 에이전트: 네가 직접 위 prompt를 읽고 제시된 라벨 중 하나로만 판단하라. "
                 "prompt에 [참고 자료] 목록이 있으면 판단 전에 그 파일들을 네가 직접 읽어라 — "
                 "읽지 않고 판단하는 것은 금지. "
                 "라벨 목록에 없는 답변은 금지(엔진이 거부한다). fields에 출력 필드가 있으면 판단 "
                 "내용을 그 필드에도 채워라. 근거는 {\"label\": \"입력/자료의 구체적 근거\", "
                 "\"outputs\": {필드id: \"구체적 근거\"}} 형태로 함께 기록하라. "
                 "{\"label\": \"...\", \"output\": {필드id: 값}, \"evidence\": {...}}를 "
                 "payload_file에 저장해 resume_command를 실행하라(출력 필드가 없어도 label과 "
                 "evidence는 필요하다)."),
    "llm_decision_output": ("AI 에이전트: 네가 직접 위 prompt를 읽고 판단하라. prompt에 [참고 자료] 목록이 "
                 "있으면 판단 전에 그 파일들을 네가 직접 읽어라 — 읽지 않고 판단하는 것은 금지. "
                 "이 판단에는 분기 라벨이 없다 — 판단 결과를 fields의 출력 필드에 채워라. "
                 "근거는 {\"summary\": \"판단 근거\", \"outputs\": {필드id: \"구체적 근거\"}}로 "
                 "기록하고 {\"output\": {필드id: 값}, \"evidence\": {...}}를 payload_file에 저장해 "
                 "resume_command를 실행하라. "
                 "입력에 없는 사실을 지어내는 것은 금지."),
    "llm_generate": ("AI 에이전트: 네가 직접 위 prompt대로 내용을 생성하라. {\"content\": \"...\"}를 payload_file에 "
                 "저장해 resume_command를 실행하라. 입력에 없는 사실을 지어내는 것은 금지."),
    "llm_find_file": ("AI 에이전트: 위 폴더 아래에서 힌트에 해당하는 파일을 네가 직접 찾아라(폴더 목록 조회). "
                 "실제로 존재하는 파일만 — 경로를 지어내는 것은 금지(엔진이 실존 여부를 검증해 거부한다). "
                 "후보가 여러 개면 사용자에게 선택 받아라. 선택 도구는 현재 호스트 한도 안의 2~4개 "
                 "객관식에만 쓰고, 그보다 많으면 채팅 번호 목록을 사용하라. "
                 "못 찾으면 사용자에게 물어라. 파일 내용을 붙여넣는 것이 아니다 — 읽기는 엔진이 한다. "
                 "{\"path\": \"...\"}를 payload_file에 저장해 resume_command를 실행하라."),
    "choose_system": ("AI 에이전트: 어느 시스템으로 실행할지 사용자에게 질문하라. 출력의 selection 계약을 "
                 "따르고 choice_tool_allowed=false면 선택 도구를 호출하지 말고 채팅 번호 목록을 사용하라. "
                 "임의 선택은 금지한다. {\"system\": \"이름\"}을 payload_file에 저장해 resume_command를 실행하라."),
    "confirm": ("AI 에이전트: 위 내용을 사용자에게 보여주고 진행/완료 여부를 확인하라(선택지형이므로 ask_user 도구 "
                 "사용 가능, 임의 진행·임의 완료 처리 금지). {\"confirmed\": true|false}를 payload_file에 저장해 "
                 "resume_command를 실행하라."),
    "mcp_call": ("AI 에이전트: 위 prompt의 [MCP 서버]에 해당하는, 너에게 연결된 MCP 도구를 호출해 [지시문]을 "
                 "수행하라. 값은 MCP 도구 호출 결과에서만 가져와라 — 결과에 없는 값을 지어내는 것은 금지, "
                 "빈 문자열로 채우는 것도 금지이며, 결과에 없어 사용자가 '없음'을 확인한 필드만 null로 보내라. "
                 "해당 서버의 MCP 도구가 연결되어 있지 않거나 호출이 실패하면 지어내지 말고 사용자에게 상황을 "
                 "알리고 멈춰라. fields가 있으면 {\"output\": {필드id: 값}}를, fields가 비어 있으면(쓰기 완료 "
                 "확인형) 호출 성공을 확인한 뒤 {\"confirmed\": true}를(호출하지 않았거나 실패했으면 false) "
                 "payload_file에 저장해 resume_command를 실행하라."),
}


def _now():
    return datetime.datetime.now().isoformat(timespec="seconds")


def _norm_label(s):
    """라벨 관용 매칭용 정규화 — NFC + 연속 공백 축약 + strip.

    실측: 긴 한국어 라벨에 이중 공백("…완료요청일에  납기를…")이 섞여 있어
    LLM이 공백을 하나로 답하면 정확 일치가 실패해 왕복이 낭비됐다."""
    import unicodedata
    return re.sub(r"\s+", " ", unicodedata.normalize("NFC", str(s))).strip()


def _lenient_label(label, labels):
    """제출 라벨이 정확 일치하지 않으면 정규화 유일 일치를 찾아 **원문 라벨**을
    반환한다(기록·If 라우팅은 항상 task 원문 — 정합 유지). 못 찾으면 None."""
    if label in labels:
        return label
    matches = [lb for lb in labels if _norm_label(lb) == _norm_label(label)]
    return matches[0] if len(matches) == 1 else None


# ------------------------------------------------------------------ 실행 저널

JOURNAL_MAX = 300        # run 파일 비대화 방지 상한 — 초과분은 오래된 것부터 버린다
LONG_WAITING_HOURS = 72  # 장기 대기 표시 기준 — 이상 상태가 아니라 정보성 배지다
TRACE_PREVIEW_MAX = 600  # 실행 UI에는 원문 대신 재현 가능한 짧은 미리보기만 보관한다


def _journal(run, event, node=None, detail=None):
    """실행 저널 — 감사 로그다. 실행 상태(cursor·nodes·waiting_*)가 아니며,
    rejected의 "진행상태 불변" 원칙은 실행 상태에 대한 것이라 저널 기록과 양립한다."""
    j = run.setdefault("journal", [])
    entry = {"at": _now(), "event": event}
    if node:
        entry["node"] = node
    if detail is not None:
        entry["detail"] = detail
    j.append(entry)
    if len(j) > JOURNAL_MAX:
        del j[:len(j) - JOURNAL_MAX]
        run["journal_truncated"] = True


def _payload_summary(payload):
    """거부된 payload에서 진단에 필요한 키와 값의 앞부분만 추려낸다.

    전체 노드 출력은 history에 보관되므로 저널에는 각 값의 앞 120자만 기록한다.
    """
    if not isinstance(payload, dict):
        return {"type": type(payload).__name__}
    out = {}
    for k, v in list(payload.items())[:10]:
        if isinstance(v, dict):
            out[k] = {ik: (None if iv is None else str(iv)[:120])
                      for ik, iv in list(v.items())[:10]}
        else:
            out[k] = None if v is None else str(v)[:120]
    return out


def _trace_value(value):
    """실행 화면용 값 요약. 원본 출력은 기존 history에만 보관한다."""
    try:
        text = value if isinstance(value, str) else json.dumps(
            value, ensure_ascii=False, sort_keys=True)
    except (TypeError, ValueError):
        text = str(value)
    text = text or ""
    encoded = text.encode("utf-8", errors="replace")
    return {
        "preview": text[:TRACE_PREVIEW_MAX],
        "truncated": len(text) > TRACE_PREVIEW_MAX,
        "sha256": hashlib.sha256(encoded).hexdigest()[:16],
        "value_type": type(value).__name__,
    }


def _result_entry(result):
    """핸들러 결과를 실행 이력으로 바꾸고 파일 원문은 제한해 저장한다."""
    entry = {"output": result.get("output", {})}
    if "label" in result:
        entry["label"] = result["label"]
    written = result.get("written_file")
    if isinstance(written, dict) and isinstance(written.get("content"), str):
        entry["written_file"] = {
            "path": str(written.get("path") or ""),
            **_trace_value(written["content"]),
        }
    return entry


def _trace_inputs(node, inputs):
    """노드가 실제로 받은 입력을 이름·출처와 함께 작게 기록한다."""
    inputs = inputs if isinstance(inputs, dict) else {}
    result, seen = [], set()
    for spec in node.get("inputs") or []:
        if not isinstance(spec, dict):
            continue
        name = spec.get("field") or spec.get("name")
        if not name or name not in inputs:
            continue
        seen.add(name)
        item = {
            "name": name,
            "source": spec.get("source"),
            **_trace_value(inputs.get(name)),
        }
        if (node.get("action_type") == "file_read"
                and node.get("path_input") == name
                and isinstance(inputs.get(name), str)):
            item["file_path"] = inputs[name]
        result.append(item)
    for name, value in inputs.items():
        if name in seen:
            continue
        result.append({"name": str(name), "source": None, **_trace_value(value)})
    return result


def _trace_context(node, inputs=None, actor="system", started_at=None):
    return {
        "started_at": started_at or _now(),
        "actor": actor,
        "action_type": node.get("action_type"),
        "inputs": _trace_inputs(node, inputs or {}),
    }


def _waiting_age_hours(run):
    """대기 시간을 계산하고 waiting_since가 없으면 시작 시각을 사용한다."""
    since = run.get("waiting_since") or run.get("started_at")
    if not since:
        return None
    try:
        dt = datetime.datetime.fromisoformat(since)
    except (ValueError, TypeError):
        return None
    return round((datetime.datetime.now() - dt).total_seconds() / 3600, 1)


def _sanitize(name):
    s = re.sub(r"\s+", "", str(name))
    return re.sub(r'[\\/:*?"<>|]', "-", s)


def _safe_task_id_component(task_id):
    """run 파일명에 안전하게 넣을 수 있는 task ID를 반환한다.

    ``activity`` and ``key`` have historically been sanitized, while task_id was
    inserted verbatim.  Rejecting unsafe task ids preserves every existing safe
    filename and prevents a crafted Task JSON from escaping ``runs_dir``.
    """
    if not isinstance(task_id, str) or not task_id or len(task_id) > 200:
        raise ValueError("task_id는 1~200자 문자열이어야 합니다")
    if re.search(r'[\\/:*?"<>|\x00-\x1f]', task_id):
        raise ValueError("task_id에는 경로 문자나 제어 문자를 사용할 수 없습니다")
    return task_id


def run_file_path(runs_dir, activity, task_id, key):
    safe_task_id = _safe_task_id_component(task_id)
    raw_key = str(key)
    safe_key = _sanitize(raw_key)
    if safe_key != raw_key:
        import hashlib
        safe_key += "--" + hashlib.sha256(raw_key.encode("utf-8")).hexdigest()[:12]
    return os.path.join(
        runs_dir, f"{_sanitize(activity)}__{safe_task_id}__{safe_key}.json")


def legacy_run_file_path(runs_dir, activity, task_id, key):
    safe_task_id = _safe_task_id_component(task_id)
    return os.path.join(
        runs_dir, f"{_sanitize(activity)}__{safe_task_id}__{_sanitize(key)}.json")


def _disambiguated_run_file_path(runs_dir, activity, task_id, key):
    import hashlib
    safe_task_id = _safe_task_id_component(task_id)
    raw_key = str(key)
    suffix = hashlib.sha256(raw_key.encode("utf-8")).hexdigest()[:16]
    return os.path.join(
        runs_dir,
        f"{_sanitize(activity)}__{safe_task_id}__{_sanitize(raw_key)}--{suffix}.json")


def _run_identity_matches(path, activity, task_id, key):
    try:
        run = util.load_json(path)
    except Exception:
        return False
    return (run.get("activity") == activity
            and run.get("task_id") == task_id
            and run.get("key") == key)


def find_existing_run_path(runs_dir, activity, task_id, key):
    """파일에 기록된 식별 정보가 요청과 정확히 일치하는 run만 찾는다."""
    candidates = [
        run_file_path(runs_dir, activity, task_id, key),
        _disambiguated_run_file_path(runs_dir, activity, task_id, key),
        legacy_run_file_path(runs_dir, activity, task_id, key),
    ]
    seen = set()
    for candidate in candidates:
        normalized = os.path.normcase(os.path.abspath(candidate))
        if normalized in seen:
            continue
        seen.add(normalized)
        if (os.path.isfile(candidate)
                and _run_identity_matches(candidate, activity, task_id, key)):
            return candidate
    return None


def _new_run_file_path(runs_dir, activity, task_id, key):
    """기존 run을 건드리지 않으면서 중복되지 않는 새 파일명을 고른다."""
    preferred = run_file_path(runs_dir, activity, task_id, key)
    if not os.path.exists(preferred):
        return preferred
    if _run_identity_matches(preferred, activity, task_id, key):
        return preferred
    return _disambiguated_run_file_path(runs_dir, activity, task_id, key)


def default_ctx():
    return {"http": _default_http, "secret": _default_secret, "command": _default_command,
            "command_argv": _default_command_argv,
            "logic": _default_logic, "open_url": _default_open_url,
            "browser_snapshot": _default_browser_snapshot}


def _default_browser_snapshot(url):
    """로그인된 Edge 페이지를 조용히 조회하는 기본 Playwright 어댑터."""
    if __package__ in (None, ""):
        from ops_runtime import playwright_copy
    else:
        from . import playwright_copy
    return playwright_copy.capture_snapshot(url)


def _default_open_url(url):
    """manual 노드의 작업 화면(manual_url)을 기본 브라우저로 연다.
    실패해도 실행 흐름을 막지 않는다(프롬프트에 URL이 이미 표시된다)."""
    try:
        os.startfile(url)             # Windows 기본 브라우저
        return True
    except (OSError, AttributeError):
        return False


def _default_command(cmd, timeout_seconds=120):
    """로컬 셸에서 command 방식의 명령을 실행하고 종료 코드와 출력을 반환한다."""
    import subprocess
    p = subprocess.run(
        cmd, shell=True, capture_output=True, timeout=timeout_seconds)
    return (p.returncode,
            p.stdout.decode("utf-8", errors="replace"),
            p.stderr.decode("utf-8", errors="replace"))


def _default_command_argv(program, args, timeout_seconds=120):
    """schema 2.1 command_spec 실행기 — 셸 문자열을 만들지 않고 argv 그대로 실행."""
    import subprocess
    p = subprocess.run([program] + list(args), shell=False, capture_output=True,
                       timeout=timeout_seconds)
    return (p.returncode,
            p.stdout.decode("utf-8", errors="replace"),
            p.stderr.decode("utf-8", errors="replace"))


def _default_logic(script_path, stdin_text):
    """custom_logic의 run.py에 JSON을 전달하고 종료 코드와 출력을 반환한다.

    Windows에서도 출력 인코딩이 일정하도록 자식 프로세스에 UTF-8을 지정하고,
    올바르지 않은 바이트는 대체 문자로 디코딩한다.
    """
    import subprocess
    env = dict(os.environ)
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"
    p = subprocess.run([sys.executable, script_path],
                       input=stdin_text.encode("utf-8"),
                       capture_output=True, timeout=120, env=env)
    return (p.returncode,
            p.stdout.decode("utf-8", errors="replace"),
            p.stderr.decode("utf-8", errors="replace"))


def _default_http(method, url, headers=None, body=None, opts=None):
    """HTTP 요청을 전송한다.

    ``opts``에는 TLS 검증 여부와 CA 경로를 지정할 수 있다. 기존 task와의 호환을 위해
    ``verify_tls``를 지정하지 않으면 인증서 검증을 사용하지 않는다.
    """
    import ssl
    import urllib.request
    opts = opts or {}
    if opts.get("verify_tls"):
        ctx = ssl.create_default_context(cafile=opts.get("ca_bundle") or None)
    else:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE  # 사내 인증서 (v1 관례 유지)
    data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=dict(headers or {}))
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=30) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            try:
                return resp.status, json.loads(raw)
            except json.JSONDecodeError:
                return resp.status, {"raw": raw}
    except Exception as e:  # HTTPError 포함 — 상태코드로 환원
        status = getattr(e, "code", 599)
        return status, {"error": str(e)}


def _default_secret(kind, name):
    if not name:
        return None
    if kind == "credman":
        try:
            import keyring
            return keyring.get_password("ops_runtime", name)
        except Exception:
            return None
    return os.getenv(name)


# ------------------------------------------------------------------ 결과 빌더

def _payload_path(run_path, node_id):
    stem = os.path.splitext(os.path.basename(run_path))[0]
    return os.path.join(PAYLOADS_DIR, f"{stem}__{node_id}.json")


def _resume_command(run_path, node_id):
    return (f'python ops_runtime/engine.py resume "{run_path}" '
             f'--node {node_id} --payload-file "{_payload_path(run_path, node_id)}"')


def _open_command(run_path, node_id):
    return (f'python ops_runtime/engine.py open-url "{run_path}" '
            f'--node {node_id} --delay 2')


def _node_label(node):
    at = node.get("action_type")
    name = node.get("name") or node.get("id", "")
    ko = ACTION_TYPE_KO.get(at)
    return f"[{ko}] {name}" if ko else name


def _snapshot_task_path(run_path):
    root = workspace.project_root(run_path)
    identity = hashlib.sha256(
        os.path.normcase(os.path.realpath(run_path)).encode("utf-8")
    ).hexdigest()[:32]
    return os.path.join(root, ".ops", "run_snapshots", identity, "task.json")


def _inside_path(path, parent):
    try:
        return os.path.commonpath(
            (os.path.normcase(os.path.realpath(path)),
             os.path.normcase(os.path.realpath(parent)))) == os.path.normcase(
                 os.path.realpath(parent))
    except ValueError:
        return False


def _create_run_snapshot(run_path, task, source_task_path):
    root = workspace.project_root(run_path)
    path = _snapshot_task_path(run_path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    pinned = deepcopy(task)
    util.atomic_write_json(path, pinned)
    return (
        os.path.relpath(path, root).replace(os.sep, "/"),
        _task_fingerprint(path),
        pinned,
        root,
    )


def _load_run_task(run, run_path=None):
    snapshot_ref = run.get("snapshot_ref")
    if snapshot_ref:
        task_root = workspace.project_root(run.get("task_ref"))
        root = run.get("snapshot_base") or workspace.project_root(
            run_path or run.get("task_ref"))
        if not _inside_path(root, task_root):
            root = task_root
        path = os.path.realpath(os.path.join(
            root, str(snapshot_ref).replace("/", os.sep)))
        snapshots = os.path.realpath(os.path.join(root, ".ops", "run_snapshots"))
        checked_path = os.path.normcase(path)
        checked_snapshots = os.path.normcase(snapshots)
        if (checked_path == checked_snapshots
                or not checked_path.startswith(checked_snapshots + os.sep)):
            raise PermissionError("run snapshot 경로가 허용 범위를 벗어났습니다")
        return util.load_json(path)
    return task_compat.load_effective_task(run["task_ref"])


def load_run_task(run_path, run=None):
    """Public compatibility resolver used by Controller and reports."""
    run = run or util.load_json(run_path)
    return _load_run_task(run, run_path)


def _upgrade_run_snapshot(run_path, run, task=None):
    if run.get("snapshot_ref"):
        return _load_run_task(run, run_path)
    task_path = run.get("task_ref")
    if run.get("task_fingerprint") and (
            not os.path.isfile(task_path)
            or run["task_fingerprint"] != _task_fingerprint(task_path)):
        return None
    task = task or task_compat.load_effective_task(task_path)
    snapshot_ref, snapshot_fingerprint, task, snapshot_base = _create_run_snapshot(
        run_path, task, task_path)
    run.setdefault("run_id", hashlib.sha256(
        (os.path.normcase(os.path.realpath(run_path)) + "\0"
         + str(run.get("started_at") or "")).encode("utf-8")
    ).hexdigest()[:32])
    run["snapshot_ref"] = snapshot_ref
    run["snapshot_fingerprint"] = snapshot_fingerprint
    run["snapshot_base"] = snapshot_base
    util.atomic_write_json(run_path, run)
    return task


def _progress(run):
    try:
        task = _load_run_task(run)
    except Exception:
        return None
    nodes = [n for n in task.get("nodes") or [] if n.get("type") != "if"]
    completed = sum(1 for n in nodes if util.latest(run, n.get("id")) is not None)
    total = len(nodes)
    current = run.get("waiting_node_label")
    presentation = f"완료 {completed}/{total}"
    if current:
        presentation += f" · 현재: {current}"
    return {"completed": completed, "total": total, "current": current,
            "presentation": presentation}


def _result_summary(run):
    """완료 보고를 AI가 즉흥 작성하지 않도록 출력 필드의 최신값을 요약한다."""
    try:
        task = _load_run_task(run)
    except Exception:
        return []
    summary = []
    for node in task.get("nodes") or []:
        if node.get("type") == "if":
            continue
        latest = util.latest(run, node.get("id"))
        if not latest:
            continue
        names = {o.get("id"): o.get("name") or o.get("id")
                 for o in node.get("outputs") or []}
        name_counts = {}
        for name in names.values():
            name_counts[name] = name_counts.get(name, 0) + 1
        values = {}
        for fid, value in (latest.get("output") or {}).items():
            if isinstance(value, str) and len(value) > 500:
                value = value[:500] + f"… ({len(value)}자)"
            display_name = names.get(fid, fid)
            if name_counts.get(display_name, 0) > 1:
                display_name = f"{display_name} ({fid})"
            values[display_name] = value
        item = {"node": _node_label(node)}
        if latest.get("label") is not None:
            item["label"] = latest["label"]
        if values:
            item["output"] = values
        if latest.get("evidence"):
            item["evidence"] = latest["evidence"]
        summary.append(item)
    return summary


def _pause_result(run_path, run):
    kind = run["waiting_kind"]
    actor = PAUSE_ACTOR.get(kind, "user")
    result = {
        "status": "paused",
        "run": run_path,
        "node": run["waiting_node"],
        "node_label": run.get("waiting_node_label") or run["waiting_node"],
        "kind": kind,
        "actor": actor,
        "requires_user_input": actor == "user",
        "prompt": run["waiting_prompt"],
        "fields": run.get("waiting_fields", []),
        "instruction": INSTRUCTIONS[kind],
        "payload_file": _payload_path(run_path, run["waiting_node"]),
        "resume_command": _resume_command(run_path, run["waiting_node"]),
    }
    if run.get("waiting_open_url"):
        result["handoff"] = {
            "url": run["waiting_open_url"],
            "delay_seconds": 2,
            "opened": bool(run.get("waiting_url_opened_at")),
            "open_command": _open_command(run_path, run["waiting_node"]),
            "instruction": ("사용자에게 작업 안내와 URL을 먼저 보여준 뒤 open_command를 "
                            "실행하라. 약 2초 후 브라우저가 열린다. 이미 opened=true면 "
                            "자동으로 다시 열지 말고 URL만 제공하라."),
        }
    if kind == "choose_system":
        try:
            task = _load_run_task(run, run_path)
            node = next(n for n in task.get("nodes") or []
                        if n.get("id") == run.get("waiting_node"))
            names = [s.get("name") for s in node.get("systems") or [] if s.get("name")]
        except Exception:
            names = []
        allowed = 2 <= len(names) <= 4
        system_selection = {
            "mode": "choice_tool_if_supported" if allowed else "chat_numbered",
            "options": names,
            "chat_lines": [f"{i}. {name}" for i, name in enumerate(names, 1)],
            "instruction": ("현재 호스트가 이 개수를 지원할 때만 선택 도구를 사용하세요."
                            if allowed else "선택 도구를 호출하지 말고 번호 목록을 채팅에 보여주세요."),
        }
        if not allowed:
            system_selection["choice_tool_allowed"] = False
        result["selection"] = system_selection
    progress = _progress(run)
    if progress:
        result["progress"] = progress
    return result


def _set_pause(run, run_path, node, kind, prompt, fields=None, slot=None, targets=None,
               executed=None, open_url=None, inputs=None):
    run["status"] = "waiting"
    run["waiting_node"] = node["id"]
    run["waiting_node_label"] = _node_label(node)
    run["waiting_action_type"] = node.get("action_type")
    run["waiting_kind"] = kind
    run["waiting_prompt"] = prompt
    run["waiting_fields"] = fields or []
    run["waiting_slot"] = slot or KIND_SLOT[kind]
    run["waiting_targets"] = targets or []
    run["waiting_since"] = _now()
    run["waiting_trace"] = _trace_context(
        node, inputs, actor=PAUSE_ACTOR.get(kind, "user"),
        started_at=run["waiting_since"])
    run["waiting_open_url"] = open_url
    run["waiting_url_opened_at"] = None
    util.atomic_write_json(run_path, run)
    result = _pause_result(run_path, run)
    if executed:
        # 직전 정지 이후 자동으로 처리된 노드들 — 사용자에게 보이지 않아 "이 노드는
        # 건너뛴 건가?"라는 혼란이 실측됐다. AI 에이전트가 사용자에게 알린다.
        result["executed"] = executed
    return result


def _clear_wait(run):
    for k in ("waiting_node", "waiting_kind", "waiting_prompt", "waiting_fields",
              "waiting_slot", "waiting_targets", "waiting_open_url"):
        run[k] = None if k == "waiting_node" else []
    run["waiting_kind"] = None
    run["waiting_node_label"] = None
    run["waiting_prompt"] = None
    run["waiting_slot"] = None
    run["waiting_since"] = None
    run["waiting_url_opened_at"] = None
    run.pop("waiting_trace", None)
    run["status"] = "running"


def _error(run, run_path, node_id, reason, reason_code=None, details=None,
           redact_persisted_reason=False):
    persisted_reason = (
        "실행 오류 — 상세는 현재 응답에서만 제공합니다"
        if redact_persisted_reason else reason
    )
    run["status"] = "error"
    run["error"] = {"node": node_id, "reason": persisted_reason, "at": _now()}
    _journal(run, "error", node=node_id, detail=str(persisted_reason)[:200])
    util.atomic_write_json(run_path, run)
    result = {"status": "error", "run": run_path, "node": node_id, "reason": reason}
    if reason_code:
        result["reason_code"] = reason_code
    if details:
        result["details"] = details
    return result


def _rejected(run_path, node_id, reason):
    # 진행상태는 건드리지 않는다 — 잘못된 값은 기록되지 않고 되물음으로 끝난다.
    return {"status": "rejected", "run": run_path, "node": node_id, "reason": reason,
            "instruction": "위 사유를 해결한 payload로 다시 resume하라. 사용자에게 받아야 할 값이면 다시 물어보라."}


def _done(run, run_path, executed=None):
    run["status"] = "done"
    run["cursor"] = None
    _journal(run, "done")
    util.atomic_write_json(run_path, run)
    result = {"status": "done", "run": run_path,
              "progress": _progress(run), "result_summary": _result_summary(run)}
    if executed:
        result["executed"] = executed
    return result


# ------------------------------------------------------------------ 실행 본체

def _node_index(task):
    return {n["id"]: i for i, n in enumerate(task["nodes"])}


def _next_node(task, idx, node):
    if "next" in node:
        return node["next"]
    i = idx[node["id"]]
    if i + 1 < len(task["nodes"]):
        return task["nodes"][i + 1]["id"]
    return None


def _record(run, node_id, entry, node=None, inputs=None, actor="system", trace=None):
    state = run.setdefault("nodes", {}).setdefault(node_id, {})
    state.setdefault("history", [])
    trace = deepcopy(trace) if isinstance(trace, dict) else None
    if trace is None and node is not None:
        trace = _trace_context(node, inputs, actor=actor)
    if trace:
        entry["trace"] = trace
    if run.get("schema_version") == "2.2":
        entry["epoch"] = _advance_execution_epoch(run)
    entry["at"] = _now()
    state["history"].append(entry)
    # 승인과 debug 확인은 한 번의 실제 노드 완료에만 유효하다. 순환으로 같은
    # 노드에 다시 들어오면 반드시 새 확인을 받되, 이력과 재시도 정보는 보존한다.
    state.pop("approved", None)
    state.pop("confirmed", None)


def _load_sibling_input(spec, run, runs_dir, key):
    """inputs_from 항목을 같은 건ID의 이전 task 진행상태에서 읽는다."""
    path = find_existing_run_path(
        runs_dir, run["activity"], spec["from_task"], key)
    if path is None:
        return False, None
    sib = util.load_json(path)
    entry = util.latest(sib, spec["from_node"])
    if entry is None:
        return False, None
    out = entry.get("output", {})
    if spec["from_field"] not in out:
        return False, None
    return True, out[spec["from_field"]]


def _runtime_output_source(task, source):
    """실행 시 유일한 과거 이름 참조만 출력 ID로 호환한다."""
    resolved = references.resolve_output_source(task, source)
    if resolved is None:
        return source, None
    if resolved.get("kind") in ("canonical", "legacy_name"):
        return resolved.get("canonical") or source, None
    if resolved.get("kind") in ("ambiguous_output_name", "duplicate_output_id"):
        return source, resolved
    return source, None


def _input_source_label(task, source):
    """동명 입력을 구분하기 위한 사람이 읽을 수 있는 생산자 이름을 반환한다."""
    source = str(source or "")
    resolved = references.resolve_output_source(task, source)
    if resolved and resolved.get("kind") in ("canonical", "legacy_name"):
        producer_id = resolved.get("node_id")
        producer = next(
            (candidate for candidate in task.get("nodes") or []
             if isinstance(candidate, dict) and candidate.get("id") == producer_id),
            None,
        )
        if producer is not None:
            label = str(producer.get("name") or producer_id).strip()
            return label or str(producer_id)

    if source.startswith("$.inputs_from."):
        name = source[len("$.inputs_from."):]
        declared = next(
            (candidate for candidate in task.get("inputs_from") or []
             if isinstance(candidate, dict) and candidate.get("name") == name),
            None,
        )
        if declared is None:
            return None
        if declared.get("from_task") and declared.get("from_node"):
            return f"{declared['from_task']}/{declared['from_node']}"
        return str(name).strip() or None

    if source == "$.key":
        return "건 ID"
    return None


def _input_source_identity_label(task, source):
    """동명 입력의 최종 충돌 때 쓸 실제 source/output 식별자를 반환한다."""
    resolved = references.resolve_output_source(task, source)
    if resolved and resolved.get("kind") in ("canonical", "legacy_name"):
        producer = _input_source_label(task, source)
        node_id = str(resolved.get("node_id") or "").strip()
        output_id = str(resolved.get("output_id") or "").strip()
        output_name = str(resolved.get("output_name") or output_id).strip()
        producer_part = f"{producer} [{node_id}]" if producer and node_id else node_id
        output_part = (
            f"{output_name} [{output_id}]"
            if output_name and output_id and output_name != output_id
            else output_id or output_name
        )
        return " > ".join(part for part in (producer_part, output_part) if part)
    source = str(source or "")
    if source.startswith("$.inputs_from."):
        name = source[len("$.inputs_from."):]
        producer = _input_source_label(task, source)
        return " > ".join(part for part in (producer, name) if part)
    if source == "$.key":
        return "건 ID"
    return None


def _input_runtime_keys(task, node, qualified_fields=None):
    """핸들러에 전달할 입력 키를 ``node.inputs``와 같은 순서로 반환한다.

    고유한 field는 기존 키를 그대로 유지한다. 표시 이름이 중복될 때만 source를
    이용해 ``생산 노드 > field``로 구분한다. ``None`` 또는 중복 반환 키는 출처를
    안전하게 구분할 수 없는 설계이며 Validator와 Runner가 모두 거부한다.
    """
    specs = list(node.get("inputs") or [])
    qualified_fields = set(qualified_fields or ())
    normalized_fields = [
        str(spec.get("field") or "").strip() if isinstance(spec, dict) else ""
        for spec in specs
    ]
    counts = {}
    for field in normalized_fields:
        counts[field] = counts.get(field, 0) + 1

    keys = []
    for spec, normalized in zip(specs, normalized_fields):
        raw_field = spec.get("field") if isinstance(spec, dict) else None
        if counts.get(normalized, 0) <= 1 and normalized not in qualified_fields:
            keys.append(raw_field)
            continue
        producer = _input_source_label(task, spec.get("source"))
        keys.append(f"{producer} > {normalized}" if producer and normalized else None)
    key_counts = {}
    for key in keys:
        if key is not None:
            key_counts[key] = key_counts.get(key, 0) + 1
    for index, (spec, normalized) in enumerate(zip(specs, normalized_fields)):
        if keys[index] is None or key_counts.get(keys[index], 0) <= 1:
            continue
        identity = _input_source_identity_label(task, spec.get("source"))
        keys[index] = f"{identity} > {normalized}" if identity and normalized else None
    return keys


def _control_successors(task):
    """task JSON의 명시적/순차 제어 흐름을 반환한다."""
    nodes = task.get("nodes") or []
    successors = {}
    for index, node in enumerate(nodes):
        node_id = node.get("id")
        if not node_id:
            continue
        if node.get("type") == "if":
            successors[node_id] = [
                case.get("next") for case in node.get("cases") or []
                if isinstance(case, dict) and case.get("next") is not None
            ]
        elif "next" in node:
            successors[node_id] = (
                [] if node.get("next") is None else [node.get("next")]
            )
        else:
            following = (
                nodes[index + 1].get("id") if index + 1 < len(nodes) else None
            )
            successors[node_id] = [following] if following else []
    return successors


def _reachable_without(successors, start, target, blocked=()):
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
    """consumer에 닿는 모든 경로에서 producer가 먼저 실행되는지 확인한다."""
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


def _branch_optional_if_nodes(task, consumer_id, producer_id):
    """producer가 일부 case에서만 consumer보다 먼저 실행되는 If를 찾는다."""
    successors = _control_successors(task)
    entry_id = next((
        node.get("id") for node in task.get("nodes") or []
        if isinstance(node, dict) and node.get("id")
    ), None)
    result = []
    for if_node in task.get("nodes") or []:
        if not isinstance(if_node, dict) or if_node.get("type") != "if":
            continue
        if_id = if_node.get("id")
        if (entry_id and if_id != entry_id
                and not _reachable_without(
                    successors, entry_id, if_id, {consumer_id})):
            continue
        reaching = []
        producing = []
        blocked = {if_id}
        for case in if_node.get("cases") or []:
            if not isinstance(case, dict) or not case.get("next"):
                continue
            start = case.get("next")
            if not _reachable_without(
                    successors, start, consumer_id, blocked):
                continue
            reaching.append(case.get("value"))
            if _producer_precedes_consumer(
                    successors, start, producer_id, consumer_id, blocked):
                producing.append(case.get("value"))
        if len(reaching) >= 2 and 0 < len(producing) < len(reaching):
            result.append(if_id)
    return [node_id for node_id in result if node_id]


def _input_specs_are_mutually_exclusive(task, consumer, left, right):
    """두 binding이 실제 한 소비 회차에서 함께 활성될 수 없는지 검사한다."""
    nodes = task.get("nodes") or []
    consumer_id = consumer.get("id")
    successors = _control_successors(task)
    entry_id = next((node.get("id") for node in nodes if node.get("id")), None)

    def local_producer(spec):
        source = references.resolve_output_source(task, spec.get("source"))
        if source and source.get("kind") in ("canonical", "legacy_name"):
            return source.get("node_id")
        return None

    left_producer = local_producer(left)
    right_producer = local_producer(right)
    if left_producer and right_producer and entry_id and consumer_id:
        pending = [(entry_id, False, False)]
        seen = set()
        while pending:
            current, saw_left, saw_right = pending.pop()
            state = (current, saw_left, saw_right)
            if not current or state in seen:
                continue
            seen.add(state)
            if current == consumer_id:
                if saw_left and saw_right:
                    return False
                continue
            saw_left = saw_left or current == left_producer
            saw_right = saw_right or current == right_producer
            pending.extend(
                (successor, saw_left, saw_right)
                for successor in successors.get(current) or []
            )
        return True

    left_when = left.get("when")
    right_when = right.get("when")
    if (not isinstance(left_when, dict) or not isinstance(right_when, dict)):
        return False
    if_id = str(left_when.get("if_node") or "").strip()
    if (not if_id or if_id != str(right_when.get("if_node") or "").strip()
            or str(left_when.get("value") or "")
            == str(right_when.get("value") or "")):
        return False

    if_node = next(
        (node for node in nodes
         if node.get("id") == if_id and node.get("type") == "if"),
        None,
    )
    if if_node is None or not consumer_id:
        return False

    def local_active(producer, start):
        if not producer:
            return False
        common_before_if = (
            entry_id
            and _producer_precedes_consumer(
                successors, entry_id, producer, if_id)
        )
        return bool(common_before_if or _producer_precedes_consumer(
            successors, start, producer, consumer_id, {if_id}))

    reaching_case = False
    for case in if_node.get("cases") or []:
        start = case.get("next")
        if (not start or not _reachable_without(
                successors, start, consumer_id, {if_id})):
            continue
        reaching_case = True
        case_value = str(case.get("value") or "")
        left_active = (
            local_active(left_producer, start) if left_producer
            else case_value == str(left_when.get("value") or "")
        )
        right_active = (
            local_active(right_producer, start) if right_producer
            else case_value == str(right_when.get("value") or "")
        )
        if left_active and right_active:
            return False
    return reaching_case


def _coactive_duplicate_input_fields(task, consumer, specs):
    """어떤 실행 경로에서든 둘 이상 활성 가능한 동명 입력을 반환한다."""
    by_field = {}
    for spec in specs:
        if isinstance(spec, dict):
            by_field.setdefault(str(spec.get("field") or "").strip(), []).append(spec)
    result = set()
    for field, group in by_field.items():
        if not field:
            continue
        for index, left in enumerate(group):
            for right in group[index + 1:]:
                if (str(left.get("source") or "").strip()
                        == str(right.get("source") or "").strip()):
                    continue
                if not _input_specs_are_mutually_exclusive(
                        task, consumer, left, right):
                    result.add(field)
                    break
            if field in result:
                break
    return result


def _advance_execution_epoch(run):
    """schema 2.2 실행 순서를 비교하기 위한 단조 증가 번호를 발급한다."""
    try:
        current = int(run.get("execution_epoch", 0))
    except (TypeError, ValueError):
        current = 0
    run["execution_epoch"] = current + 1
    return run["execution_epoch"]


def _schema_version_error(task):
    version = task.get("schema_version") if isinstance(task, dict) else None
    if version in SUPPORTED_SCHEMA_VERSIONS:
        return None
    supported = ", ".join(sorted(SUPPORTED_SCHEMA_VERSIONS))
    return f"지원하지 않는 schema_version입니다: {version!r} (지원: {supported})"


def _activation_lineage_is_current(run, activation):
    """분기 활성화가 현재 상위 분기 선택에서 만들어졌는지 확인한다."""
    if not isinstance(activation, dict):
        return False
    lineage = activation.get("lineage")
    if not isinstance(lineage, dict):
        return False
    activations = run.get("route_activations") or {}
    for if_node, token in lineage.items():
        current = activations.get(if_node)
        if not isinstance(current, dict) or current.get("token") != token:
            return False
    return True


def _activate_route(run, node, label):
    """현재 If를 활성화하고 이전 상위 선택에 딸린 하위 분기를 폐기한다."""
    node_id = node.get("id")
    activations = run.setdefault("route_activations", {})
    previous = activations.get(node_id)
    previous_token = previous.get("token") if isinstance(previous, dict) else None
    if previous_token:
        for if_node, activation in list(activations.items()):
            lineage = activation.get("lineage") if isinstance(activation, dict) else None
            if if_node != node_id and isinstance(lineage, dict) \
                    and lineage.get(node_id) == previous_token:
                activations.pop(if_node, None)
    activations.pop(node_id, None)
    lineage = {
        if_node: activation.get("token")
        for if_node, activation in activations.items()
        if isinstance(activation, dict) and activation.get("token")
    }
    epoch = _advance_execution_epoch(run)
    activation = {
        "label": label,
        "epoch": epoch,
        "token": f"{node_id}:{epoch}",
        "source_node": node.get("source_node"),
        "lineage": lineage,
    }
    activations[node_id] = activation
    return activation


def _active_input_specs(task, node, run, dependency_preflight=False):
    """schema 2.2 입력 중 현재 실행 경로에서 생긴 항목만 고른다.

    조건부 입력도 일반 입력과 같은 독립 항목이다. 실행하지 않은 분기의 입력은
    건너뛰고, 현재 분기와 일치하는 항목만 남긴다. 실행 시작 전 의존값 사전
    점검에서는 아직 분기가 정해지지 않았으므로 조건부 입력을 모두 건너뛴다.
    """
    specs = list(node.get("inputs") or [])
    if task.get("schema_version") != "2.2":
        return specs, []

    active_specs = []
    for spec in specs:
        when = spec.get("when") if isinstance(spec, dict) else None
        if dependency_preflight and isinstance(when, dict):
            continue
        runtime_source, source_error = _runtime_output_source(
            task, spec.get("source", ""))
        if not source_error and str(runtime_source).startswith("$.nodes."):
            parts = str(runtime_source).split(".")
            producer_id = parts[2] if len(parts) >= 5 else None
            branch_ids = _branch_optional_if_nodes(
                task, node.get("id"), producer_id)
            if branch_ids:
                if (_local_source_is_current_after_routes(
                        run, runtime_source, branch_ids)
                        and _local_source_is_newer_than_consumer(
                            run, runtime_source, node.get("id"))):
                    active_specs.append(spec)
                continue
            if _local_source_is_newer_than_consumer(
                    run, runtime_source, node.get("id")):
                active_specs.append(spec)
            continue
        if not isinstance(when, dict):
            active_specs.append(spec)
            continue
        activation = (run.get("route_activations") or {}).get(
            when.get("if_node"))
        if not isinstance(activation, dict) \
                or activation.get("label") != when.get("value"):
            continue
        if not _activation_lineage_is_current(run, activation):
            field = str(spec.get("field") or "").strip()
            return [], [{
                "id": field or "inputs",
                "name": field or "inputs",
                "target": "manual",
                "askable": False,
                "reason_code": "stale_route_activation",
                "field": field,
                "active_count": 0,
            }]
        active_specs.append(spec)

    deduplicated = []
    seen_bindings = set()
    for spec in active_specs:
        field = str(spec.get("field") or "").strip()
        runtime_source, source_error = _runtime_output_source(
            task, spec.get("source", ""))
        source_identity = (
            str(runtime_source) if not source_error
            else str(spec.get("source") or "")
        )
        identity = (field, source_identity)
        if identity in seen_bindings:
            continue
        seen_bindings.add(identity)
        deduplicated.append(spec)

    return deduplicated, []


def _local_source_is_current_after_routes(run, runtime_source, if_node_ids):
    """관련 분기 선택 뒤 이번 경로에서 만들어진 로컬 출력인지 확인한다."""
    activations = [
        (run.get("route_activations") or {}).get(if_node_id)
        for if_node_id in if_node_ids
        if if_node_id
    ]
    activations = [item for item in activations if isinstance(item, dict)]
    if not activations or any(
            not _activation_lineage_is_current(run, item)
            for item in activations):
        return False
    parts = str(runtime_source).split(".")
    if len(parts) < 5:
        return False
    entry = util.latest(run, parts[2])
    if not isinstance(entry, dict):
        return False
    try:
        activation_epoch = max(int(item.get("epoch", -1)) for item in activations)
        return int(entry.get("epoch", -1)) > activation_epoch
    except (TypeError, ValueError):
        return False


def _local_source_is_newer_than_consumer(run, runtime_source, consumer_id):
    """반복 소비 시 이전 회차의 로컬 출력을 다시 쓰지 않는다."""
    parts = str(runtime_source).split(".")
    if len(parts) < 5:
        return False
    producer_entry = util.latest(run, parts[2])
    if not isinstance(producer_entry, dict):
        return False
    consumer_entry = util.latest(run, consumer_id)
    if not isinstance(consumer_entry, dict):
        return True
    try:
        return int(producer_entry.get("epoch", -1)) > int(
            consumer_entry.get("epoch", -1))
    except (TypeError, ValueError):
        return False


def _resolve_inputs(task, node, run, runs_dir, dependency_preflight=False):
    """노드 입력 해석.

    missing의 askable=True는 task가 명시한 외부 입력뿐이다. 이전 노드/이전 task
    출력 부재를 사용자 값으로 메우면 설계 오류가 숨으므로 blocking으로 구분한다.
    """
    inputs, missing = {}, []
    manual = run.get("manual_inputs", {}).get(node["id"], {})
    from_specs = {s["name"]: s for s in task.get("inputs_from", [])}
    specs, conditional_errors = _active_input_specs(
        task, node, run, dependency_preflight=dependency_preflight)
    if conditional_errors:
        return {}, conditional_errors
    runtime_node = dict(node)
    runtime_node["inputs"] = specs
    qualified_fields = _coactive_duplicate_input_fields(
        task, node, [
            spec for spec in node.get("inputs") or [] if isinstance(spec, dict)
        ])
    runtime_keys = _input_runtime_keys(
        task, runtime_node, qualified_fields=qualified_fields)
    usable_keys = [key for key in runtime_keys if key is not None]
    collided = {key for key in usable_keys if usable_keys.count(key) > 1}
    if len(runtime_keys) != len(specs) or any(key is None for key in runtime_keys) or collided:
        fields = sorted({
            str(spec.get("field") or "").strip()
            for spec, key in zip(specs, runtime_keys)
            if key is None or key in collided
        })
        return {}, [{
            "id": fields[0] if fields else "inputs",
            "name": ", ".join(fields) if fields else "inputs",
            "target": "manual",
            "askable": False,
            "reason_code": "ambiguous_input_identity",
            "fields": fields,
        }]

    for spec, input_key in zip(specs, runtime_keys):
        field, source = spec["field"], spec.get("source", "")
        if field in manual:
            inputs[input_key] = manual[field]
            continue
        runtime_source, source_error = _runtime_output_source(task, source)
        if source_error:
            missing.append({
                "id": field,
                "name": field,
                "target": "manual",
                "askable": False,
                "reason_code": "ambiguous_upstream_output",
                "source": source,
                "producer_node": source_error.get("node_id"),
                "output_name": source_error.get("field"),
                "candidates": source_error.get("candidates") or [],
            })
            continue
        ok, val = False, None
        if source.startswith("$.inputs_from."):
            name = source[len("$.inputs_from."):]
            fs = from_specs.get(name)
            if fs and fs.get("from_task"):
                # A real sibling run is authoritative even when this run already
                # contains a dummy value from an earlier pause.
                ok, val = _load_sibling_input(fs, run, runs_dir, run["key"])
                if ok:
                    run.setdefault("inputs_from", {})[name] = val
                    run.setdefault("dependency_dummy_inputs", {}).pop(name, None)
        if not ok:
            ok, val = util.resolve_source(runtime_source, run)
        if not ok and source.startswith("$.inputs_from."):
            name = source[len("$.inputs_from."):]
            fs = from_specs.get(name)
            if not ok:
                desc = (fs or {}).get("description", "")
                if fs and fs.get("from_task"):
                    missing.append({
                        "id": name, "name": name,
                        "description": desc,
                        "consumer_field": field,
                        "consumer_input": input_key,
                        "target": "inputs_from", "askable": True,
                        "reason_code": "missing_dependency_output",
                        "source": source, "from_task": fs.get("from_task"),
                        "from_node": fs.get("from_node"), "from_field": fs.get("from_field"),
                    })
                else:
                    missing.append({"id": name,
                                    "name": name + (f" ({desc})" if desc else ""),
                                    "target": "inputs_from", "askable": True,
                                    "source": source})
                continue
        if ok:
            inputs[input_key] = val
        else:
            code = "missing_upstream_output" if source.startswith("$.nodes.") else "invalid_input_source"
            missing.append({"id": field, "name": field, "target": "manual",
                            "askable": False, "reason_code": code, "source": source})
    return inputs, missing


def _collect_dependency_dummy_requirements(task, run, runs_dir):
    """Collect every missing previous-Task output before the first node runs.

    A single previous output can feed several inputs or nodes.  The Runner asks
    for it once, then stores the submitted value under every matching
    ``inputs_from`` name.
    """
    grouped = {}
    order = []
    for node in task.get("nodes") or []:
        if node.get("type") == "if" or not node.get("id"):
            continue
        _inputs, missing = _resolve_inputs(
            task, node, run, runs_dir, dependency_preflight=True)
        for item in missing:
            if item.get("reason_code") != "missing_dependency_output":
                continue
            source_key = (
                item.get("from_task"), item.get("from_node"),
                item.get("from_field"),
            )
            group = grouped.get(source_key)
            if group is None:
                group = dict(item)
                group["target_ids"] = []
                group["consumers"] = []
                grouped[source_key] = group
                order.append(source_key)
            if item.get("id") not in group["target_ids"]:
                group["target_ids"].append(item.get("id"))
            consumer = {
                "node_id": node.get("id"),
                "node_name": node.get("name"),
                "field": item.get("consumer_field"),
            }
            if consumer not in group["consumers"]:
                group["consumers"].append(consumer)
    return [grouped[key] for key in order]


def _dependency_dummy_pause(task, run, run_path, runs_dir):
    dependencies = _collect_dependency_dummy_requirements(task, run, runs_dir)
    if not dependencies:
        run["dependency_preflight_completed"] = True
        return None
    first_consumer = (dependencies[0].get("consumers") or [{}])[0].get("node_id")
    node = next((item for item in task.get("nodes") or []
                 if item.get("id") == first_consumer), None)
    if node is None:
        return None
    fields = [{key: value for key, value in item.items()
               if key in ("id", "name", "description", "source", "from_task",
                          "from_node", "from_field", "consumer_field",
                          "consumer_input", "target_ids", "consumers")}
              for item in dependencies]
    prompt = ("이번 Task를 수행하기 위한 이전 Task의 선행 데이터가 없습니다. "
              "예시 데이터를 입력해주세요.")
    return _set_pause(
        run, run_path, node, "ask_dependency_dummy", prompt,
        fields, slot="inputs", targets=dependencies,
    )


def _effective_cfg(node, run):
    """복수 시스템 노드면 선택된 시스템 설정을, 아니면 노드 자신을 반환. 미선택 시 None."""
    systems = node.get("systems")
    if not systems:
        return node
    chosen = run.get("nodes", {}).get(node["id"], {}).get("system")
    if not chosen:
        return None
    for s in systems:
        if s.get("name") == chosen:
            return s
    return None


def _guarded_write(node, cfg):
    """비멱등 write 중복 실행 보호 대상 판정 — 외부 시스템에 부작용을 내고
    일시정지 없이 즉시 실행되는 조합만. manual류(사람이 주체)·file_write(로컬,
    덮어쓰기 멱등)는 제외한다."""
    at = node.get("action_type")
    if at not in ("system_write", "notify_send"):
        return False
    if node.get("custom_logic"):
        return True
    if cfg is None:
        return False
    if at == "system_write":
        return cfg.get("method") in ("api", "command")
    return cfg.get("channel") in ("api", "ba_entity")


def _approval_required(node, cfg):
    """명시적으로 승인 정책이 설정된 자동 외부 쓰기만 사전 승인한다.

    필드가 없는 schema 2.0 task의 기존 동작은 바꾸지 않는다.
    """
    if node.get("approval_required") is not True:
        return False
    at = node.get("action_type")
    if at == "system_write":
        return (cfg or {}).get("method") in ("api", "command", "mcp")
    if at == "notify_send":
        return (cfg or node).get("channel") in ("api", "ba_entity")
    return False


def _authorized_path(ctx, path, mode):
    authorize = (ctx or {}).get("authorize_path")
    if authorize is None:
        return path, None
    try:
        resolved = authorize(path, mode)
    except (OSError, ValueError, PermissionError) as exc:
        return None, f"허용되지 않은 파일 경로입니다: {path} ({exc})"
    if resolved is False or resolved is None:
        return None, f"허용되지 않은 파일 경로입니다: {path}"
    return str(resolved), None


def _authorized_task_path(ctx, path, mode):
    """Task 파일 콜백을 우선하고, 구형 서비스 ctx에서는 기존 정책으로 폴백한다."""
    authorize = (ctx or {}).get("authorize_task_path")
    if authorize is None:
        return _authorized_path(ctx, path, mode)
    try:
        resolved = authorize(path, mode)
    except (OSError, ValueError, PermissionError) as exc:
        return None, f"허용되지 않은 파일 경로입니다: {path} ({exc})"
    if resolved is False or resolved is None:
        return None, f"허용되지 않은 파일 경로입니다: {path}"
    return str(resolved), None


def _run_custom_logic(node, inputs, run, ctx):
    """custom_logic 노드 실행 — 폴더의 run.py를 동기 실행하고 결과를 검증한다.

    stdin:  {"inputs": {...}, "outputs": [...], "key": "...",
             "labels": [...(labels 선언된 decision만 — 산출형은 키 자체가 없다)]}
    stdout: resume payload와 같은 모양 — {"output": {필드id: 값}, "label": "..."(labels 있을 때만)}
    stdout 전체가 JSON 객체 하나여야 한다(휴리스틱 추출 금지) — 로그는 stderr로.
    """
    folder, auth_error = _authorized_path(ctx, node["custom_logic"], "execute")
    if auth_error:
        return {"error": auth_error}
    script = os.path.join(folder, "run.py")
    if not os.path.isfile(script):
        return {"error": (f"커스텀 로직 스크립트가 없습니다: {script} — LOGIC.md 사양을 확정한 뒤 "
                          "/e2e-agent-creator에게 run.py 작성을 요청해 주세요")}
    declared = [o["id"] for o in node.get("outputs", [])]
    node_labels = [x for x in (node.get("labels") or []) if x]
    stdin_payload = {"inputs": inputs, "outputs": declared, "key": run.get("key")}
    if node.get("action_type") == "decision" and node_labels:
        # stdin의 labels 키 존재 = "stdout에 label을 내라"는 신호 — 산출형은 생략
        stdin_payload["labels"] = node_labels
    logic = ctx.get("logic") or _default_logic
    try:
        rc, stdout, stderr = logic(script, json.dumps(stdin_payload, ensure_ascii=False))
    except Exception as e:
        if e.__class__.__name__ == "TimeoutExpired":
            return {"error": f"커스텀 로직이 제한 시간(120초)을 초과했습니다: {script}"}
        return {"error": f"커스텀 로직 실행 실패: {type(e).__name__}: {e} — {script}"}
    if rc != 0:
        return {"error": (f"커스텀 로직 실행 실패(exit {rc}): {script}\n"
                          + (stderr or "").strip()[:500])}
    try:
        result = json.loads(stdout)
    except json.JSONDecodeError:
        result = None
    if not isinstance(result, dict):
        return {"error": ("커스텀 로직의 stdout이 JSON 객체 하나가 아닙니다 — 로그·중간 출력은 "
                          "stderr로 보내세요. stdout 앞부분: " + (stdout or "").strip()[:200])}
    out = result.get("output")
    if not isinstance(out, dict):
        return {"error": '커스텀 로직 출력에 "output" 객체가 없습니다'}
    lacking = [f for f in declared if f not in out]
    if lacking:
        return {"error": "커스텀 로직 출력에 선언된 필드가 없습니다: " + ", ".join(lacking)}
    entry = {"output": {f: out[f] for f in declared}}  # 선언 안 된 여분 키는 기록하지 않는다
    if node.get("action_type") == "decision" and node_labels:
        label = _lenient_label(result.get("label"), node_labels)  # 정규화 유일 일치 수용
        if label is None:
            return {"error": (f"커스텀 로직이 낸 라벨 '{result.get('label')}'은 허용된 라벨이 "
                              f"아닙니다. 다음 중 하나여야 합니다: {', '.join(node_labels)}")}
        entry["label"] = label
    # 산출형 decision(labels 없음)이 label을 내면 여분 키와 동일하게 무시·미기록
    return entry


@mutation_lock.serialized_run_mutation(path_arg=2, path_kw="run_path")
def _pump(task, run, run_path, ctx, debug, runs_dir):
    idx = _node_index(task)
    cur = run.get("cursor")
    executed = []    # 이번 펌프에서 자동 처리된 노드 라벨 — 정지/완료 시 사용자 고지용
    try:
        auto_limit = int(task.get("max_auto_steps_per_pump", DEFAULT_AUTO_STEPS_PER_PUMP))
    except (TypeError, ValueError):
        auto_limit = DEFAULT_AUTO_STEPS_PER_PUMP
    auto_limit = max(1, min(auto_limit, 10000))
    auto_steps, recent = 0, []
    while cur:
        auto_steps += 1
        recent.append(cur)
        recent = recent[-20:]
        if auto_steps > auto_limit:
            return _error(
                run, run_path, cur,
                f"자동 실행이 펌프 한도({auto_limit}단계)를 초과했습니다 — "
                "자동 순환 또는 종료되지 않는 재작업 경로를 확인하세요",
                reason_code="auto_step_limit",
                details={"limit": auto_limit, "recent_nodes": recent},
            )
        if cur not in idx:
            return _error(run, run_path, cur, f"설계도에 없는 노드입니다: {cur}")
        node = task["nodes"][idx[cur]]

        # If 노드 — 판단 라벨로 라우팅
        if node.get("type") == "if":
            entry = util.latest(run, node.get("source_node", ""))
            label = entry.get("label") if entry else None
            if label is None:
                return _error(run, run_path, cur,
                              f"If 분기의 근거 라벨이 없습니다 (source_node: {node.get('source_node')})"
                              " — 라벨 없는 산출형 판단은 If의 근거가 될 수 없습니다."
                              " /e2e-agent-validator로 설계를 검증하세요")
            case = next((c for c in node.get("cases", []) if c.get("value") == label), None)
            if case is None:
                return _error(run, run_path, cur, f"라벨 '{label}'에 해당하는 case가 없습니다")
            cur = case.get("next")
            activation = None
            if task.get("schema_version") == "2.2":
                activation = _activate_route(run, node, label)
            _journal(run, "route", node=node.get("id"), detail={
                "source_node": node.get("source_node"),
                "label": label,
                "next": cur,
                **({"activation": activation} if activation else {}),
            })
            run["cursor"] = cur
            util.atomic_write_json(run_path, run)
            continue

        node_state = run.get("nodes", {}).get(node["id"], {})
        if run.pop("execution_claim", None) is not None:
            util.atomic_write_json(run_path, run)

        # custom_skill은 현재 런타임에서 지원하지 않는다. 검증기가 저작
        # 단계에서 거부하지만, 검증을 건너뛴 레거시 task가 오면 조용히 무시하지 않는다
        if node.get("custom_skill"):
            return _error(run, run_path, node["id"],
                          "custom_skill은 지원하지 않는 기능입니다 — "
                          "/e2e-agent-creator 수정 모드로 커스텀 로직 전환이나 "
                          "표준 방식 전환을 진행해 주세요.")

        # 복수 시스템 → 선택
        cfg = _effective_cfg(node, run)
        if cfg is None:
            names = [s.get("name", "?") for s in node["systems"]]
            prompt = ("이 노드에는 대상 시스템이 여러 개 있습니다. 어느 시스템으로 하실래요?\n"
                      + "\n".join(f"- {n}" for n in names))
            return _set_pause(run, run_path, node, "choose_system", prompt, executed=executed)

        # 입력 해석 — 못 구하는 값은 사용자에게
        inputs, missing = _resolve_inputs(task, node, run, runs_dir)
        if missing:
            blocking = [m for m in missing if not m.get("askable")]
            if blocking:
                first = blocking[0]
                if first.get("reason_code") == "missing_dependency_output":
                    reason = ("이전 task의 실행 결과를 찾을 수 없습니다: "
                              f"{first.get('from_task')} / {first.get('from_node')} / "
                              f"{first.get('from_field')} — 같은 건ID로 이전 task를 먼저 "
                              "완료한 뒤 다시 실행하세요")
                elif first.get("reason_code") == "missing_upstream_output":
                    reason = (f"이전 노드 출력이 없습니다: {first.get('source')} — 사용자에게 "
                              "값을 대신 묻지 말고 생산 노드의 실행·출력 설계를 확인하세요")
                elif first.get("reason_code") == "ambiguous_upstream_output":
                    reason = (
                        f"같은 이름의 이전 노드 출력이 여러 개라 연결을 판별할 수 없습니다: "
                        f"{first.get('source')} — Creator에서 해당 입력의 출처를 다시 "
                        "선택해 출력 ID로 연결하세요")
                elif first.get("reason_code") == "stale_route_activation":
                    reason = (
                        "현재 상위 분기에서 선택되지 않은 이전 하위 분기의 입력은 "
                        f"사용할 수 없습니다: {first.get('field')}"
                    )
                elif first.get("reason_code") == "ambiguous_input_identity":
                    reason = (
                        "동명 입력의 출처를 구분할 수 없습니다: "
                        + ", ".join(first.get("fields") or [])
                        + " — 생산 노드 이름을 서로 다르게 지정하거나 입력 연결을 확인하세요"
                    )
                else:
                    reason = f"해석할 수 없는 입력 source입니다: {first.get('source')}"
                return _error(run, run_path, node["id"], reason,
                              reason_code=first.get("reason_code"),
                              details={"consumer_node": node["id"], "missing": blocking})
            dependencies = [m for m in missing
                            if m.get("reason_code") == "missing_dependency_output"]
            if dependencies:
                prompt = (
                    "이전 Task 실행 결과가 없습니다. 아래 값을 직접 입력하거나 AI 더미 초안을 "
                    "생성한 뒤 검토하여 실행을 계속하세요."
                )
                fields = [{key: value for key, value in item.items()
                           if key in ("id", "name", "description", "source", "from_task",
                                      "from_node", "from_field", "consumer_field",
                                      "consumer_input")}
                          for item in dependencies]
                return _set_pause(run, run_path, node, "ask_dependency_dummy", prompt,
                                  fields, slot="inputs", targets=dependencies,
                                  executed=executed)
            prompt = ("다음 값을 자동으로 확인할 수 없습니다. 확인해서 알려 주세요:\n"
                      + "\n".join(f"- {m['name']}" for m in missing))
            return _set_pause(run, run_path, node, "ask_user", prompt,
                              [{"id": m["id"], "name": m["name"]} for m in missing],
                              slot="inputs", targets=missing, executed=executed)

        # schema 2.1 명시 승인 — debug 승인과 별도 상태로 저장해 재진입 중복 질문 방지
        node_test_execution = ctx.get("node_test") is True
        if (
            _approval_required(node, cfg)
            and not node_state.get("approved")
            and not node_test_execution
        ):
            detail_obj = {"node": node.get("name", node["id"]),
                          "action_type": node.get("action_type"), "inputs": inputs}
            if cfg.get("method"):
                detail_obj["method"] = cfg.get("method")
            prompt = ("아래 외부 쓰기 작업을 실행하려고 합니다. 진행할까요?\n"
                      + json.dumps(detail_obj, ensure_ascii=False, indent=2))
            return _set_pause(run, run_path, node, "confirm", prompt,
                              slot="approval", executed=executed, inputs=inputs)

        # debug 모드 — write류 실행 전 확인
        if debug and node.get("action_type") in WRITE_TYPES and not node_state.get("confirmed"):
            detail_obj = {"node": node.get("name", node["id"]),
                          "request": (cfg.get("integration") or {}).get("request", {}),
                          "inputs": inputs}
            if node.get("custom_logic"):
                detail_obj["custom_logic"] = node["custom_logic"]
            detail = json.dumps(detail_obj, ensure_ascii=False, indent=2)
            prompt = "[debug] 아래 내용을 실행하려고 합니다. 진행할까요?\n" + detail
            return _set_pause(
                run, run_path, node, "confirm", prompt,
                executed=executed, inputs=inputs)

        # 비멱등 write 중복 실행 보호 — 부작용 직전에 attempt 마커를 디스크에
        # 남긴다. 마커가 남은 채 재진입하면(시도 후 결과 미기록: 크래시·timeout 후
        # 실제 반영 등) 무조건 재실행하지 않고 사용자 확인을 거친다.
        guarded = _guarded_write(node, cfg)
        if guarded:
            ns = run.setdefault("nodes", {}).setdefault(node["id"], {})
            if ns.get("attempt") and not ns.pop("attempt_confirmed", False):
                prompt = ("이 실행 노드는 이전에 실행이 시도되었으나 결과가 기록되지 "
                          f"않았습니다 (시도 시각: {ns['attempt'].get('at', '?')}). "
                          "대상 시스템에 이미 반영됐는지 화면에서 확인해 주세요.\n"
                          "- 반영되지 않았으면 '진행'(재실행)\n"
                          "- 이미 반영됐거나 판단이 어려우면 '중단' 후 상황을 채팅으로 알려 주세요")
                _journal(run, "write_attempt", node=node["id"],
                         detail=f"이전 시도 미기록(시도: {ns['attempt'].get('at', '?')}) — 재확인 요청")
                return _set_pause(run, run_path, node, "confirm", prompt,
                                  slot="confirm_retry", executed=executed,
                                  inputs=inputs)
            ns["attempt"] = {"at": _now()}
            util.atomic_write_json(run_path, run)

        # custom_logic 탈출구 — 핸들러 대신 폴더의 run.py를 동기 실행
        if node.get("custom_logic"):
            invoke = lambda: _run_custom_logic(node, inputs, run, ctx)
        else:
            handler = HANDLERS.get(node.get("action_type"))
            if handler is None:
                return _error(run, run_path, node["id"],
                              f"알 수 없는 action_type: {node.get('action_type')}")
            bound_ctx = dict(ctx)
            bound_ctx["resolve"] = lambda src: util.resolve_source(
                _runtime_output_source(task, src)[0], run)
            bound_ctx["project_root"] = workspace.project_root(run["task_ref"])
            invoke = lambda: handler(node, cfg, inputs, bound_ctx)

        result = invoke()

        if "error" in result:
            return _error(
                run, run_path, node["id"], result["error"],
                redact_persisted_reason=bool(ctx.get("redact_logs")))
        if "pause" in result:
            p = result["pause"]
            return _set_pause(run, run_path, node, p["kind"], p["prompt"], p.get("fields"),
                              slot=p.get("slot"), executed=executed,
                              open_url=p.get("open_url"), inputs=inputs)
        if result.get("attempts", 1) > 1:   # HTTP 일시 오류를 재시도로 넘긴 흔적
            _journal(run, "retry", node=node["id"],
                     detail=f"HTTP 일시 오류 — {result['attempts']}회 시도 끝에 성공")

        _record(run, node["id"], _result_entry(result),
                node=node, inputs=inputs)
        if guarded:  # 성공 기록과 같은 저장에 묶어 마커 해제
            run["nodes"][node["id"]].pop("attempt", None)
        executed.append(_node_label(node))
        cur = _next_node(task, idx, node)
        run["cursor"] = cur
        util.atomic_write_json(run_path, run)
    return _done(run, run_path, executed=executed)


# ------------------------------------------------------------------ 공개 API

@mutation_lock.serialized_keyed_path_mutation(
    path_arg=0, key_arg=1, path_kw="task_path", key_kw="key")
def start(task_path, key="default", runs_dir=workspace.RUNS_DIR, ctx=None, debug=False):
    ctx = ctx or default_ctx()
    task = task_compat.load_effective_task(task_path)
    schema_error = _schema_version_error(task)
    if schema_error:
        return {
            "status": "error",
            "reason": schema_error,
            "reason_code": "unsupported_schema_version",
        }
    try:
        run_path = find_existing_run_path(
            runs_dir, task["activity"], task["task_id"], key)
        if run_path is None:
            run_path = _new_run_file_path(
                runs_dir, task["activity"], task["task_id"], key)
    except ValueError as exc:
        return {"status": "error", "reason": str(exc)}
    if runs_dir == workspace.RUNS_DIR and not os.path.exists(run_path):
        legacy = find_existing_run_path(
            "runs", task["activity"], task["task_id"], key)
        if legacy is not None:
            run_path = legacy

    if os.path.exists(run_path):
        run = util.load_json(run_path)
        if run["status"] == "done":
            return {"status": "error", "run": run_path,
                    "reason": "이 건ID로는 이미 완료된 run이 있습니다. runs 명령으로 기존 건 "
                    "목록과 제안 건ID(next_key)를 확인해 다른 건ID로 시작해 주세요: "
                    f'python ops_runtime/engine.py runs "{task_path}"'}
        if run.get("snapshot_ref"):
            task = _load_run_task(run, run_path)
        else:
            # Legacy runs are upgraded only while their original fingerprint
            # still matches.  Existing mismatched artifacts keep the old,
            # explicit conflict instead of guessing a definition.
            task = _upgrade_run_snapshot(run_path, run, task=task)
            if task is None:
                return _error(
                    run, run_path, run.get("waiting_node"),
                    _FINGERPRINT_MISMATCH)
        schema_error = _schema_version_error(task)
        if schema_error:
            return _error(
                run, run_path, run.get("waiting_node"), schema_error,
                reason_code="unsupported_schema_version")
        if run["status"] == "waiting":
            # 재진입 — 같은 일시정지를 다시 안내. 구버전 run에는 라벨이 없다 → 보충
            if not run.get("waiting_node_label"):
                node = next((n for n in task["nodes"]
                             if n.get("id") == run.get("waiting_node")), None)
                if node is not None:
                    run["waiting_node_label"] = _node_label(node)
            _journal(run, "start", detail="재진입 — 대기 중 일시정지 재안내")
            util.atomic_write_json(run_path, run)
            result = _pause_result(run_path, run)
            age = _waiting_age_hours(run)
            age_txt = f", 대기 경과: 약 {age}시간" if age is not None else ""
            result["note"] = (f"기존 미완료 run을 이어갑니다 (시작: {run.get('started_at', '?')}"
                              f"{age_txt}). 이 사실을 사용자에게 알려라. "
                              "처음부터 다시 하려면 다른 건ID로 시작한다.")
            return result
        _journal(run, "start", detail=f"재진입 — {run['status']} 상태에서 이어서 실행")
        return _pump(task, run, run_path, ctx, debug, runs_dir)

    first = task["nodes"][0]["id"] if task["nodes"] else None
    snapshot_ref, snapshot_fingerprint, task, snapshot_base = _create_run_snapshot(
        run_path, task, task_path)
    run = {
        "task_ref": os.path.abspath(task_path),
        "task_fingerprint": _task_fingerprint(task_path),
        "snapshot_ref": snapshot_ref,
        "snapshot_fingerprint": snapshot_fingerprint,
        "snapshot_base": snapshot_base,
        "run_id": hashlib.sha256(
            (os.path.normcase(os.path.realpath(run_path)) + "\0" + _now()).encode(
                "utf-8")
        ).hexdigest()[:32],
        "activity": task["activity"],
        "task_id": task["task_id"],
        "key": key,
        "status": "running",
        "cursor": first,
        "waiting_node": None, "waiting_node_label": None, "waiting_kind": None,
        "waiting_prompt": None, "waiting_fields": [], "waiting_slot": None,
        "waiting_targets": [],
        "waiting_open_url": None, "waiting_url_opened_at": None,
        "waiting_since": None,
        "nodes": {}, "inputs_from": {}, "manual_inputs": {},
        "started_at": _now(),
    }
    if task.get("schema_version") == "2.2":
        run["schema_version"] = "2.2"
        run["execution_epoch"] = 0
        run["route_activations"] = {}
    _journal(run, "start")
    util.atomic_write_json(run_path, run)
    dependency_pause = _dependency_dummy_pause(task, run, run_path, runs_dir)
    if dependency_pause is not None:
        return dependency_pause
    util.atomic_write_json(run_path, run)
    return _pump(task, run, run_path, ctx, debug, runs_dir)


@mutation_lock.serialized_run_mutation(path_arg=0, path_kw="run_path")
def resume(run_path, node_id, payload, ctx=None, debug=False,
           defer_pump=False):
    ctx = ctx or default_ctx()
    run = util.load_json(run_path)
    runs_dir = os.path.dirname(os.path.abspath(run_path))
    task = _upgrade_run_snapshot(run_path, run)

    def _rej(reason):
        # 거부된 시도도 저널에 남긴다. 실행 상태는 여전히 불변이다.
        payload_detail = (
            {"keys": sorted(str(key) for key in payload)[:20],
             "redacted": True}
            if ctx.get("redact_logs") and isinstance(payload, dict)
            else _payload_summary(payload)
        )
        _journal(run, "resume_rejected", node=node_id,
                 detail={"reason": str(reason)[:200], "payload": payload_detail})
        util.atomic_write_json(run_path, run)
        return _rejected(run_path, node_id, reason)

    if task is not None:
        schema_error = _schema_version_error(task)
        if schema_error:
            return _error(
                run, run_path, node_id, schema_error,
                reason_code="unsupported_schema_version")

    if run["status"] != "waiting":
        return _rej(
            f"이 run은 대기 상태가 아닙니다 (현재: {run['status']}). "
            "start 명령을 다시 실행하면 이어서 진행됩니다")
    if task is None:
        return _error(run, run_path, node_id, _FINGERPRINT_MISMATCH)
    if node_id != run["waiting_node"]:
        return _rej(
            f"대기 중인 노드는 '{run['waiting_node']}'입니다. '{node_id}'로는 재개할 수 없습니다")

    # resume 정합성 체크 — 설계도와 진행상태의 어긋남 방지
    idx = _node_index(task)
    node = task["nodes"][idx[node_id]] if node_id in idx else None
    if node is None or node.get("action_type") != run.get("waiting_action_type"):
        return _error(run, run_path, node_id,
                      "대기 중이던 노드가 설계도에서 삭제·변경되었습니다. 저작 수정과 진행상태가 어긋난 상태라 "
                      "이 건은 재개할 수 없습니다. 새 건ID로 처음부터 실행해 주세요.")

    slot = run.get("waiting_slot")
    waiting_kind = run.get("waiting_kind")

    def _evidence_error(output, label_mode=False):
        if node.get("action_type") != "decision" or not node.get("evidence_required"):
            return None
        evidence = payload.get("evidence")
        if not isinstance(evidence, dict):
            return '판단 payload에 "evidence" 객체가 필요합니다'
        root_key = "label" if label_mode else "summary"
        if not str(evidence.get(root_key) or "").strip():
            return f'판단 evidence에 "{root_key}" 근거가 필요합니다'
        output_evidence = evidence.get("outputs")
        output_evidence = output_evidence if isinstance(output_evidence, dict) else {}
        unsupported = [fid for fid, value in (output or {}).items()
                       if value is not None and not str(output_evidence.get(fid) or "").strip()]
        if unsupported:
            return "null이 아닌 판단 출력에 근거가 없습니다: " + ", ".join(unsupported)
        sources = evidence.get("sources")
        if sources is not None:
            if not isinstance(sources, list) or len(sources) > 50:
                return "evidence.sources는 최대 50개의 근거 목록이어야 합니다"
            for source in sources:
                if not isinstance(source, dict):
                    return "각 evidence.sources 항목은 객체여야 합니다"
                path, reason = source.get("path"), source.get("reason")
                if not isinstance(path, str) or not path.strip():
                    return "각 근거에는 비어 있지 않은 path가 필요합니다"
                if not isinstance(reason, str) or not reason.strip():
                    return "각 근거에는 비어 있지 않은 reason이 필요합니다"
                checked, path_error = _authorized_task_path(ctx, path.strip(), "read")
                if path_error:
                    return path_error
                if not os.path.isfile(checked):
                    return f"근거 path는 실제 파일이어야 합니다: {path}"
                for key in ("line_start", "line_end"):
                    value = source.get(key)
                    if value is not None and (not isinstance(value, int) or value < 1):
                        return f"근거의 {key}는 1 이상의 정수여야 합니다"
        return None

    if slot in ("output", "inputs"):
        out = payload.get("output")
        if not isinstance(out, dict):
            return _rej('payload에 "output" 객체가 없습니다')
        required = [f["id"] for f in run.get("waiting_fields", [])]
        lacking = [f for f in required if f not in out]
        if lacking:
            return _rej("필수 값이 없습니다: " + ", ".join(lacking))
        # 빈 문자열은 "받지 않은 값"이다 — 사용자가 '없음'이라고 확인한 필드만 null 허용
        empty = [f for f in required
                 if isinstance(out.get(f), str) and not out[f].strip()]
        if empty:
            return _rej(
                "빈 값은 허용되지 않습니다: " + ", ".join(empty)
                + " — 사용자에게 값을 받아 채우거나, 사용자가 '없음'이라고"
                " 확인한 필드만 null로 보내세요")
        if slot == "output":
            evidence_error = _evidence_error(out, label_mode=False)
            if evidence_error:
                return _rej(evidence_error)
            entry = {"output": out}
            if node.get("action_type") == "decision" and payload.get("evidence"):
                entry["evidence"] = payload["evidence"]
            _record(run, node_id, entry, node=node,
                    trace=run.get("waiting_trace"))
            run["cursor"] = _next_node(task, idx, node)
        else:  # inputs — 값을 저장하고 같은 노드를 다시 실행
            dummy_origin = str(payload.get("dependency_dummy_origin") or "manual")
            if dummy_origin not in ("manual", "ai", "reuse"):
                dummy_origin = "manual"
            for t in run.get("waiting_targets", []):
                if t["target"] == "inputs_from":
                    actual_ok, actual_value = False, None
                    if waiting_kind == "ask_dependency_dummy" and t.get("from_task"):
                        actual_ok, actual_value = _load_sibling_input(
                            t, run, runs_dir, run["key"])
                    target_ids = [item for item in (t.get("target_ids") or [t["id"]])
                                  if item]
                    if actual_ok:
                        for target_id in target_ids:
                            run.setdefault("inputs_from", {})[target_id] = actual_value
                            run.setdefault("dependency_dummy_inputs", {}).pop(
                                target_id, None)
                        continue
                    value = out[t["id"]]
                    for target_id in target_ids:
                        run.setdefault("inputs_from", {})[target_id] = value
                        if waiting_kind == "ask_dependency_dummy":
                            run.setdefault("dependency_dummy_inputs", {})[target_id] = {
                                "origin": dummy_origin,
                                "at": _now(),
                                "source": t.get("source"),
                                "from_task": t.get("from_task"),
                                "from_node": t.get("from_node"),
                                "from_field": t.get("from_field"),
                                "consumer_node": node_id,
                                "consumer_nodes": [
                                    item.get("node_id") for item in t.get("consumers") or []
                                    if item.get("node_id")
                                ],
                                "consumer_field": t.get("consumer_field"),
                            }
                else:
                    run.setdefault("manual_inputs", {}).setdefault(node_id, {})[t["id"]] = out[t["id"]]
            if waiting_kind == "ask_dependency_dummy":
                run["dependency_preflight_completed"] = True
    elif slot == "label":
        labels = node.get("labels") or []
        # 정규화 유일 일치는 원문으로 치환해 수용 — 기록은 항상 task 원문 라벨
        label = _lenient_label(payload.get("label"), labels)
        if label is None:
            return _rej(f"'{payload.get('label')}'은 허용된 라벨이 아닙니다. "
                        f"다음 중 하나여야 합니다: {', '.join(labels)}")
        entry = {"label": label}
        # 출력 필드가 선언된 판단 노드 — 라벨만으로는 후속 노드가 쓸 값이 없다.
        declared = node.get("outputs") or []
        if declared:
            out = payload.get("output")
            if not isinstance(out, dict):
                return _rej(
                    '이 판단 노드에는 출력 필드가 있습니다 — payload에 "output" 객체로 '
                    "함께 채워 주세요: " + ", ".join(o["id"] for o in declared))
            lacking = [o["id"] for o in declared if o["id"] not in out]
            empty = [o["id"] for o in declared
                     if isinstance(out.get(o["id"]), str) and not out[o["id"]].strip()]
            if lacking or empty:
                return _rej(
                    "판단 출력 필드가 비었습니다: " + ", ".join(lacking + empty)
                    + " — 판단 내용으로 채우거나, 해당 없음이면 null로 보내세요")
            entry["output"] = out
        evidence_error = _evidence_error(entry.get("output", {}), label_mode=True)
        if evidence_error:
            return _rej(evidence_error)
        if payload.get("evidence"):
            entry["evidence"] = payload["evidence"]
        _record(run, node_id, entry, node=node,
                trace=run.get("waiting_trace"))
        run["cursor"] = _next_node(task, idx, node)
    elif slot == "content":
        content = payload.get("content")
        if not isinstance(content, str) or not content:
            return _rej('payload에 "content" 문자열이 없습니다')
        cfg = _effective_cfg(node, run) or node
        inputs, _ = _resolve_inputs(task, node, run, runs_dir)
        bound_ctx = dict(ctx)
        bound_ctx["resolve"] = lambda src: util.resolve_source(src, run)
        bound_ctx["project_root"] = workspace.project_root(run["task_ref"])
        result = HANDLERS[node["action_type"]](node, cfg, inputs, bound_ctx, provided=content)
        if "error" in result:
            return _error(
                run, run_path, node_id, result["error"],
                redact_persisted_reason=bool(ctx.get("redact_logs")))
        _record(run, node_id, _result_entry(result),
                node=node, trace=run.get("waiting_trace"))
        run["cursor"] = _next_node(task, idx, node)
    elif slot == "path":
        # llm_find_file — AI 에이전트는 경로만 찾고, 읽기는 엔진이 한다.
        # 실존하지 않는 경로·선언 폴더 밖 경로는 지어내기로 간주해 거부한다.
        path = payload.get("path")
        if not isinstance(path, str) or not path.strip():
            return _rej('payload에 "path" 문자열이 없습니다')
        path, auth_error = _authorized_task_path(ctx, path.strip(), "read")
        if auth_error:
            return _rej(auth_error)
        if not os.path.isfile(path):
            return _rej(
                f"실제 존재하는 파일이 아닙니다: {path} — 경로를 지어내지 말고 "
                "폴더에서 찾은 실존 파일의 경로만 보내세요")
        cfg = _effective_cfg(node, run) or node
        directory = cfg.get("directory")
        if directory:
            directory, auth_error = _authorized_task_path(ctx, directory, "read")
            if auth_error:
                return _rej(auth_error)
            real_dir = os.path.realpath(directory)
            real_path = os.path.realpath(path)
            if real_path != real_dir and not real_path.startswith(real_dir + os.sep):
                return _rej(
                    f"선언된 폴더({directory}) 밖의 파일입니다: {path} — 폴더 안에서 "
                    "찾거나, 파일이 실제로 다른 곳에 있다면 저작 수정으로 directory를 "
                    "바꿔야 합니다")
        inputs, _ = _resolve_inputs(task, node, run, runs_dir)
        bound_ctx = dict(ctx)
        bound_ctx["resolve"] = lambda src: util.resolve_source(src, run)
        bound_ctx["project_root"] = workspace.project_root(run["task_ref"])
        result = HANDLERS[node["action_type"]](node, cfg, inputs, bound_ctx, provided=path)
        if "error" in result:
            return _error(
                run, run_path, node_id, result["error"],
                redact_persisted_reason=bool(ctx.get("redact_logs")))
        _record(run, node_id, {"output": result.get("output", {}), "path": path},
                node=node, trace=run.get("waiting_trace"))
        run["cursor"] = _next_node(task, idx, node)
    elif slot == "system":
        name = payload.get("system")
        names = [s.get("name") for s in node.get("systems", [])]
        if name not in names:
            return _rej(
                f"'{name}'은 이 노드의 시스템이 아닙니다. 선택지: {', '.join(names)}")
        run.setdefault("nodes", {}).setdefault(node_id, {})["system"] = name
    elif slot == "confirm":
        confirmed = payload.get("confirmed")
        if confirmed is True:
            run.setdefault("nodes", {}).setdefault(node_id, {})["confirmed"] = True
        elif confirmed is False:
            return _error(run, run_path, node_id, "사용자가 실행을 중단했습니다")
        else:
            return _rej('payload에 "confirmed": true|false 가 없습니다')
    elif slot == "approval":
        confirmed = payload.get("confirmed")
        if confirmed is True:
            run.setdefault("nodes", {}).setdefault(node_id, {})["approved"] = True
        elif confirmed is False:
            return _error(run, run_path, node_id,
                          "사용자가 외부 쓰기 작업을 승인하지 않았습니다",
                          reason_code="approval_denied")
        else:
            return _rej('payload에 "confirmed": true|false 가 없습니다')
    elif slot == "confirm_retry":
        # write 중복 실행 보호의 재확인 — debug confirm(confirmed 키)과 상태를
        # 분리해야 debug 승인으로 보호가 우회되지 않는다
        confirmed = payload.get("confirmed")
        if confirmed is True:
            run.setdefault("nodes", {}).setdefault(node_id, {})["attempt_confirmed"] = True
        elif confirmed is False:
            return _error(run, run_path, node_id,
                          "사용자가 재실행을 중단했습니다 — 대상 시스템에 이미 반영된 경우라면 "
                          "남은 절차를 수동으로 마무리하거나, 필요한 지점부터 새 건ID로 진행해 주세요.")
        else:
            return _rej('payload에 "confirmed": true|false 가 없습니다')
    elif slot == "confirm_done":
        # manual 실행/알림의 완료 확인 — 안 했으면 완료된 척 기록하지 않는다.
        confirmed = payload.get("confirmed")
        if confirmed is True:
            _record(run, node_id, {"output": {}, "manual_done": True},
                    node=node, trace=run.get("waiting_trace"))
            run["cursor"] = _next_node(task, idx, node)
        elif confirmed is False:
            return _error(run, run_path, node_id,
                          "사용자가 수동 작업을 완료하지 않아 중단했습니다. 완료 후 다시 실행해 주세요.")
        else:
            return _rej('payload에 "confirmed": true|false 가 없습니다')
    else:
        return _rej(f"알 수 없는 대기 슬롯: {slot}")

    _journal(run, "resume_accepted", node=node_id)
    _clear_wait(run)
    util.atomic_write_json(run_path, run)
    if defer_pump:
        return {"status": "running", "run": run_path}
    return _pump(task, run, run_path, ctx, debug, runs_dir)


@mutation_lock.serialized_run_mutation(path_arg=0, path_kw="run_path")
def continue_run(run_path, ctx=None, debug=False):
    """Continue a non-waiting run from its pinned definition."""
    ctx = ctx or default_ctx()
    run = util.load_json(run_path)
    if run.get("status") == "waiting":
        return _pause_result(run_path, run)
    if run.get("status") == "done":
        return {
            "status": "done", "run": run_path,
            "progress": _progress(run),
            "result_summary": _result_summary(run),
        }
    task = _upgrade_run_snapshot(run_path, run)
    if task is None:
        return _error(
            run, run_path, run.get("waiting_node"), _FINGERPRINT_MISMATCH)
    return _pump(
        task, run, run_path, ctx, debug,
        os.path.dirname(os.path.abspath(run_path)))


def status(run_path):
    run = util.load_json(run_path)
    out = {"status": run["status"], "run": run_path, "task_ref": run["task_ref"],
           "key": run["key"], "waiting_node": run.get("waiting_node"),
           "waiting_node_label": run.get("waiting_node_label"),
           "waiting_kind": run.get("waiting_kind")}
    if run["status"] == "waiting":
        age = _waiting_age_hours(run)
        if age is not None:
            out["waiting_age_hours"] = age
            out["long_waiting"] = age >= LONG_WAITING_HOURS
    if run.get("journal"):
        out["journal_tail"] = run["journal"][-3:]   # 최근 이벤트 — 진단용
    return out


def list_runs(task_path, runs_dir=workspace.RUNS_DIR):
    """이 task의 기존 run 목록 + 다음 건ID 제안.

    실측: 건ID 충돌을 start의 에러로만 알게 되고, 기존 건 현황을 보여줄 수단이 없어
    AI 에이전트가 폴더를 수동 탐색했다. 파일명은 _sanitize가 비가역이라 파싱하지 않는다 —
    run JSON의 activity/task_id 필드로 대조한다."""
    task = task_compat.load_effective_task(task_path)
    runs, keys = [], set()
    locations = [runs_dir]
    if runs_dir == workspace.RUNS_DIR and os.path.isdir("runs"):
        locations.append("runs")  # 구버전 진행 건은 계속 보이고 재개할 수 있다
    files = []
    for location in locations:
        try:
            files.extend((location, name) for name in sorted(os.listdir(location)))
        except OSError:
            pass
    for location, name in files:
        if not name.endswith(".json"):
            continue
        try:
            run = util.load_json(os.path.join(location, name))
        except Exception:
            continue  # 손상 파일은 목록에서 제외한다 — 새 건 시작을 막을 이유가 없다
        if (run.get("activity") != task.get("activity")
                or run.get("task_id") != task.get("task_id")):
            continue
        keys.add(run.get("key"))
        progress = _progress(run) or {"completed": 0, "total": 0, "current": None}
        completed_nodes = []
        for task_node in task.get("nodes") or []:
            if task_node.get("type") == "if":
                continue
            if util.latest(run, task_node.get("id")) is not None:
                completed_nodes.append(_node_label(task_node))
        item = {"key": run.get("key"), "status": run.get("status"),
                "started_at": run.get("started_at"),
                "waiting_node_label": run.get("waiting_node_label"),
                "progress": progress,
                "latest_completed_node": completed_nodes[-1] if completed_nodes else None,
                "updated_at": ((run.get("journal") or [{}])[-1].get("at")
                               or run.get("waiting_since") or run.get("started_at"))}
        if run.get("status") == "waiting":
            # 장기 대기 표시 — 협의·CAB 대기는 며칠이 정상일 수 있으므로
            # 이상 상태가 아니라 정보성 배지다. 자동 만료는 하지 않는다.
            age = _waiting_age_hours(run)
            if age is not None:
                item["waiting_age_hours"] = age
                item["long_waiting"] = age >= LONG_WAITING_HOURS
        runs.append(item)
    # 다음 건ID 제안 — 완료된 건ID로는 start가 거부하므로 전체 key와 비충돌해야 한다
    today = datetime.date.today().strftime("%Y%m%d")
    n = 1
    while f"{today}-{n}" in keys:
        n += 1
    active = [item for item in runs if item.get("status") != "done"]
    completed = [item for item in runs if item.get("status") == "done"]
    active.sort(key=lambda item: str(item.get("updated_at") or ""), reverse=True)
    completed.sort(key=lambda item: str(item.get("updated_at") or ""), reverse=True)
    choices = []
    for number, item in enumerate(active, 1):
        progress = item.get("progress") or {}
        current = item.get("waiting_node_label") or item.get("status")
        choices.append({
            "number": number,
            "action": "resume",
            "key": item.get("key"),
            "display": (f"{number}. {item.get('key')} — "
                        f"{progress.get('completed', 0)}/{progress.get('total', 0)} 완료"
                        f" · {current}"),
        })
    new_number = len(choices) + 1
    choices.append({
        "number": new_number,
        "action": "new",
        "display": (f"{new_number}. 신규 작업 — `{new_number}. <새 Key>` 형식으로 입력"
                    f" (추천 Key: {today}-{n})"),
    })
    out = {"status": "ok", "task_id": task.get("task_id"),
           "task_name": task.get("task_name") or task.get("task_id"),
           "runs": runs, "active_runs": active, "completed_runs": completed,
           "next_key": f"{today}-{n}",
           "selection": {
               "mode": "chat_numbered",
               "choice_tool_allowed": False,
               "choices": choices,
               "new_item_number": new_number,
               "reply_format": (f"기존 건: <번호> / 신규 건: {new_number}. <새 Key>"),
               "instruction": ("choices를 채팅에 모두 보여주고 답을 받으세요. 선택 도구를 "
                               "사용하거나 next_key로 자동 시작하지 마세요. 신규 작업은 "
                               "사용자가 Key를 직접 입력해야 합니다."),
           }}
    long_waiting = sum(1 for r in runs if r.get("long_waiting"))
    if long_waiting:
        out["long_waiting_count"] = long_waiting
    return out


def choose_run(task_path, selection_text, runs_dir=workspace.RUNS_DIR):
    """채팅의 번호/신규 Key 응답을 결정적으로 해석한다."""
    listed = list_runs(task_path, runs_dir=runs_dir)
    selection = listed["selection"]
    text = str(selection_text or "").strip()
    match = re.match(r"^(\d+)\s*(?:[.)]\s*)?(.*)$", text)
    if not match:
        return {"status": "error", "reason": selection["reply_format"],
                "selection": selection}
    number, suffix = int(match.group(1)), match.group(2).strip()
    active = listed["active_runs"]
    if 1 <= number <= len(active):
        if suffix:
            return {"status": "error", "reason": "기존 건 번호 뒤에는 Key를 입력하지 마세요",
                    "selection": selection}
        key = active[number - 1]["key"]
        return {"status": "ok", "action": "resume", "key": key,
                "start_command": f'python ops_runtime/engine.py start "{task_path}" --key "{key}"'}
    if number != selection["new_item_number"]:
        return {"status": "error", "reason": "목록에 있는 번호를 입력하세요",
                "selection": selection}
    if not suffix:
        return {"status": "error", "reason": "신규 작업에는 Key를 직접 입력해야 합니다",
                "selection": selection}
    if len(suffix) > 100 or re.search(r"[\\/\r\n\x00-\x1f]", suffix):
        return {"status": "error", "reason": "Key는 100자 이하이며 경로 문자나 제어 문자를 포함할 수 없습니다",
                "selection": selection}
    existing = {str(item.get("key")) for item in listed["runs"]}
    if suffix in existing:
        return {"status": "error", "reason": f"이미 존재하는 Key입니다: {suffix}",
                "selection": selection}
    return {"status": "ok", "action": "new", "key": suffix,
            "start_command": f'python ops_runtime/engine.py start "{task_path}" --key "{suffix}"'}


def _task_fingerprint(task_path):
    """task 파일의 지문 — run 생성 시 기록하고 재개 때 대조한다.

    설계도가 저작 수정으로 바뀌었는데 옛 진행 기록에 조용히 접붙는 사고 방지."""
    import hashlib
    with open(task_path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()[:16]


_FINGERPRINT_MISMATCH = ("설계도(task JSON)가 이 건을 시작한 뒤에 저작 수정으로 변경되었습니다. "
                         "옛 진행 기록과 섞이면 잘못된 값이 흐르므로 이 건은 재개할 수 없습니다. "
                         "선택지: ① 새 건ID로 처음부터 실행 ② 이 건의 기록을 버려도 된다면 "
                         "사용자에게 확인받은 뒤 run 파일을 삭제하고 같은 건ID로 다시 시작.")


def _cleanup_payload(path, status):
    """payload는 1회용 — 엔진이 소비하면 삭제한다.

    rejected(되물음 중)와 error는 보존 — 실측: 환경 문제(폴더 부재)로 error가 난 뒤
    원인을 고치고 재시도할 때 같은 payload를 다시 작성해야 했다. error 후 start
    재진입은 같은 노드에서 같은 payload 경로로 다시 정지하므로 재사용이 안전하다."""
    if status in ("rejected", "error"):
        return
    if not workspace.is_consumable_payload(path):
        return
    try:
        os.remove(path)
    except OSError:
        pass


def _waiting_url_pending(run_path, node_id):
    """락을 잡기 전에 '정말 열 것이 있는지'만 싸게 확인한다 — 판단은 락 안에서 다시 한다."""
    try:
        run = util.load_json(run_path)
    except (OSError, ValueError):
        return False
    return (run.get("status") == "waiting"
            and run.get("waiting_node") == node_id
            and bool(run.get("waiting_open_url"))
            and not run.get("waiting_url_opened_at"))


def _wait_before_open_waiting_url(run_path, node_id, delay):
    """열기 전 안내 대기를 mutation lock 밖에서 수행한다."""
    delay = max(0, min(int(delay), 10))
    if delay and _waiting_url_pending(run_path, node_id):
        time.sleep(delay)


def open_waiting_url(run_path, node_id, delay=2, ctx=None):
    """사용자 안내가 표시된 뒤 대기 중 manual 작업 화면을 한 번만 연다.

    안내를 읽을 시간을 주는 이 대기는 **락 밖에서** 한다. 예전에는 프로젝트 전역
    mutation 락을 쥔 채로 최대 10초를 잤고, 그동안 프로젝트의 모든 변경이 막혔다.
    """
    _wait_before_open_waiting_url(run_path, node_id, delay)
    return _open_waiting_url_locked(run_path, node_id, ctx=ctx)


@mutation_lock.serialized_run_mutation(path_arg=0, path_kw="run_path")
def _open_waiting_url_locked(run_path, node_id, ctx=None):
    run = util.load_json(run_path)
    if run.get("status") != "waiting" or run.get("waiting_node") != node_id:
        return {"status": "error", "reason": "현재 대기 중인 노드의 작업 화면이 아닙니다"}
    url = run.get("waiting_open_url")
    if not url:
        return {"status": "error", "reason": "이 단계에는 열 작업 화면 URL이 없습니다"}
    if run.get("waiting_url_opened_at"):
        return {"status": "ok", "opened": False, "already_opened": True, "url": url}
    opener = (ctx or default_ctx()).get("open_url", lambda value: False)
    opened = bool(opener(url))
    if opened:
        run["waiting_url_opened_at"] = _now()
        util.atomic_write_json(run_path, run)
    return {"status": "ok" if opened else "error", "opened": opened, "url": url,
            "reason": None if opened else "기본 브라우저를 열지 못했습니다 — 표시된 URL을 직접 여세요"}


# ------------------------------------------------------------------ CLI

def main(argv=None):
    util.utf8_stdout()
    p = argparse.ArgumentParser(description="운영업무 자동화 런타임 v2 엔진 (AI 에이전트가 실행)")
    sub = p.add_subparsers(dest="cmd", required=True)

    sp = sub.add_parser("start", help="task 실행 시작(또는 대기 중 run 재진입)")
    sp.add_argument("task_json")
    sp.add_argument("--key", required=True, help="사용자가 선택·입력한 건 식별자 (예: 티켓 키)")
    sp.add_argument("--runs-dir", default=workspace.RUNS_DIR)
    sp.add_argument("--debug", action="store_true")

    rp = sub.add_parser("resume", help="일시정지된 run 재개")
    rp.add_argument("run_json")
    rp.add_argument("--node", required=True)
    rp.add_argument("--payload-file", required=True)
    rp.add_argument("--debug", action="store_true")

    st = sub.add_parser("status", help="run 상태 확인")
    st.add_argument("run_json")

    lr = sub.add_parser("runs", help="task의 기존 건 목록 + 다음 건ID 제안")
    lr.add_argument("task_json")
    lr.add_argument("--runs-dir", default=workspace.RUNS_DIR)

    cr = sub.add_parser("choose-run", help="runs 목록의 채팅 번호/신규 Key 선택 해석")
    cr.add_argument("task_json")
    cr.add_argument("--selection", required=True)
    cr.add_argument("--runs-dir", default=workspace.RUNS_DIR)

    ou = sub.add_parser("open-url", help="안내 후 대기 중인 manual 작업 화면 열기")
    ou.add_argument("run_json")
    ou.add_argument("--node", required=True)
    ou.add_argument("--delay", type=int, default=2)

    args = p.parse_args(argv)
    try:
        if args.cmd == "start":
            os.makedirs(PAYLOADS_DIR, exist_ok=True)   # AI 에이전트가 payload를 쓸 자리
            res = start(args.task_json, key=args.key, runs_dir=args.runs_dir, debug=args.debug)
        elif args.cmd == "resume":
            payload = util.load_json(args.payload_file)
            res = resume(args.run_json, args.node, payload, debug=args.debug)
            _cleanup_payload(args.payload_file, res.get("status"))
        elif args.cmd == "runs":
            res = list_runs(args.task_json, runs_dir=args.runs_dir)
        elif args.cmd == "choose-run":
            res = choose_run(args.task_json, args.selection, runs_dir=args.runs_dir)
        elif args.cmd == "open-url":
            res = open_waiting_url(args.run_json, args.node, delay=args.delay)
        else:
            res = status(args.run_json)
    except Exception as e:
        # AI 에이전트에게 raw traceback을 던지지 않는다 — 즉흥 대응(파일 삭제·임의 수정)을
        # 유발하는 것이 실측됐다. 항상 일시정지 프로토콜과 같은 JSON 형태로 보고한다.
        res = {"status": "error", "run": None, "node": None,
               "reason": (f"엔진 내부 오류: {type(e).__name__}: {e} — task JSON이 스키마와 "
                          "맞지 않을 수 있습니다. /e2e-agent-validator로 task를 검증하고, 문제가 "
                          "계속되면 사용자에게 상황을 알리고 멈춰라.")}
    print(json.dumps(res, ensure_ascii=False, indent=2))
    return 0 if res.get("status") in ("done", "paused", "ok") else 1


if __name__ == "__main__":
    sys.exit(main())
