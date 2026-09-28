# -*- coding: utf-8 -*-
"""핸들러 공용 헬퍼 — HTTP/로컬 명령 실행과 프롬프트 조립."""
import re
import time

from ..util import (
    named_placeholder_refs,
    normalize_named_placeholders,
    resolve_response_field_found,
)

# HTTP 일시 오류 재시도 정책 — 엔진 전역 기본값.
# GET(멱등)만 자동 재시도한다. 비-GET은 5xx여도 서버가 이미 처리했을 수 있어(중복 부작용)
# 재시도하지 않는다. 599는 _default_http가 네트워크 예외를 환원한 코드.
RETRY_STATUS = {429, 500, 502, 503, 504, 599}
RETRY_MAX = 3                  # 총 시도 횟수 (재시도 2회)
RETRY_BACKOFF = (1, 3)         # n번째 재시도 전 대기(초)


class SafeDict(dict):
    """format_map용 – 모르는 placeholder는 그대로 남긴다."""
    def __missing__(self, key):
        return "{" + key + "}"


def _authorize_with(ctx, callback_name, path, mode):
    authorize = (ctx or {}).get(callback_name)
    if authorize is None:
        return path, None
    try:
        resolved = authorize(path, mode)
    except (OSError, ValueError, PermissionError) as exc:
        return None, f"허용되지 않은 파일 경로입니다: {path} ({exc})"
    if resolved is False or resolved is None:
        return None, f"허용되지 않은 파일 경로입니다: {path}"
    return str(resolved), None


def authorize_path(ctx, path, mode="read"):
    """Controller 상태·실행 코드 등 제어 영역의 경로 정책을 적용한다."""
    return _authorize_with(ctx, "authorize_path", path, mode)


def authorize_task_path(ctx, path, mode="read"):
    """Task가 선언한 파일 자원의 경로 정책을 적용한다.

    새 콜백을 제공하지 않는 기존 서비스 ctx에서는 종전의 ``authorize_path`` 정책을
    사용한다. 직접 실행 ctx에는 두 콜백이 모두 없으므로 submit 엔진처럼 원래 경로를
    그대로 사용한다.
    """
    if (ctx or {}).get("authorize_task_path") is not None:
        return _authorize_with(ctx, "authorize_task_path", path, mode)
    return authorize_path(ctx, path, mode)


def fields_from_outputs(node):
    return [{"id": o["id"], "name": o.get("name", o["id"])} for o in node.get("outputs", [])]


def attach_suggestions(fields, inputs):
    """출력 필드와 이름이 같은 입력값을 suggested 값으로 제공한다.

    값은 run 상태에서 가져오며 사용자가 확인한 뒤에만 사용한다. 하나 이상의 필드에
    값을 추가하면 True를 반환한다.
    """
    hit = False
    for f in fields:
        name = f.get("name")
        if name in inputs and inputs[name] is not None and str(inputs[name]).strip():
            f["suggested"] = inputs[name]
            hit = True
    return hit


def fmt_value(v):
    """null과 빈 값을 사용자 화면에서 ``(없음)``으로 표시한다."""
    if v is None:
        return "(없음)"
    s = str(v)
    return s if s.strip() else "(없음)"


def input_lines(inputs):
    if not inputs:
        return "(입력 없음)"
    return "\n".join(f"- {k}: {fmt_value(v)}" for k, v in inputs.items())


def pause(kind, prompt, fields=None, slot=None, open_url=None):
    p = {"kind": kind, "prompt": prompt, "fields": fields or []}
    if slot:
        p["slot"] = slot
    if open_url:
        p["open_url"] = open_url    # 정지 생성 시 엔진이 기본 브라우저로 연다.
    return {"pause": p}


# 치환 값에 들어가면 셸이 명령으로 오해석하는 문자 – 명령 템플릿 자체(&& 연결 등)는
# 저작자가 작성한 값은 허용하고, 실행 시점에 흘러드는 동적 값만 거부한다.
_SHELL_META_RE = re.compile(r"[&|<>;`\r\n]")


def command_exec(node, cfg, inputs, ctx):
    """로컬 명령 실행(method: command) — Git 등 로컬 도구용.

    command 템플릿의 {필드명}을 입력값으로 치환해 셸에서 실행하고,
    stdout을 노드의 (유일한) 출력 필드에 기록한다. exit code != 0 → error.
    """
    spec = cfg.get("command_spec")
    legacy_shell_timeout = None
    if isinstance(spec, dict) and "legacy_shell_command" in spec:
        cfg = dict(cfg)
        cfg["command"] = spec.get("legacy_shell_command")
        try:
            legacy_shell_timeout = int(spec.get("timeout_seconds", 120))
        except (TypeError, ValueError):
            return {"error": "command_spec.timeout_seconds는 정수여야 합니다"}
        spec = None
    if isinstance(spec, dict):
        program = str(spec.get("program") or "").strip()
        args = spec.get("args") or []
        timeout = spec.get("timeout_seconds", 120)
        if not program:
            return {"error": "command_spec.program이 없습니다 (저작 단계에서 채워야 합니다)"}
        if not isinstance(args, list) or not all(isinstance(a, str) for a in args):
            return {"error": "command_spec.args는 문자열 배열이어야 합니다"}
        try:
            timeout = int(timeout)
        except (TypeError, ValueError):
            return {"error": "command_spec.timeout_seconds는 정수여야 합니다"}
        try:
            resolved_args = [a.format_map(SafeDict(inputs)) for a in args]
        except (ValueError, KeyError) as e:
            return {"error": f"command_spec 인자 치환 실패: {e}"}
        runner = ctx.get("command_argv")
        if runner is None:
            return {"error": "이 환경에서는 안전한 로컬 명령 실행(command_argv)을 지원하지 않습니다"}
        try:
            rc, out, err = runner(program, resolved_args, timeout)
        except Exception as e:
            if e.__class__.__name__ == "TimeoutExpired":
                return {"error": f"명령이 제한 시간({timeout}초)을 초과했습니다: {program}"}
            return {"error": f"명령 실행 실패: {type(e).__name__}: {e}"}
        if rc != 0:
            detail = (err or out or "").strip()
            return {"error": f"명령 실행 실패(exit {rc}): {program}"
                             + (f"\n{detail[:500]}" if detail else "")}
        outputs = node.get("outputs", [])
        fid = outputs[0]["id"] if outputs else "output"
        return {"output": {fid: (out or "").strip()}}

    # schema 2.0 legacy: 기존 셸 문자열 계약을 그대로 지원한다.
    cmd = (cfg.get("command") or "").strip()
    if not cmd:
        return {"error": "command 방식인데 실행할 명령(command)이 없습니다 (저작 단계에서 채워야 합니다)"}
    for k, v in inputs.items():
        if ("{" + k + "}") in cmd and v is not None and _SHELL_META_RE.search(str(v)):
            return {"error": (f"입력값 '{k}'에 셸 특수문자(&, |, <, >, ;, 개행 등)가 있어 "
                              "명령에 치환할 수 없습니다 – 값을 확인해 다시 실행하거나, "
                              "긴 동적 데이터는 custom_logic(stdin JSON 전달)으로 처리하세요")}
    cmd = cmd.format_map(SafeDict(inputs))
    runner = ctx.get("command")
    if runner is None:
        return {"error": "이 환경에서는 로컬 명령을 실행할 수 없습니다"}
    if legacy_shell_timeout is None:
        rc, out, err = runner(cmd)
    else:
        try:
            import inspect
            try:
                inspect.signature(runner).bind(cmd, legacy_shell_timeout)
                accepts_timeout = True
            except (TypeError, ValueError):
                accepts_timeout = False
            if accepts_timeout:
                rc, out, err = runner(cmd, legacy_shell_timeout)
            else:
                # 기존 embedding의 단일 인자 callback 계약을 보존한다.
                rc, out, err = runner(cmd)
        except Exception as e:
            if e.__class__.__name__ == "TimeoutExpired":
                return {
                    "error": (
                        f"명령이 제한 시간({legacy_shell_timeout}초)을 "
                        f"초과했습니다: {cmd}"
                    )
                }
            return {"error": f"명령 실행 실패: {type(e).__name__}: {e}"}
    if rc != 0:
        detail = (err or out or "").strip()
        shown = "<서버 실행에서 명령 본문 생략>" if ctx.get("redact_logs") else cmd
        if ctx.get("redact_logs"):
            detail = ""
        return {"error": f"명령 실행 실패(exit {rc}): {shown}"
                         + (f"\n{detail[:500]}" if detail else "")}
    outputs = node.get("outputs", [])
    fid = outputs[0]["id"] if outputs else "output"
    return {"output": {fid: (out or "").strip()}}


def mcp_pause(node, cfg, inputs, write=False):
    """method: mcp — AI 에이전트가 연결된 MCP 도구로 수행하도록 정지를 생성한다.

    엔진(stdlib 전용)은 MCP 클라이언트가 아니므로 직접 호출하지 않는다 – 입력값을
    치환한 지시문과 함께 mcp_call로 정지하고, AI 에이전트가 도구 호출 결과를 resume
    payload로 낸다. write이고 출력 필드가 없으면 완료 확인형(slot: confirm_done).
    """
    server = (cfg.get("mcp_server") or "").strip()
    if not server:
        return {"error": "mcp 방식인데 MCP 서버 이름(mcp_server)이 없습니다 (저작 단계에서 채워야 합니다)"}
    instr = (cfg.get("mcp_instruction") or "").strip()
    if not instr:
        return {"error": "mcp 방식인데 지시문(mcp_instruction)이 없습니다 (저작 단계에서 채워야 합니다)"}
    instr = normalize_named_placeholders(instr, inputs)
    unknown = [name for name in named_placeholder_refs(instr) if name not in inputs]
    if unknown:
        return {"error": ("MCP 지시문이 입력에 없는 값을 참조합니다: "
                          + ", ".join("{" + name + "}" for name in unknown))}
    for k, v in inputs.items():
        if ("{" + k + "}") in instr and v is None:
            # null을 치환하면 지시문에 "None" 문자열이 박힌 채 도구가 호출된다 –
            # 조용히 잘못된 요청을 보내느니 정직하게 중단한다.
            return {"error": (f"지시문에 치환할 입력값 '{k}'이(가) 비어 있습니다(null). "
                              "이전 단계가 결과 없이(미진행 등) 넘어온 상태입니다 – 그 단계를 "
                              "다시 진행해 값을 채운 뒤 실행해 주세요.")}
    prompt = f"[MCP 서버] {server}\n\n[지시문]\n" + instr.format_map(SafeDict(inputs))
    fields = fields_from_outputs(node)
    if fields:
        prompt += "\n\n[받아올 값]\n" + "\n".join(f"- {f['name']}" for f in fields)
    if write:
        prompt += ("\n\n주의: 이 지시는 대상 시스템을 변경하는 쓰기 작업입니다. 이 안내를 "
                   "이전에 이미 수행했다면(중단 후 재진입) MCP 도구를 다시 호출하기 전에 "
                   "대상 시스템에 이미 반영됐는지 먼저 확인하세요 – 반영됐으면 호출 없이 "
                   "결과만 제출하세요.")
        if not fields:
            return pause("mcp_call", prompt, slot="confirm_done")
    return pause("mcp_call", prompt, fields)


def resolve_manual_url(value, inputs):
    """수동 작업 URL의 ``{입력명}``을 MCP 지시문과 같은 규칙으로 치환한다.

    URL 형식 검증은 기존 Creator/Validator 계약에 맡긴다. 여기서는 MCP처럼
    알려진 입력 이름의 구형 이중 중괄호를 정규화하고, 없는 값이나 null을
    조용히 문자열로 열지 않도록 중단하는 역할만 한다.
    """
    if not value:
        return value, None
    url = normalize_named_placeholders(value, inputs)
    unknown = [name for name in named_placeholder_refs(url) if name not in inputs]
    if unknown:
        return None, ("수동 작업 URL이 입력에 없는 값을 참조합니다: "
                      + ", ".join("{" + name + "}" for name in unknown))
    for key, item in inputs.items():
        if ("{" + key + "}") in url and item is None:
            return None, (f"수동 작업 URL에 치환할 입력값 '{key}'이(가) "
                          "비어 있습니다(null). 이전 단계의 값을 확인한 뒤 "
                          "다시 실행해 주세요.")
    return re.sub(
        r"\{([^{}]+)\}",
        lambda match: str(inputs[match.group(1)]),
        url,
    ), None


def resolve_request(request, ctx):
    """integration.request 매핑 해석 – 리터럴 또는 '$.'로 시작하는 source.

    반환: (resolved dict, error str|None)
    """
    resolved = {}
    for key, val in (request or {}).items():
        if isinstance(val, str) and val.startswith("$."):
            ok, v = ctx["resolve"](val)
            if not ok:
                return None, f"요청 파라미터 '{key}'의 값({val})을 확인할 수 없습니다"
            if v is None:
                # null을 그대로 쓰면 URL/파라미터에 "None" 문자열이 박힌 채 호출된다 –
                # 조용히 잘못된 요청을 보내느니 정직하게 중단한다.
                return None, (f"요청 파라미터 '{key}'의 값({val})이 비어 있습니다(null). "
                              "이전 단계가 결과 없이(미진행 등) 넘어온 상태입니다 – 그 단계를 "
                              "다시 진행해 값을 채운 뒤 실행해 주세요.")
            resolved[key] = v
        else:
            resolved[key] = val
    return resolved, None


def http_exec(integration, ctx):
    """단일 HTTP 호출 실행 + 응답 필드 추출. 반환: {'output': ...} 또는 {'error': ...}."""
    endpoint = integration.get("endpoint", "")
    method = integration.get("http_method", "GET").upper()

    resolved, err = resolve_request(integration.get("request", {}), ctx)
    if err:
        return {"error": err}

    url = endpoint
    leftover = {}
    for key, val in resolved.items():
        marker = "{" + key + "}"
        if marker in url:
            url = url.replace(marker, str(val))
        else:
            leftover[key] = val

    headers = {}
    auth = integration.get("auth")
    if auth:
        secret = ctx["secret"](auth.get("kind", "env"), auth.get("name", ""))
        if not secret:
            return {"error": (f"인증 정보 '{auth.get('name')}'({auth.get('kind')})가 설정되어 있지 않습니다. "
                              "환경변수 또는 Windows 자격 증명 관리자에 등록 후 다시 실행해 주세요.")}
        headers["Authorization"] = f"Bearer {secret}"

    body = None
    if method == "GET":
        if leftover:
            from urllib.parse import urlencode
            url = url + ("&" if "?" in url else "?") + urlencode(leftover)
    else:
        body = leftover

    # TLS 검증 옵트인 — verify_tls/ca_bundle이 있을 때만 opts로 전달한다.
    # (무조건 넘기면 opts를 모르는 기존 ctx["http"] 대체 구현이 깨진다)
    http_kwargs = {}
    if integration.get("verify_tls") or integration.get("ca_bundle"):
        http_kwargs["opts"] = {"verify_tls": bool(integration.get("verify_tls")),
                               "ca_bundle": integration.get("ca_bundle")}

    attempts = 0
    url_suffix = (
        " (서버 실행에서 요청 URL 생략)"
        if ctx.get("redact_logs") else f": {url}")
    while True:
        attempts += 1
        status, resp = ctx["http"](method, url, headers=headers, body=body, **http_kwargs)
        if status < 400:
            break
        # 일시(transient) 오류 — GET(멱등)만 백오프 후 재시도한다.
        if method == "GET" and status in RETRY_STATUS and attempts < RETRY_MAX:
            time.sleep(RETRY_BACKOFF[min(attempts - 1, len(RETRY_BACKOFF) - 1)])
            continue
        if status in RETRY_STATUS:
            if method == "GET":
                return {"error": (f"HTTP {status} – {attempts}회 시도 후에도 실패했습니다 "
                                  f"(일시 오류일 수 있으니 잠시 후 start를 다시 실행해 주세요)"
                                  f"{url_suffix}")}
            return {"error": (f"HTTP {status} – 서버 오류입니다. 쓰기 요청({method})이라 자동 "
                              "재시도하지 않았습니다 – 대상 시스템에 반영됐는지 확인한 뒤 "
                              f"start를 다시 실행해 주세요{url_suffix}")}
        return {"error": f"HTTP {status} 응답 – 요청 오류(재시도 불필요){url_suffix}"}

    output = {}
    for field, path in (integration.get("response_fields") or {}).items():
        found, value = resolve_response_field_found(path, resp)
        if not found:
            return {"error": f"API 응답 경로를 찾을 수 없습니다: {path}"}
        output[field] = value
    result = {"output": output}
    if attempts > 1:
        result["attempts"] = attempts    # 엔진이 저널(retry)에 기록 – 진행 기록에는 남지 않는다
    return result
