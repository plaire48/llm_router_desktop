# -*- coding: utf-8 -*-
"""저작 질문지 HTML 폼 생성 — 질문지 단계의 기본 채널.

결정 항목이 수십 개면 채팅 타이핑이 부담된다는 실사용 피드백. 서버·외부 라이브러리
금지 제약이라 자기완결 정적 HTML(file://)을 만든다 — 선택지는 클릭, 값은 입력으로
채우고 '확정'하면 답변 JSON을 클립보드에 복사한다.

폼 파일은 질문지의 파생 일회용 산출물이다 — 재생성 시 무경고로 덮어쓴다
(저작 산출물이 아니므로 덮어쓰기 확인 규약 대상이 아니다). 커밋 대상도 아니다.
"""
import html
import json
import os
import re

from . import mcp_status, references, workspace
from .engine import ACTION_TYPE_KO


# Keep the server capability intact while the refresh control is hidden.
_SHOW_DECISION_DRAFT_REFRESH = False

# Keep MCP probing and method setup intact while the status card is hidden.
_SHOW_MCP_STATUS_PANEL = False


def _esc(s):
    return html.escape("" if s is None else str(s), quote=True)


def _mcp_status_panel(value):
    """자격 증명이나 점검 상세를 제외한 고정 상태 문구만 HTML로 만든다."""
    if value is None:
        return ""
    snapshot = mcp_status.normalize(value)
    rows = []
    for service in mcp_status.SERVICES:
        state = snapshot[service]
        rows.append(
            '<div class="mcp-status-item">'
            f'<span class="mcp-status-service">'
            f'{_esc(mcp_status.SERVICE_LABELS[service])}</span>'
            f'<span class="mcp-status-badge is-{_esc(state)}">'
            f'{_esc(mcp_status.STATE_LABELS[state])}</span>'
            '</div>'
        )
    return (
        '<section class="mcp-status-panel" aria-labelledby="mcp-status-title">'
        '<div><strong id="mcp-status-title">MCP 서버 연동 상태</strong>'
        '<p>현재 Code Assistant 실행 환경을 Creator 시작 시 확인한 결과입니다.</p>'
        '</div>'
        '<div class="mcp-status-list">'
        + "".join(rows)
        + '</div></section>'
    )


def form_path(task_json_path, task):
    """재생성 가능한 질문지는 사용자 workflow 폴더가 아닌 .ops/ui에 둔다."""
    return workspace.ui_path(task_json_path, task, "questions").replace("\\", "/")


def _node_test_dependencies(task):
    """각 노드 결과에 영향을 주는 선행 노드 id의 전이 폐쇄.

    화면에서 설정 하나를 바꿨을 때 무관한 앞 노드 테스트까지 지우지 않고,
    해당 노드와 실제 소비자 테스트만 stale 처리하는 표시용 메타데이터다.
    서버는 별도의 dependency fingerprint로 다시 검증한다.
    """
    nodes = [
        node for node in task.get("nodes") or []
        if isinstance(node, dict) and node.get("id")
    ]
    by_id = {node["id"]: node for node in nodes}
    direct = {node_id: set() for node_id in by_id}

    def strings(value):
        if isinstance(value, dict):
            for item in value.values():
                yield from strings(item)
        elif isinstance(value, list):
            for item in value:
                yield from strings(item)
        elif isinstance(value, str) and value.startswith("$.nodes."):
            yield value

    for node in nodes:
        node_id = node["id"]
        for source in strings(node):
            resolved = references.resolve_output_source(task, source, by_id)
            if (
                resolved
                and resolved.get("kind") in ("canonical", "legacy_name")
                and resolved.get("node_id") != node_id
            ):
                direct[node_id].add(resolved["node_id"])
        if node.get("type") == "if":
            source_node = node.get("source_node")
            if source_node in by_id and source_node != node_id:
                direct[node_id].add(source_node)

    def ancestors(node_id, visiting=None):
        visiting = set(visiting or ())
        if node_id in visiting:
            return set()
        visiting.add(node_id)
        result = set(direct.get(node_id) or ())
        for source_node in list(result):
            result.update(ancestors(source_node, visiting))
        return result

    return {
        node_id: sorted(ancestors(node_id))
        for node_id in by_id
    }


# ── qtype별 위젯 ─────────────────────────────────────────────────────────────

_API_HINT = ("주소(endpoint) · HTTP method · 인증 정보의 환경변수/자격증명 이름"
             "(예: BA_TOKEN처럼 이름만 — 토큰·비밀번호 값은 금지) · "
             "요청 파라미터 · 응답에서 뽑을 값")
_CMD_HINT = ("실행할 배치/스크립트 파일 경로 (예: scripts\\조회.bat) — 실행 때 노드 "
             "입력값이 순서대로 인자 %1 %2…로 전달되고, 표준출력이 첫 출력 필드에 저장됩니다")

_FREE_LEGENDS = {
    "topic": "협의 주제는 무엇인가요?",
    "recipient": "수신자는 누구인가요?",
    "message": "보낼 메시지 내용(템플릿)은?",
    "guide": "무엇이 수신되는지 설명해 주세요(재개 때 사용자에게 보여줄 안내)",
    "generation_prompt": "문서를 LLM이 생성해야 하나요? 그렇다면 생성 프롬프트는? (템플릿이면 template로)",
}
_FREE_MULTILINE = ("message", "guide")
_AGENT_DRAFT_QTYPES = ("decision_prompt", "file_write_content")


def _radio(no, value, label, checked=False, btn=False, dialog=None,
           disabled=False):
    chk = " checked" if checked else ""
    disabled_attr = " disabled" if disabled else ""
    cls = "opt btn-choice" if btn else "opt"
    dialog_attr = f' data-open-dialog="{_esc(dialog)}"' if dialog else ""
    return (f'<label class="{cls}"><input type="radio" name="q{no}" '
            f'value="{_esc(value)}"{chk}{disabled_attr}{dialog_attr}> '
            f'{label}</label>')


# 실행 방식 표시 라벨 — 사용자 대면은 한국어(실사용 요청: API/배치파일/수동).
# value(api/command/manual)는 내부 어휘라 답변 JSON·적용 규칙과 그대로 호환된다.
_METHOD_LABELS = {
    "api": ("API", "HTTP 요청으로 자동 조회/실행"),
    "command": ("배치파일", "로컬 명령어·배치 스크립트(.bat 등) 실행"),
    "mcp": ("MCP", "실행 환경의 AI에 연결된 MCP 도구 호출로 조회/실행"),
    "manual": ("수동", "실행 때 사용자가 직접 수행/입력"),
}


def _method_label(value):
    name, cap = _METHOD_LABELS.get(value, (value, ""))
    cap_html = f' <span class="note">— {_esc(cap)}</span>' if cap else ""
    return f"{_esc(name)}{cap_html}"


def _api_detail(q):
    """Postman형 API 설정 UI.

    화면에서는 API key와 value 출처를 행 단위로 편집하고 응답 JSON key만 노출한다.
    제출 시 기존 integration.request/response_fields 계약으로 되돌리므로 task JSON과
    Runner 실행 형식은 바꾸지 않는다.
    """
    no = q["no"]
    current = q.get("api_detail") or {}
    current_auth = current.get("auth") or {}
    current_request = current.get("request") or {}
    current_responses = current.get("response_fields") or {}
    srcs = q.get("input_sources") or []

    def source_options(selected):
        options = []
        known = {str(item.get("source") or "") for item in srcs}
        if selected and selected not in known:
            options.append(
                f'<option value="{_esc(selected)}" selected>'
                f'기존 연결 · {_esc(selected)}</option>')
        for source in srcs:
            value = str(source.get("source") or "")
            label = source.get("label") or source.get("field") or value
            options.append(
                f'<option value="{_esc(value)}"'
                f'{" selected" if value == selected else ""}>'
                f'{_esc(label)}</option>')
        return "".join(options)

    def request_row(key="", value="", template=False):
        raw_value = "" if value is None else str(value)
        is_source = raw_value.startswith("$.")
        if template:
            is_source = bool(srcs)
        mode = "source" if is_source else "literal"
        template_attr = " data-api-request-template hidden" if template else ""
        source_html = source_options(raw_value if is_source else "")
        if not source_html:
            source_html = '<option value="">연결할 입력값이 없습니다</option>'
        return (
            f'<tr data-api-request-row{template_attr}>'
            f'<td><input class="api-key-input" data-api-key value="{_esc(key)}" '
            'placeholder="예: issueKey"></td>'
            '<td><select data-api-value-mode>'
            f'<option value="source"{" selected" if mode == "source" else ""}>'
            '이전 노드/입력값</option>'
            f'<option value="literal"{" selected" if mode == "literal" else ""}>'
            '직접 입력</option></select></td>'
            '<td><div class="api-value-cell">'
            f'<select data-api-source>{source_html}</select>'
            f'<input data-api-literal value="{_esc("" if is_source else raw_value)}" '
            'placeholder="예: PLANNED">'
            '</div></td>'
            '<td><button type="button" class="api-row-delete" '
            'aria-label="요청 값 삭제">삭제</button></td>'
            '</tr>'
        )

    request_rows = [
        request_row(key, value)
        for key, value in current_request.items()
    ]
    if not request_rows:
        request_rows.append(request_row())

    auth_kind = str(current_auth.get("kind") or "")
    parts = [f'<div class="api-builder" data-api-builder data-api-no="{no}">']
    parts.append(
        '<div class="api-builder-head"><div>'
        '<strong>API 요청</strong>'
        '<span class="note"> API 담당자에게 받은 주소와 방식을 입력합니다.</span>'
        '</div></div>')
    parts.append('<div class="api-url-row">')
    parts.append(f'<select name="q{no}_api_method" aria-label="HTTP 방식">'
                 + "".join(
                     f'<option{" selected" if str(current.get("http_method") or "GET").upper() == m else ""}>{m}</option>'
                     for m in ("GET", "POST", "PUT", "PATCH", "DELETE"))
                 + '</select>')
    parts.append(f'<input name="q{no}_api_endpoint" '
                 f'value="{_esc(current.get("endpoint") or "")}" '
                 'placeholder="예: https://api.company.com/v1/issues/{issueKey}" '
                 'aria-label="API 주소"></div>')
    parts.append(
        '<p class="api-url-note note">주소의 <code>{issueKey}</code>에는 아래 요청 '
        '항목에서 같은 이름으로 지정한 값이 들어갑니다.</p>')
    parts.append('<div class="api-auth-row"><strong>인증</strong>')
    parts.append(f'<select name="q{no}_api_auth_kind" aria-label="인증 방식">'
                 f'<option value=""{" selected" if not auth_kind else ""}>인증 없음</option>'
                 f'<option value="env"{" selected" if auth_kind == "env" else ""}>Bearer 토큰 · 환경변수</option>'
                 f'<option value="credman"{" selected" if auth_kind == "credman" else ""}>Bearer 토큰 · 자격증명 관리자</option>'
                 '</select>')
    parts.append(f'<input name="q{no}_api_auth_name" '
                 f'value="{_esc(current_auth.get("name") or "")}" '
                 'placeholder="토큰 등록 이름 (예: BA_TOKEN)" '
                 'aria-label="토큰 등록 이름"></div>')
    parts.append('<p class="api-security-note note">토큰 값은 입력하지 마세요. '
                 '환경변수 또는 자격증명 관리자에 등록한 이름만 입력합니다.</p>')
    parts.append(
        '<div class="api-builder-head api-request-title"><div>'
        '<strong>요청 JSON</strong>'
        '<span class="note"> Key는 직접 입력하고, Value만 이전 노드/입력값에서 '
        '가져오거나 직접 입력합니다.</span></div>'
        '<button type="button" class="api-row-add">+ 항목 추가</button></div>')
    parts.append(
        '<div class="api-table-wrap"><table class="api-request-table">'
        '<thead><tr><th>JSON Key</th><th>Value 방식</th>'
        '<th>Value</th><th></th></tr></thead>'
        '<tbody data-api-request-rows>'
        + "".join(request_rows)
        + request_row(template=True)
        + '</tbody></table></div>')
    parts.append(
        '<div class="api-preview-block"><div class="api-preview-head">'
        '<strong>전송 미리보기</strong>'
        '<span class="note">실행할 때 연결된 입력값이 실제 값으로 바뀝니다.</span>'
        '</div><pre data-api-preview></pre></div>')
    outs = q.get("output_fields") or []
    if outs:
        response_rows = []
        for output in outs:
            path = str(current_responses.get(output["id"]) or "")
            if path == "$.body":
                display = "응답 전체"
            elif path.startswith("$.body."):
                display = path[len("$.body."):]
            else:
                display = path
            response_rows.append(
                '<div class="api-response-row">'
                f'<span>{_esc(output.get("name") or output["id"])}</span>'
                '<span class="api-response-arrow">←</span>'
                f'<input name="q{no}_resp_{_esc(output["id"])}" '
                f'value="{_esc(display)}" '
                f'data-api-response-original="{_esc(path)}" '
                f'data-api-response-display="{_esc(display)}" '
                'placeholder="응답 JSON Key (예: result)"></div>')
        parts.append(
            '<div class="api-response-block"><div>'
            '<strong>응답 연결</strong>'
            '<span class="note"> 각 노드 출력에 넣을 응답 JSON Key를 입력합니다. '
            '중첩된 값은 schedule.plannedCompletionDate처럼 입력합니다.</span>'
            '</div><div class="api-response-rows">'
            + "".join(response_rows)
            + '</div></div>')
    parts.append('</div>')
    return "".join(parts)


def _mcp_detail(q):
    """구조화 mcp 상세 — 서버 이름 + 지시문. 지시문 예시는 노드의 실제 입력 필드명으로
    조립한다(즉흥 예시 금지 — 폼 자족성 유지, 외부 리소스 문자열 금지)."""
    no = q["no"]
    srcs = q.get("input_sources") or []
    example = "장애 대응 보고서를 찾아 핵심 내용을 요약해 줘"
    parts = ['<div class="api-grid">']
    parts.append('<span class="api-lab">MCP 서버 이름 · 필수</span>')
    parts.append(f'<input name="q{no}_mcp_server" '
                 f'value="{_esc(q.get("mcp_server") or "")}" '
                 'placeholder="예: confluence-mcp">')
    parts.append('<span class="api-lab">MCP 작업 지시 · 필수</span>')
    parts.append(f'<textarea name="q{no}_mcp_instruction" '
                 f'placeholder="예: {_esc(example)}">'
                 f'{_esc(q.get("mcp_instruction") or "")}</textarea>')
    parts.append('</div>')
    hint = "실행 때 AI가 이 서버의 MCP 도구를 호출해 지시문을 수행합니다."
    if srcs:
        names = ", ".join("{" + s["field"] + "}" for s in srcs)
        hint += (f" 이전 단계의 값이 필요할 때만 {names}처럼 입력하면 "
                 "실행 때 실제 값으로 바뀝니다.")
    hint += " 배포 시 받는 분 환경에도 같은 이름의 MCP 서버가 연결되어 있어야 합니다."
    parts.append(f'<p class="note">{_esc(hint)}</p>')
    return "".join(parts)


def _w_method(q):
    no = q["no"]
    parts = []
    note = q.get("note")
    recommendation = q.get("recommendation")
    if recommendation:
        parts.append(f'<p class="note">※ {_esc(recommendation)}</p>')
    elif note and "자동화 불가" in note:
        parts.append(f'<p class="note">※ {_esc(note)} → 수동 추정, 확인 필요</p>')
    elif note:
        parts.append(f'<p class="note">※ {_esc(note)}</p>')
    parts.append('<div class="btn-row">')
    for c in q["choices"]:
        parts.append(_radio(no, c, _method_label(c), checked=(q.get("default") == c),
                            btn=True))
    parts.append("</div>")
    parts.append(f'<div class="detail" data-for="api">{_api_detail(q)}</div>')
    parts.append(f'<div class="detail" data-for="command"><input name="q{no}_command" '
                 f'value="{_esc(q.get("command_path") or "")}" '
                 f'placeholder="{_esc(_CMD_HINT)}"></div>')
    parts.append(f'<div class="detail" data-for="mcp">{_mcp_detail(q)}</div>')
    parts.append('<div class="detail" data-for="manual">'
                 '<p class="note">수동 안내문 — 추천 초안입니다. 그대로 두면 \'그대로\'로 제출됩니다.</p>'
                 f'<textarea name="q{no}_manual">{_esc(q.get("suggestion") or "")}</textarea>'
                 '<div class="manual-url-row">'
                 f'<input type="url" name="q{no}_manual_url" data-manual-url '
                 f'value="{_esc(q.get("manual_url") or "")}" '
                 'placeholder="작업 화면 URL(선택, https://부터 입력) — '
                 '입력값은 {필드명}으로 넣을 수 있습니다. 입력하면 실행 때 브라우저가 '
                 '자동으로 열립니다. 배포 시 받는 분이 자기 환경의 URL로 바꿔야 합니다">')
    if q.get("manual_copy_automation_allowed"):
        checked = " checked" if q.get("manual_copy_automation") else ""
        parts.append(
            '<label class="manual-copy-option">'
            f'<input type="checkbox" name="q{no}_manual_copy_automation"'
            f'{checked} data-manual-copy-automation> 복사 자동화</label>')
    parts.append('</div>')
    if q.get("manual_copy_automation_allowed"):
        parts.append('<p class="note">선택하면 로그인된 Edge에서 페이지 내용을 '
                     '자동으로 복사해 조회합니다.</p>')
    parts.append('</div>')
    return "".join(parts)


def _w_guide(q):
    no, sugg = q["no"], q.get("suggestion") or ""
    hint = ("추천 초안 — 그대로 두면 '그대로'로 제출됩니다:" if sugg
            else "안내문을 입력해 주세요:")
    return f'<p class="note">{_esc(hint)}</p><textarea name="q{no}">{_esc(sugg)}</textarea>'


def _w_decision_prompt(q):
    """판단 기준 파일의 초안 선택과 직접 입력 화면을 만든다.

    판단 기준은 ``decisions/<이름>/main_prompt.md``에 저장하고, 긴 초안은 접어서
    표시한다. 판단 폴더는 참고 자료 폴더로도 사용한다.
    """
    no = q["no"]
    decision_dir = q.get("decision_dir_display") or q["decision_dir"]
    return (
        '<div class="decision-path-card">'
        '<div class="decision-path-head"><strong>판단 기준 및 참조자료 폴더</strong></div>'
        f'<code class="decision-path" title="{_esc(decision_dir)}">{_esc(decision_dir)}</code>'
        '<div class="decision-file-row"><span>판단 기준 파일</span><code>main_prompt.md</code></div>'
        '<p class="note"><code>main_prompt.md</code>는 직접 수정할 수 있습니다. 같은 폴더와 '
        '하위 폴더에 넣은 나머지 파일은 실행할 때 AI가 참조자료로 읽습니다.</p></div>'
        f'<details class="sugg"><summary>추천 초안 보기</summary>'
        f'<pre>{_esc(q["suggestion"])}</pre></details>'
        + _radio(no, "그대로",
                 '추천 초안 사용 <span class="note">(초안 그대로 파일 생성 — 실행 전까지 '
                 '파일을 직접 수정해 쓰시면 됩니다)</span>')
        + _radio(no, "판단 기준 입력",
                 '판단 기준 입력 <span class="note">(입력한 내용을 그대로 판단 기준 파일로 저장합니다)</span>',
                 dialog=f'criteria-{no}')
        + f'<div class="detail prompt-detail" data-for="판단 기준 입력">'
          '<p class="note">선택하면 큰 입력창이 자동으로 열립니다. 닫은 뒤에도 아래 버튼으로 '
          '다시 편집할 수 있습니다.</p>'
          '<pre class="prompt-preview criteria-preview">아직 입력한 판단 기준이 없습니다.</pre>'
          f'<button type="button" class="prompt-open" data-dialog="criteria-{no}">'
          '판단 기준 입력</button>'
          f'<dialog class="prompt-dialog" id="criteria-{no}" '
          'data-empty-preview="아직 입력한 판단 기준이 없습니다."><div class="dialog-head">'
          '<strong>판단 기준 입력</strong><button type="button" class="prompt-cancel" '
          'aria-label="닫기">×</button></div>'
          f'<textarea name="q{no}_criteria" data-draft="" placeholder="무엇을 근거로, 어떤 조건이면 '
          '어떤 결론인지 이 판단의 가이드를 적어 주세요"></textarea>'
          '<div class="dialog-actions"><button type="button" class="prompt-reset">내용 비우기</button>'
          '<span class="grow"></span><button type="button" class="prompt-cancel">취소</button>'
          '<button type="button" class="prompt-apply">반영</button></div></dialog></div>')


def _w_labels_fixed(q):
    """판단 라벨과 각 라벨의 분기 대상을 편집하는 화면을 만든다.

    라벨 변경은 후속 If cases와 함께 반영하며, 새 행은 숨겨 둔 템플릿을 복제한다.
    """
    cases = {c.get("label"): c.get("next") for c in q.get("cases") or []}

    def opts(sel):
        o = [f'<option value=""{"" if sel else " selected"}>(종료)</option>']
        for t in q.get("targets") or []:
            s = " selected" if sel == t["id"] else ""
            o.append(f'<option value="{_esc(t["id"])}"{s}>{t.get("no", "?")}. '
                     f'{_esc(t["name"])}</option>')
        return "".join(o)

    rows = []
    for x in q["labels"]:
        nxt = cases.get(x)
        rows.append(f'<div class="lbl-row" data-next="{_esc(nxt or "")}">'
                    f'<input class="lbl-name" data-was="{_esc(x)}" value="{_esc(x)}" '
                    'placeholder="라벨 이름">'
                    '<span class="lbl-arrow">→</span>'
                    f'<select class="lbl-next">{opts(nxt)}</select>'
                    '<button type="button" class="lbl-del">삭제</button></div>')
    template = ('<div class="lbl-row lbl-template" hidden data-next="">'
                '<input class="lbl-name" value="" placeholder="라벨 이름">'
                '<span class="lbl-arrow">→</span>'
                f'<select class="lbl-next">{opts(None)}</select>'
                '<button type="button" class="lbl-del">삭제</button></div>')
    return ('<p class="note">후속 분기와 연동된 라벨입니다 — 판단 결과가 이 라벨 중 '
            '하나로 정해지고, → 대상이 그 다음에 진행할 노드입니다. 이름 변경·추가·'
            '삭제 모두 여기서 하시면 됩니다. 바꾸지 않으면 \'그대로\'(라벨 유지)로 '
            '제출됩니다. 이름이 비거나 겹치면 제출되지 않으며, 라벨은 1개 이상이어야 '
            '합니다(분기 자체를 없애려면 구성 편집기에서).</p>'
            + "".join(rows) + template
            + '<button type="button" class="lbl-add">＋ 라벨 추가</button>')


def _w_file_read(q):
    no = q["no"]
    path_input = q.get("path_input_suggestion") or "파일 경로"
    current_mode = q.get("current_mode")
    return (
        '<p class="file-read-guide note"><strong>선택 기준</strong> — 경로가 고정이면 직접 '
        '지정하고, 실행마다 달라지면 경로를 입력값으로 받으세요. 폴더만 알거나 파일에 '
        '접근할 수 없는 경우에는 아래 대안을 선택합니다.</p>'
        + _radio(no, "path",
                 '<span class="file-read-copy"><strong>정확한 경로를 압니다</strong>'
                 '<span class="note">지정한 텍스트 파일을 프로그램이 바로 읽습니다.</span></span>',
                 checked=current_mode == "path")
        + f'<div class="detail file-read-detail" data-for="path">'
          f'<label class="field-label" for="q{no}_path">파일 경로</label>'
          f'<input id="q{no}_path" name="q{no}_path" '
          f'value="{_esc(q.get("path") or "")}" '
          'placeholder="예: ./documents/plan.md"></div>'
        + _radio(no, "runtime_path",
                 '<span class="file-read-copy"><strong>실행할 때 파일 경로를 받습니다</strong>'
                 '<span class="note">경로를 실행 시 입력값으로 받습니다. 사용자 입력이나 '
                 '선행 노드 출력으로 연결할 수 있습니다.</span></span>',
                 checked=current_mode == "runtime_path")
        + f'<input type="hidden" name="q{no}_path_input" '
          f'value="{_esc(path_input)}">'
        + f'<div class="detail file-read-detail" data-for="runtime_path">'
          '<span class="field-label">경로 입력 이름</span>'
          f'<code>{_esc(path_input)}</code>'
          '<p class="note">이 이름의 입력값에서 파일 경로를 받아 프로그램이 읽습니다.</p></div>'
        + _radio(no, "folder_hint",
                 '<span class="file-read-copy"><strong>경로를 모릅니다 — 폴더에서 찾기</strong>'
                 '<span class="note">Code Assistant가 폴더와 힌트로 파일을 찾아 경로를 '
                 '제출할 때까지 실행이 대기합니다.</span></span>',
                 checked=current_mode == "folder_hint")
        + f'<div class="detail file-read-detail" data-for="folder_hint">'
          f'<label class="field-label" for="q{no}_directory">탐색할 폴더</label>'
          f'<input id="q{no}_directory" name="q{no}_directory" '
          f'value="{_esc(q.get("directory") or "")}" '
          'placeholder="예: ./documents">'
          f'<label class="field-label" for="q{no}_file_hint">파일 힌트</label>'
          f'<input id="q{no}_file_hint" name="q{no}_file_hint" '
          f'value="{_esc(q.get("file_hint") or "")}" '
          'placeholder="예: 가장 최근 요구사항정의서"></div>'
        + _radio(no, "manual",
                 '<span class="file-read-copy"><strong>내용을 직접 붙여넣습니다</strong>'
                 '<span class="note">파일 경로로 접근하기 어려울 때 실행 중 사용자에게 '
                 '내용을 입력받습니다.</span></span>',
                 checked=current_mode == "manual")
        + f'<div class="detail file-read-detail" data-for="manual">'
          f'<label class="field-label" for="q{no}_manual">실행 중 사용자에게 보여줄 안내</label>'
          '<p class="note">추천 초안입니다. 그대로 두면 추천 문구가 적용됩니다.</p>'
          f'<textarea id="q{no}_manual" name="q{no}_manual">'
          f'{_esc(q.get("suggestion") or "")}</textarea></div>')


def _w_file_write(q):
    no = q["no"]
    return (f'<input name="q{no}" value="{_esc(q.get("default_value") or "")}" '
            'placeholder="저장할 파일 경로">'
            f'<label class="opt"><input type="checkbox" name="q{no}_manual"> '
            '경로를 모름 — manual(내용 복붙 방식)</label>')


def _source_options(q, current=None, removed=False, previous_task_name=None):
    options = []
    values = {o.get("value") for o in q.get("source_options") or []}
    if current and current not in values:
        label = ("선택 필요 — 삭제된 선행 출력" if removed else
                 f"이전 task [{previous_task_name}]의 출력 — 자동 전달"
                 if previous_task_name else "현재 연결 유지")
        options.append({"value": current, "label": label})
    options.extend(q.get("source_options") or [])
    return "".join(
        f'<option value="{_esc(o.get("value") or "")}"'
        f'{" selected" if current == o.get("value") else ""}>{_esc(o.get("label") or "")}</option>'
        for o in options)


def _w_io(q):
    """입출력을 행 단위로 직접 편집한다. 새 입력은 외부 입력이 기본이며 필요하면
    선행 노드 출력이나 건 ID를 선택한다. 출력 id는 이름을 바꿔도 유지한다."""
    input_rows = []
    for d in q["inputs"]:
        broken = ' data-broken="removed"' if d.get("kind") == "removed" else ""
        previous_attrs = ""
        if (d.get("kind") == "previous_task"
                and all(d.get(key) for key in ("from_task", "from_node", "from_field"))):
            previous_label = (
                d.get("previous_node_name")
                or f'{d["from_task"]} / {d["from_node"]} / {d["from_field"]}'
            )
            previous_attrs = (
                f' data-previous-task="{_esc(d["from_task"])}"'
                f' data-previous-node="{_esc(d["from_node"])}"'
                f' data-previous-field="{_esc(d["from_field"])}"'
                f' data-previous-label="{_esc(previous_label)}"'
            )
        warning = ('<span class="io-warning">선행 노드가 삭제되어 출처를 다시 선택해야 합니다.</span>'
                   if d.get("kind") == "removed" else '<span class="io-warning" hidden></span>')
        input_rows.append(
            f'<div class="io-row input-row" data-original-field="{_esc(d["field"])}"'
            f'{broken}{previous_attrs}>'
            f'<input class="io-name" value="{_esc(d["field"])}" placeholder="입력 필드 이름">'
            f'<select class="io-source">{_source_options(q, d.get("source"), d.get("kind") == "removed", d.get("previous_node_name") if d.get("kind") == "previous_task" else None)}</select>'
            f'{warning}<button type="button" class="io-del" aria-label="입력 삭제">−</button></div>')
    input_template = (
        '<div class="io-row input-row io-template" hidden data-original-field="">'
        '<input class="io-name" value="" placeholder="입력 필드 이름">'
        f'<select class="io-source">{_source_options(q, "__external__")}</select>'
        '<span class="io-warning" hidden></span>'
        '<button type="button" class="io-del" aria-label="입력 삭제">−</button></div>')
    output_rows = "".join(
        f'<div class="io-row output-row" data-output-id="{_esc(o.get("id") or "")}">'
        f'<input class="io-name" value="{_esc(o.get("name") or o.get("id") or "")}" '
        'placeholder="출력 필드 이름"><button type="button" class="io-del" '
        'aria-label="출력 삭제">−</button></div>' for o in q["outputs"])
    output_template = (
        '<div class="io-row output-row io-template" hidden data-output-id="">'
        '<input class="io-name" value="" placeholder="출력 필드 이름">'
        '<button type="button" class="io-del" aria-label="출력 삭제">−</button></div>')
    return (
        '<div class="io-editor"><p class="io-head">입력 필드와 출처</p>'
        f'<div class="io-inputs">{"".join(input_rows)}{input_template}</div>'
        '<button type="button" class="io-add" data-kind="input">＋ 입력 필드 추가</button>'
        '<p class="io-head">출력 필드</p>'
        f'<div class="io-outputs">{output_rows}{output_template}</div>'
        '<button type="button" class="io-add" data-kind="output">＋ 출력 필드 추가</button></div>')


def _w_file_write_content(q):
    no = q["no"]
    draft = q.get("suggestion") or ""
    fields = ", ".join(q.get("input_fields") or []) or "(없음)"
    return (
        '<p class="note">작성 방식을 고르고 내용을 확인하세요. LLM 생성 프롬프트에는 task에 '
        '이미 있는 정보만으로 만든 초안이 들어 있습니다.</p>'
        + _radio(no, "generate", "LLM으로 문서 생성", checked=True)
        + f'<div class="detail prompt-detail" data-for="generate">'
          f'<p class="note">사용 입력: {_esc(fields)}</p>'
          f'<pre class="prompt-preview">{_esc(draft)}</pre>'
          f'<button type="button" class="prompt-open" data-dialog="prompt-{no}">프롬프트 편집</button>'
          f'<dialog class="prompt-dialog" id="prompt-{no}"><div class="dialog-head">'
          '<strong>생성 프롬프트 편집</strong><button type="button" class="prompt-cancel" '
          'aria-label="닫기">×</button></div>'
          f'<textarea name="q{no}_generation_prompt" data-draft="{_esc(draft)}">{_esc(draft)}</textarea>'
          '<div class="dialog-actions"><button type="button" class="prompt-reset">초안으로 되돌리기</button>'
          '<span class="grow"></span><button type="button" class="prompt-cancel">취소</button>'
          '<button type="button" class="prompt-apply">반영</button></div></dialog></div>'
        + _radio(no, "template", "템플릿 본문 사용")
        + f'<div class="detail" data-for="template"><p class="note">입력값은 '
          f'{_esc(fields)}처럼 제공됩니다. 본문에서 &#123;필드명&#125;으로 참조할 수 있습니다.</p>'
          f'<textarea class="template-body" name="q{no}_template" '
          'placeholder="템플릿 본문을 입력하세요"></textarea></div>')


def _w_agent_draft(q, draft_generation_enabled=False):
    """서버 연결 저작의 의미 항목은 기본 초안을 즉시 보여 주고 Agent가 보완한다.

    느린 Agent 때문에 상세 질문 화면 전체를 막지 않는다. 아직 Agent 결과가 없으면
    결정적 suggestion을 기본 초안으로 사용한다. 사용자가 AI 수정을 요청한 노드는
    처리 중 직접 편집을 잠그고, 결과가 도착하면 해당 입력란을 자동 교체한다.
    """
    no = q["no"]
    draft = q.get("agent_draft") or ""
    pending = bool(q.get("agent_draft_pending"))
    edit_disabled = " disabled" if pending else ""
    preview = draft or "초안을 직접 입력해 주세요."
    current_mode = q.get("current_mode")
    use_checked = bool(draft) and current_mode != "template"
    decision_draft = q.get("qtype") == "decision_prompt"
    edit_dialog = f"agent-draft-{no}" if decision_draft else None
    ready = bool(q.get(
        "agent_draft_ready",
        bool(draft) and "agent_draft_pending" not in q,
    ))
    source = (
        "AI가 수정한 초안" if ready else
        "기본 초안"
    )
    status = (
        "AI가 초안을 수정하고 있습니다…" if pending else
        "AI가 수정한 초안입니다." if ready else
        "기본 생성 초안입니다. 그대로 사용하거나 직접 수정할 수 있습니다."
    )
    ai_button = ""
    if draft_generation_enabled and not ready:
        disabled = " disabled" if pending else ""
        label = "AI 수정 중…" if pending else "AI로 초안 수정"
        ai_button = (
            f'<button type="button" class="agent-draft-generate" '
            f'data-job-id="{_esc(q.get("agent_draft_id") or "")}" '
            f'data-node-id="{_esc(q.get("node_id") or "")}" '
            f'data-revision="{_esc(q.get("agent_draft_revision") or "")}"'
            f'{disabled}>{label}</button>'
        )
    choices = (
        f'<div class="agent-draft-card" '
        f'data-job-id="{_esc(q.get("agent_draft_id") or "")}">'
        '<div class="agent-draft-head">'
        f'<strong class="agent-draft-source">{_esc(source)}</strong>'
        f'{ai_button}</div>'
        f'<pre class="agent-draft-preview">{_esc(preview)}</pre>'
        f'<span class="note agent-draft-status">{_esc(status)}</span></div>'
        '<div class="btn-row">'
        + _radio(no, "agent_draft_use", "이대로 사용",
                 checked=use_checked, btn=True)
        + _radio(no, "agent_draft_edit", "수정",
                 checked=not use_checked, btn=True,
                 dialog=edit_dialog, disabled=pending)
    )
    if q.get("qtype") == "file_write_content":
        choices += _radio(
            no, "agent_template", "템플릿 사용",
            checked=current_mode == "template", btn=True)
    choices += '</div>'
    if decision_draft:
        choices += (
            f'<div class="detail agent-draft-edit prompt-detail" '
            f'data-for="agent_draft_edit">'
            f'<pre class="prompt-preview" hidden>{_esc(preview)}</pre>'
            f'<button type="button" class="prompt-open" '
            f'data-dialog="{edit_dialog}"{edit_disabled}>초안 수정</button>'
            f'<dialog class="prompt-dialog" id="{edit_dialog}" '
            f'data-empty-preview="AI 초안을 입력해 주세요"><div class="dialog-head">'
            '<strong>AI 판단 초안 수정</strong>'
            '<button type="button" class="prompt-cancel" '
            'aria-label="닫기">×</button></div>'
            f'<textarea name="q{no}_agent_draft" data-draft="{_esc(draft)}"'
            f'{edit_disabled} '
            f'placeholder="초안 내용을 입력해 주세요">{_esc(draft)}</textarea>'
            '<div class="dialog-actions">'
            f'<button type="button" class="prompt-reset"{edit_disabled}>'
            '초안으로 되돌리기</button>'
            '<span class="grow"></span>'
            '<button type="button" class="prompt-cancel">취소</button>'
            f'<button type="button" class="prompt-apply"{edit_disabled}>'
            '반영</button>'
            '</div></dialog></div>'
        )
    else:
        choices += (
            f'<div class="detail agent-draft-edit" data-for="agent_draft_edit">'
            f'<textarea name="q{no}_agent_draft" data-draft="{_esc(draft)}"'
            f'{edit_disabled} '
            f'placeholder="초안 내용을 입력해 주세요">{_esc(draft)}</textarea></div>'
        )
    if q.get("qtype") == "file_write_content":
        choices += (
            f'<div class="detail" data-for="agent_template"><p class="note">본문에서 '
            f'&#123;필드명&#125; 형식으로 값을 참조할 수 있습니다.</p>'
            f'<textarea class="template-body" name="q{no}_template" '
            f'placeholder="템플릿 본문을 입력하세요">{_esc(q.get("current_template") or "")}</textarea></div>'
        )
    return choices


def _w_labels_locked(q):
    labels = "".join(
        f'<span class="type-badge">{_esc(value)}</span>'
        for value in (q.get("labels") or [])
    )
    return (
        '<p class="note">분기 라벨은 앞의 설계 확정 단계에서 정해졌습니다. AI 초안이 '
        '이 라벨을 기준으로 작성되므로 여기서는 바꾸지 않습니다.</p>'
        f'<div class="locked-labels">{labels or "(없음)"}</div>'
    )


def _w_custom_logic(q):
    """고급 옵션 영역에 커스텀 로직 사용 여부와 설명 입력란을 만든다.

    기본값은 사용 안 함이다. 커스텀 로직을 선택하면 설명 입력란을 열고, 설명이
    입력된 경우에만 답변으로 인정한다.
    """
    no = q["no"]
    current = q.get("current_custom_logic")
    shown_dir = q.get("logic_dir_display") or q["logic_dir"]
    if current:
        choices = (
            _radio(no, "커스텀 로직 유지", "유지", checked=True, btn=True)
            + _radio(no, "커스텀 로직", "새 설명으로 초안 교체", btn=True)
            + _radio(no, "사용 안 함", "사용 안 함", btn=True)
        )
        state = (
            f'<p class="note"><strong>현재 사용 중</strong> — '
            f'<code>{_esc(current)}</code><br>유지는 Task와 파일을 다시 쓰지 않습니다. '
            '교체는 이 화면을 연 뒤 파일이 바뀌지 않았을 때만 적용됩니다.</p>'
        )
    else:
        choices = (
            _radio(no, "사용 안 함", "사용 안 함", checked=True, btn=True)
            + _radio(no, "커스텀 로직", "커스텀 로직 구현하기", btn=True)
        )
        state = ""
    return (
        '<p class="note">위 방식(JSON)으로 표현하기 어려운 로직(반복 처리·계산·형식 변환 '
        '등)이 필요할 때 쓰는 예외 수단입니다. 선택하면 아래 폴더에 사양서(LOGIC.md)와 '
        '실행 코드(run.py) 초안을 만들어 연결하고, 이 노드의 위 질문들은 무시됩니다.</p>'
        + state
        + '<div class="btn-row">' + choices + "</div>"
        + '<div class="detail" data-for="커스텀 로직">'
          f'<p class="note">생성 위치: {_esc(shown_dir)} — 실행 때 엔진이 run.py를 '
          '자동 수행합니다. AI가 작성한 코드 초안은 검증 단계에서 검토 안내가 뜹니다.</p>'
          f'<textarea name="q{no}_logic" placeholder="원하는 로직을 설명해 주세요 — '
          '무엇을 입력받아 어떤 규칙으로 처리해 무엇을 출력해야 하는지. '
          'AI가 이 설명을 근거로 코드 초안을 작성합니다"></textarea></div>')


def _widget(q, connected=False, agent_draft_mode=False,
            draft_generation_enabled=False):
    qt = q["qtype"]
    no = q["no"]
    if connected and agent_draft_mode and qt in _AGENT_DRAFT_QTYPES:
        return _w_agent_draft(
            q, draft_generation_enabled=draft_generation_enabled)
    if connected and qt == "labels_fixed":
        return _w_labels_locked(q)
    if qt == "method_choice":
        return _w_method(q)
    if qt == "manual_guide":
        return _w_guide(q)
    if qt == "decision_prompt":
        return _w_decision_prompt(q)
    if qt == "labels_fixed":
        return _w_labels_fixed(q)
    if qt == "labels_input":
        return ('<p class="note">이 판단의 결과에 따라 뒤 흐름이 갈라집니다 — 각 갈래의 '
                '이름을 한 줄에 하나씩 적어 주세요. 실행 때 AI가 이 중 하나를 골라 '
                '분기하며, 후속 분기 조건과 자동 연동됩니다.</p>'
                f'<textarea name="q{no}" placeholder="예)&#10;승인&#10;반려"></textarea>')
    if qt == "notify_channel":
        return "".join(
            _radio(no, c, _esc(c), checked=q.get("default") == c)
            for c in q["choices"])
    if qt == "file_read_spec":
        return _w_file_read(q)
    if qt == "file_write_path":
        return _w_file_write(q)
    if qt == "file_write_content":
        return _w_file_write_content(q)
    if qt == "custom_logic_opt":
        return _w_custom_logic(q)
    if qt == "io_confirm":
        return _w_io(q)
    if q.get("target") in _FREE_MULTILINE:
        return (
            f'<textarea name="q{no}">'
            f'{_esc(q.get("default_value") or "")}</textarea>')
    return (
        f'<input name="q{no}" '
        f'value="{_esc(q.get("default_value") or "")}">')


def _legend(q):
    qt = q["qtype"]
    system_label = q.get("system_label") or q.get("system")
    sysp = f"({system_label}) " if system_label else ""
    return {
        "method_choice": f"{sysp}실행 방식은?",
        "manual_guide": f"{sysp}수동 안내문",
        "decision_prompt": "판단 기준 프롬프트",
        "labels_fixed": "판단 결과 라벨 (후속 분기와 연동)",
        "labels_input": "판단 결과 라벨 (후속 분기와 연동)",
        "notify_channel": "알림 채널은?",
        "file_read_spec": "읽을 파일을 어떻게 지정할까요?",
        "file_write_path": "실제 파일 경로는?",
        "file_write_content": "문서 작성 방식과 생성 프롬프트",
        "custom_logic_opt": "커스텀 로직으로 구현",
        "io_confirm": "입력/출력 확인 — 이대로 쓸까요, 고칠까요?",
    }.get(qt, _FREE_LEGENDS.get(q.get("target"), ""))


# 디자인 방향: 설문지가 아니라 Jira 설정/AWS Console 계열의 엔터프라이즈
# 설정 패널 — 정보 밀도는 높게, 위계는 타이포·괘선으로. 외부 리소스 0 제약이라
# 시스템 폰트로 승부한다 — 경로·명령어·결과 JSON은 고정폭.
# 시그니처는 좌측 워크플로우 레일(질문지가 곧 워크플로우라는 구조를 인코딩).
#
# CSS_TOKENS는 저작 계열 정적 HTML(질문지 폼, 향후 구조 편집기)이 공유하는
# 디자인 토큰이다 — 새 화면은 이 토큰 위에 짓는다.
CSS_TOKENS = """
:root{--paper:#f4f6f8;--card:#fff;--ink:#1b2430;--muted:#5f6a7a;--line:#d9dee6;
  --accent:#1428a0;--tint:#edf0fb;--attn:#b45309;
  --fs-base:13.5px;--fs-sm:.85rem;--fs-xs:.78rem;--lh:1.45;--radius:4px;
  --sp-1:4px;--sp-2:8px;--sp-3:12px;--sp-4:16px;
  --mono:Consolas,'D2Coding','Courier New',monospace}
"""

_CSS = CSS_TOKENS + """
*{box-sizing:border-box}
body{font-family:'Malgun Gothic','맑은 고딕','Apple SD Gothic Neo','Segoe UI',sans-serif;
  margin:0;background:var(--paper);color:var(--ink);
  line-height:var(--lh);font-size:var(--fs-base)}
html{scroll-behavior:smooth}
#topbar{position:sticky;top:0;z-index:10;background:var(--card);
  border-bottom:1px solid var(--line);padding:8px 20px;display:flex;
  align-items:center;gap:12px;flex-wrap:wrap}
#topbar .eyebrow{font-size:var(--fs-xs);letter-spacing:.18em;color:var(--accent);
  font-weight:bold}
#topbar h1{font-size:1.15em;margin:0;letter-spacing:-.02em;display:inline-block}
#topbar .meta{font-size:var(--fs-xs);color:var(--muted);margin-left:10px;
  font-variant-numeric:tabular-nums}
#topbar .grow{flex:1}
#progress{font-variant-numeric:tabular-nums;color:var(--muted);white-space:nowrap;
  border:1px solid var(--line);border-radius:var(--radius);padding:3px 12px;
  background:var(--paper);font-size:var(--fs-sm)}
#confirm{font-size:1em;font-weight:bold;padding:7px 24px;cursor:pointer;
  background:var(--accent);color:#fff;border:0;border-radius:var(--radius)}
#confirm:hover{background:#0f1f7d}
#confirm:disabled{cursor:not-allowed;opacity:.55}
.ai-draft-submit-lock{font-size:var(--fs-xs);color:#4f46e5;white-space:nowrap}
#detail-guide-open{font:inherit;font-weight:bold;padding:6px 14px;cursor:pointer;
  color:var(--accent);background:var(--card);border:1px solid var(--accent);
  border-radius:var(--radius)}
#detail-guide-open:hover{background:var(--tint)}
.layout{max-width:1160px;margin:0 auto;padding:var(--sp-4) var(--sp-4) 80px}
nav#rail{display:none}
@media(min-width:960px){
  .layout{display:grid;grid-template-columns:220px minmax(0,1fr);gap:24px;align-items:start}
  nav#rail{display:block;position:sticky;top:64px}}
#rail a{display:flex;gap:9px;align-items:flex-start;text-decoration:none;
  color:var(--muted);padding:5px 4px;position:relative;font-size:var(--fs-sm)}
#rail .dot{width:9px;height:9px;border-radius:50%;border:2px solid var(--line);
  background:var(--card);margin-top:4px;flex:none;position:relative;z-index:1}
#rail a.done .dot{background:var(--accent);border-color:var(--accent)}
#rail a.done{color:var(--ink)}
#rail a:not(:last-child)::before{content:'';position:absolute;left:9px;top:19px;
  bottom:-8px;width:2px;background:var(--line)}
#rail .badge{display:block;font-size:var(--fs-xs);color:var(--accent);letter-spacing:.06em}
#rail .rail-name{display:block;line-height:1.3}
#rail .rail-count{display:inline-block;margin-left:6px;font-size:var(--fs-xs);
  color:var(--muted);font-variant-numeric:tabular-nums}
#rail a.done .rail-count{color:var(--accent)}
.intro{color:var(--muted);max-width:820px;margin-top:0;font-size:var(--fs-sm)}
.mcp-status-panel{display:flex;align-items:center;justify-content:space-between;gap:18px;
  margin:0 0 18px;padding:14px 16px;background:var(--card);border:1px solid var(--line);
  border-radius:10px;box-shadow:var(--shadow)}
.mcp-status-panel strong{font-size:var(--fs-sm)}
.mcp-status-panel p{margin:4px 0 0;color:var(--muted);font-size:var(--fs-xs)}
.mcp-status-list{display:flex;flex-wrap:wrap;gap:8px}
.mcp-status-item{display:flex;align-items:center;gap:8px;padding:7px 9px;
  border:1px solid var(--line);border-radius:8px;background:var(--soft)}
.mcp-status-service{font-weight:700;font-size:var(--fs-sm)}
.mcp-status-badge{padding:3px 7px;border-radius:999px;font-size:var(--fs-xs);
  font-weight:700;background:#eef1f6;color:var(--muted)}
.mcp-status-badge.is-connected{background:#e8f7ef;color:#18734a}
.mcp-status-badge.is-missing_token{background:#fff3d8;color:#8a5b00}
.mcp-status-badge.is-unlinked{background:#f2f3f6;color:#626b7a}
@media(max-width:720px){.mcp-status-panel{align-items:flex-start;flex-direction:column}}
section.node{background:var(--card);border:1px solid var(--line);
  border-radius:var(--radius);padding:10px 16px 12px;margin:0 0 var(--sp-3);
  scroll-margin-top:64px}
section.node h2{font-size:1em;margin:0 -16px;padding:0 16px 8px;
  border-bottom:1px solid var(--line);letter-spacing:-.01em;
  display:flex;align-items:center;gap:8px}
.node-no-questions{margin:10px 0 0;color:var(--muted);font-size:var(--fs-sm)}
.node-no{flex:none;width:20px;height:20px;border-radius:50%;background:var(--accent);
  color:#fff;font-size:.72em;display:inline-flex;align-items:center;justify-content:center}
.type-badge{flex:none;font-size:var(--fs-xs);font-weight:bold;color:var(--accent);
  background:var(--tint);border:1px solid var(--accent);border-radius:var(--radius);
  padding:1px 7px;letter-spacing:.06em}
.node-name{min-width:0}
.node-test-button{font:inherit;font-size:var(--fs-xs);font-weight:bold;margin-left:auto;
  white-space:nowrap;color:var(--accent);background:var(--card);
  border:1px solid var(--accent);border-radius:var(--radius);padding:4px 10px;
  cursor:pointer}
.node-test-button:hover{background:var(--tint)}
.node-test-button:disabled{cursor:wait;opacity:.62}
.node-test-panel{margin:10px 0 2px;padding:9px 11px;border:1px solid var(--line);
  border-radius:var(--radius);background:var(--paper)}
.node-test-panel[hidden]{display:none}
.node-test-status{margin:0;font-weight:bold}
.node-test-detail{margin-top:5px;color:var(--muted);font-size:var(--fs-sm)}
.node-test-detail p{margin:4px 0}
.node-test-detail ul{margin:4px 0 0;padding-left:20px}
.node-test-runtime-form{display:grid;gap:8px;margin-top:8px}
.node-test-runtime-field{display:grid;gap:3px;color:var(--ink)}
.node-test-runtime-field textarea{min-height:48px;margin-top:0}
.node-test-runtime-field select{width:100%;font:inherit;padding:6px 9px;
  border:1px solid var(--line);border-radius:var(--radius);background:var(--card)}
.node-test-runtime-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:2px}
.node-test-runtime-actions button{font:inherit;font-size:var(--fs-xs);font-weight:bold;
  color:var(--accent);background:var(--card);border:1px solid var(--accent);
  border-radius:var(--radius);padding:5px 10px;cursor:pointer}
.node-test-runtime-actions button:hover{background:var(--tint)}
.node-test-runtime-actions button:disabled{cursor:wait;opacity:.62}
.node-test-note{padding:6px 8px;border-radius:var(--radius);background:rgba(255,255,255,.7)}
.node-test-copy-status{margin:0;color:var(--muted);font-size:var(--fs-sm)}
.node-test-panel[data-status="completed"]{border-color:#15803d;background:#f0fdf4}
.node-test-panel[data-status="preview_only"]{border-color:#2563eb;background:#eff6ff}
.node-test-panel[data-status="needs_input"],
.node-test-panel[data-status="waiting_user"],
.node-test-panel[data-status="stale"]{border-color:var(--attn);background:#fffbeb}
.node-test-panel[data-status="failed"],
.node-test-panel[data-status="invalid"],
.node-test-panel[data-status="conflict"]{border-color:#b91c1c;background:#fef2f2}
fieldset.q{border:0;border-top:1px solid var(--line);margin:var(--sp-3) 0 0;
  padding:var(--sp-2) 0 0}
fieldset.q:first-of-type{border-top:0}
.q-grid{display:block}
@media(min-width:960px){
  .q-grid{display:grid;grid-template-columns:210px minmax(0,1fr);column-gap:20px}
  .q-label{padding-top:3px}}
.q-label{font-weight:bold;margin-bottom:var(--sp-1)}
fieldset.q.missing{box-shadow:inset 3px 0 0 var(--attn);padding-left:10px}
fieldset.q.missing .q-label{color:var(--attn)}
label.opt{display:flex;gap:7px;align-items:flex-start;margin:3px 0;cursor:pointer;
  border:1px solid var(--line);border-radius:var(--radius);padding:4px 10px;
  background:var(--card);transition:border-color .15s,background .15s}
label.opt:hover{border-color:var(--accent)}
label.opt:has(input:checked){border-color:var(--accent);background:var(--tint);
  box-shadow:inset 3px 0 0 var(--accent)}
label.opt input{margin-top:3px;accent-color:var(--accent)}
textarea{width:100%;min-height:56px;margin-top:var(--sp-1);font:inherit;
  background:var(--card);border:1px solid var(--line);border-radius:var(--radius);
  padding:6px 9px}
input:not([type=radio]):not([type=checkbox]){width:100%;margin-top:var(--sp-1);
  font:inherit;padding:5px 9px;border:1px solid var(--line);
  border-radius:var(--radius);background:var(--card)}
textarea:focus-visible,input:focus-visible,button:focus-visible,#rail a:focus-visible{
  outline:2px solid var(--accent);outline-offset:1px}
input[name$="_command"],input[name$="_path"],input[name$="_directory"],
#result-json{font-family:var(--mono);font-size:.92em}
.detail{margin:var(--sp-2) 0 var(--sp-2) 24px;display:none}
.manual-url-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;
  align-items:center}
.manual-copy-option{display:flex;gap:5px;align-items:center;white-space:nowrap;
  margin-top:var(--sp-1);font-size:var(--fs-sm);cursor:pointer}
.manual-copy-option input{accent-color:var(--accent)}
.manual-copy-option:has(input:disabled){color:var(--muted);cursor:not-allowed}
@media(max-width:640px){.manual-url-row{grid-template-columns:1fr}}
.file-read-guide{margin:0 0 var(--sp-2)}
.file-read-copy{display:block;min-width:0}
.file-read-copy strong,.file-read-copy .note{display:block}
.file-read-copy .note{margin-top:2px;font-weight:normal}
.file-read-detail .field-label{display:block;margin:7px 0 2px;font-size:var(--fs-xs);
  color:var(--muted);font-weight:bold}
.file-read-detail .field-label:first-child{margin-top:0}
.file-read-detail code{display:inline-block;padding:4px 8px;background:var(--paper);
  border:1px solid var(--line);border-radius:var(--radius);font-family:var(--mono)}
.file-read-detail .note{margin:5px 0 0}
.io-editor{border:1px solid var(--line);border-radius:var(--radius);padding:8px 10px}
.io-row{display:grid;grid-template-columns:minmax(160px,.8fr) minmax(260px,1.4fr) auto auto;
  gap:7px;align-items:center;margin:5px 0}
.io-template[hidden]{display:none}
.io-outputs{display:flex;flex-wrap:wrap;gap:7px}
.output-row{display:flex;align-items:center;flex:1 1 180px;max-width:320px;
  margin:0;border:1px solid var(--line);border-radius:var(--radius);
  background:var(--paper)}
.output-row .io-name{border:0;background:transparent;margin:0}
.output-row .io-del{border:0;border-left:1px solid var(--line);border-radius:0}
.io-row select{width:100%;font:inherit;padding:5px 8px;border:1px solid var(--line);
  border-radius:var(--radius);background:var(--card)}
.io-del,.io-add,.prompt-open,.prompt-reset,.prompt-cancel,.prompt-apply{font:inherit;
  border:1px solid var(--line);background:var(--card);border-radius:var(--radius);cursor:pointer;padding:5px 10px}
.io-add,.prompt-open,.prompt-apply{border-color:var(--accent);color:var(--accent)}
.io-warning,.src.removed{color:var(--attn);font-size:var(--fs-xs);font-weight:bold}
.io-warning{grid-column:1/-1;white-space:normal;line-height:1.45}
.input-row.broken{border-left:3px solid #c2410c;background:#fff7ed;padding:5px 8px;
  border-radius:var(--radius)}
.input-row.broken .io-source{border-color:#c2410c;color:#9a3412}
.previous-source-open{font:inherit;font-size:var(--fs-xs);white-space:nowrap;
  border:1px solid #a855f7;color:#6b21a8;background:#faf5ff;border-radius:var(--radius);
  cursor:pointer;padding:5px 9px}
.previous-source-open[hidden]{display:none}
.previous-task-picker{width:min(1040px,94vw);max-height:min(760px,90vh);border:0;
  border-radius:8px;padding:0;box-shadow:0 18px 60px #0005;color:var(--ink)}
.previous-task-picker::backdrop{background:#1118}
.previous-task-picker[open]{display:flex;flex-direction:column}
.previous-picker-head,.previous-picker-actions{display:flex;align-items:center;gap:10px;
  padding:11px 14px;border-bottom:1px solid var(--line)}
.previous-picker-head .previous-picker-close{margin-left:auto}
.previous-picker-actions{border:0;border-top:1px solid var(--line)}
.previous-picker-actions .grow{flex:1}
.previous-picker-grid{display:grid;grid-template-columns:.9fr 1fr 1.25fr;
  min-height:300px;max-height:60vh;overflow:hidden}
.previous-picker-pane{min-width:0;overflow:auto;padding:10px;border-right:1px solid var(--line)}
.previous-picker-pane:last-child{border-right:0}
.previous-picker-pane h3{font-size:var(--fs-xs);color:var(--muted);letter-spacing:.06em;
  margin:0 0 7px}
.previous-picker-list{display:flex;flex-direction:column;gap:4px}
.previous-picker-option{font:inherit;text-align:left;width:100%;cursor:pointer;
  border:1px solid transparent;border-radius:var(--radius);background:transparent;
  color:var(--ink);padding:7px 8px}
.previous-picker-option:hover,.previous-picker-option.active,
.previous-picker-option[aria-selected=true]{border-color:var(--accent);background:var(--tint)}
.previous-picker-option strong,.previous-picker-option span{display:block}
.previous-picker-option span{font-size:var(--fs-xs);color:var(--muted);margin-top:2px}
.previous-picker-empty{color:var(--muted);font-size:var(--fs-sm);padding:8px}
.previous-picker-help{font-size:var(--fs-xs);color:var(--muted)}
.previous-picker-close,.previous-picker-cancel{font:inherit;border:1px solid var(--line);
  background:var(--card);border-radius:var(--radius);cursor:pointer;padding:5px 10px}
.prompt-preview{max-height:108px;overflow:hidden;white-space:pre-wrap;background:var(--paper);
  border:1px solid var(--line);padding:8px;font-family:var(--mono);font-size:.86em}
.prompt-dialog{width:min(900px,92vw);height:min(720px,82vh);border:0;border-radius:8px;
  padding:0;box-shadow:0 18px 60px #0005}
.prompt-dialog::backdrop{background:#1118}
.prompt-dialog[open]{display:flex;flex-direction:column}
.detail-guide-dialog{width:min(700px,92vw);max-height:min(720px,88vh);border:0;
  border-radius:8px;padding:0;box-shadow:0 18px 60px #0005;color:var(--ink)}
.detail-guide-dialog::backdrop{background:#1118}
.detail-guide-dialog[open]{display:flex;flex-direction:column}
.detail-guide-body{padding:14px 18px;overflow:auto}
.detail-guide-body>p{margin:0 0 12px;color:var(--muted)}
.detail-guide-list{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:0}
.detail-guide-list>div{border:1px solid var(--line);border-radius:var(--radius);
  padding:10px 12px;background:var(--paper)}
.detail-guide-list dt{font-weight:bold;color:var(--accent)}
.detail-guide-list dd{margin:3px 0 0;color:var(--muted);font-size:var(--fs-sm)}
.detail-guide-callout{margin-top:12px;border-left:3px solid var(--attn);
  background:#fff7ed;padding:9px 11px;font-size:var(--fs-sm)}
.detail-guide-close{font:inherit;border:1px solid var(--line);background:var(--card);
  border-radius:var(--radius);cursor:pointer;padding:5px 10px}
.dialog-head .detail-guide-close{margin-left:auto;font-size:1.3em;border:0}
.dialog-head,.dialog-actions{display:flex;align-items:center;gap:8px;padding:10px 14px;
  border-bottom:1px solid var(--line)}
.dialog-actions{border-bottom:0;border-top:1px solid var(--line)}
.dialog-head .prompt-cancel{margin-left:auto;font-size:1.3em;border:0}
.prompt-dialog textarea{flex:1;min-height:0;margin:12px 14px;width:auto;font-family:var(--mono);resize:none}
.dialog-actions .grow{flex:1}
@media(max-width:700px){
  .io-row{grid-template-columns:1fr auto}.io-row .io-source{grid-column:1/-1}
  .detail-guide-list{grid-template-columns:1fr}
  .previous-source-open{grid-column:1/-1}
  .previous-picker-grid{grid-template-columns:1fr;max-height:68vh;overflow:auto}
  .previous-picker-pane{overflow:visible;border-right:0;border-bottom:1px solid var(--line)}
  .previous-picker-pane:last-child{border-bottom:0}}
.note{color:var(--muted);font-size:var(--fs-sm)}
.decision-path-card{border:1px solid var(--line);border-radius:var(--radius);background:var(--paper);
  padding:10px 12px;margin-bottom:var(--sp-2)}
.decision-path-head,.decision-file-row{display:flex;align-items:center;gap:8px}
.decision-path{display:block;margin:8px 0;padding:7px 9px;border:1px solid var(--line);
  border-radius:var(--radius);background:var(--card);font-family:var(--mono);font-size:.88em;
  white-space:nowrap;overflow-x:auto}
.decision-file-row{font-size:var(--fs-sm)}
.decision-file-row>span{color:var(--muted);font-weight:bold}
.decision-path-card .note{margin:8px 0 0}
@media(max-width:700px){
  .decision-path-head,.decision-file-row{align-items:stretch;flex-direction:column}}
.sugg{background:var(--tint);border-left:3px solid var(--accent);padding:6px 10px;
  border-radius:0 var(--radius) var(--radius) 0}
details.sugg summary{cursor:pointer;font-weight:bold}
details.sugg pre{white-space:pre-wrap;font-family:var(--mono);font-size:.9em;
  margin:6px 0 0}
.agent-draft-card{background:var(--tint);border-left:3px solid var(--accent);
  padding:9px 12px;border-radius:0 var(--radius) var(--radius) 0}
.agent-draft-head{display:flex;align-items:center;justify-content:space-between;
  gap:12px;margin-bottom:6px}
.agent-draft-card strong{display:block;color:var(--accent)}
.agent-draft-generate{font:inherit;font-size:var(--fs-sm);font-weight:bold;
  white-space:nowrap;padding:5px 11px;color:var(--accent);background:var(--card);
  border:1px solid var(--accent);border-radius:var(--radius);cursor:pointer}
.agent-draft-generate:hover{background:#fff}
.agent-draft-generate:disabled{cursor:wait;opacity:.65}
.agent-draft-locked label.opt:has(input[value="agent_draft_edit"]){
  cursor:not-allowed;opacity:.55}
.agent-draft-card pre{white-space:pre-wrap;overflow-wrap:anywhere;font-family:var(--mono);
  font-size:.9em;margin:0;max-height:280px;overflow:auto}
.agent-draft-card.user-edited{background:#f4efff;border-left-color:#6b21a8}
.agent-draft-card.user-edited strong{color:#6b21a8}
.agent-draft-edit textarea{min-height:240px;font-family:var(--mono);resize:vertical}
.ai-draft-panel{display:flex;align-items:center;gap:14px;flex-wrap:wrap;
  margin:0 0 18px;padding:14px 16px;border:1px solid #c7d2fe;border-radius:12px;
  background:#eef2ff}
.ai-draft-panel p{margin:0;flex:1;min-width:260px;color:#3730a3}
.ai-draft-panel>button{font:inherit;font-weight:bold;white-space:nowrap;padding:7px 13px;
  color:var(--accent);background:var(--card);border:1px solid var(--accent);
  border-radius:var(--radius);cursor:pointer}
.ai-draft-panel>button:hover{background:var(--tint)}
.ai-draft-panel>button:disabled{cursor:wait;opacity:.65}
.ai-draft-panel .ai-draft-progress{width:100%;font-size:13px;color:#4f46e5}
.dialog-head .ai-draft-cancel{margin-left:auto;font-size:1.3em;border:0}
.ai-draft-cancel,.ai-draft-confirm{font:inherit;border:1px solid var(--line);
  background:var(--card);border-radius:var(--radius);cursor:pointer;padding:5px 10px}
.ai-draft-confirm{border-color:var(--accent);color:var(--accent);font-weight:bold}
.locked-labels{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}
details.advanced{border-top:1px dashed var(--line);margin-top:var(--sp-3);
  padding-top:var(--sp-2)}
details.advanced summary{cursor:pointer;color:var(--muted);font-size:var(--fs-sm);
  padding:3px 0;user-select:none}
details.advanced summary:hover{color:var(--accent)}
details.advanced fieldset.q:first-of-type{border-top:0;padding-top:var(--sp-1)}
.btn-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:var(--sp-1)}
label.opt.btn-choice{display:inline-flex;flex:none;font-weight:bold;
  border-width:2px;padding:6px 14px;align-items:center}
label.opt.btn-choice .note{font-weight:normal}
table.io{border-collapse:collapse;width:100%;margin:var(--sp-2) 0;font-size:.95em}
table.io th{text-align:left;font-size:var(--fs-xs);color:var(--muted);font-weight:bold;
  border-bottom:2px solid var(--line);padding:3px 10px 3px 0}
table.io td{border-bottom:1px solid var(--line);padding:4px 10px 4px 0;
  vertical-align:top}
table.io td:first-child{font-weight:bold;white-space:nowrap}
.io-head{font-size:var(--fs-xs);color:var(--muted);font-weight:bold;
  margin:var(--sp-2) 0 var(--sp-1)}
.chips{margin:0}
.chip{display:inline-block;background:var(--tint);border:1px solid var(--line);
  border-radius:var(--radius);padding:1px 10px;margin:2px 5px 2px 0;font-size:.92em}
.src{display:inline-block;font-size:var(--fs-xs);border-radius:var(--radius);
  padding:1px 7px;border:1px solid var(--line);color:var(--muted);
  background:var(--paper)}
.src.prev{color:var(--accent);border-color:var(--accent);background:var(--tint)}
.src.prev-task{color:#6b21a8;border-color:#a855f7;background:#faf5ff}
.src.ext{color:var(--attn);border-color:var(--attn);background:#fdf6ec}
.src.keep{border-style:dashed}
.api-grid{display:grid;grid-template-columns:130px minmax(0,1fr);gap:6px 10px;
  align-items:start;margin-top:var(--sp-1)}
.api-grid>*{min-width:0}
.api-grid .api-lab{font-size:var(--fs-xs);color:var(--muted);font-weight:bold;
  padding-top:8px}
.api-grid input,.api-grid textarea{margin-top:0}
.api-grid select,.lbl-row select{font:inherit;padding:5px 9px;
  border:1px solid var(--line);border-radius:var(--radius);background:var(--card)}
.api-grid>input,.api-grid>select{width:100%}
.api-sub{display:flex;gap:6px}
.api-sub select{flex:none}
.api-sub input{flex:1;min-width:0;margin-top:0}
.api-security-note{margin:0;padding:0 0 4px}
.api-row{display:flex;gap:8px;align-items:center;margin:2px 0}
.api-row .api-key{flex:none;min-width:130px;font-size:var(--fs-sm);font-weight:bold}
.api-row input{flex:1;min-width:0;margin-top:0}
.api-builder{display:grid;gap:var(--sp-3);margin-top:var(--sp-2)}
.api-builder input,.api-builder select,.api-builder button{font:inherit}
.api-builder input,.api-builder select{border:1px solid var(--line);
  border-radius:var(--radius);background:var(--card);padding:6px 9px;min-width:0}
.api-builder input:focus,.api-builder select:focus{border-color:var(--accent);
  outline:2px solid var(--tint);outline-offset:0}
.api-builder-head{display:flex;align-items:center;justify-content:space-between;
  gap:10px;flex-wrap:wrap}
.api-builder-head .note{margin-left:4px}
.api-url-row{display:grid;grid-template-columns:100px minmax(0,1fr);gap:7px}
.api-url-row input{font-family:var(--mono)}
.api-auth-row{display:grid;grid-template-columns:100px minmax(190px,.8fr)
  minmax(180px,1fr);gap:7px;align-items:center;padding:var(--sp-2) 0;
  border-bottom:1px solid var(--line)}
.api-security-note,.api-url-note{margin:calc(-1 * var(--sp-2)) 0 0 107px}
.api-request-title{margin-top:var(--sp-1)}
.api-row-add,.api-row-delete{color:var(--accent);background:var(--card);
  border:1px solid var(--accent);border-radius:var(--radius);padding:4px 9px;
  cursor:pointer;white-space:nowrap}
.api-row-add:hover,.api-row-delete:hover{background:var(--tint)}
.api-table-wrap{overflow-x:auto}
.api-request-table{width:100%;border-collapse:collapse;font-size:var(--fs-sm)}
.api-request-table th,.api-request-table td{padding:6px 5px;text-align:left;
  vertical-align:middle;border-bottom:1px solid var(--line)}
.api-request-table th{color:var(--muted);font-size:var(--fs-xs)}
.api-request-table th:last-child,.api-request-table td:last-child{width:50px}
.api-request-table input,.api-request-table select{width:100%;margin:0}
.api-key-input{font-family:var(--mono)}
.api-value-cell{display:grid;gap:4px}
.api-hidden{display:none!important}
.api-preview-block{display:grid;gap:5px}
.api-preview-head{display:flex;align-items:center;justify-content:space-between;
  gap:8px;flex-wrap:wrap}
.api-preview-block pre{margin:0;padding:9px 11px;min-height:80px;
  border:1px solid var(--line);border-radius:var(--radius);background:var(--paper);
  color:var(--ink);font:var(--fs-sm)/1.5 var(--mono);white-space:pre-wrap;
  overflow-wrap:anywhere}
.api-response-block{display:grid;gap:8px;padding-top:var(--sp-3);
  border-top:1px solid var(--line)}
.api-response-rows{display:grid;gap:6px}
.api-response-row{display:grid;grid-template-columns:minmax(120px,.65fr) auto
  minmax(180px,1fr);gap:8px;align-items:center}
.api-response-row>span:first-child{font-weight:bold}
.api-response-arrow{color:var(--muted)}
.api-response-row input{width:100%;font-family:var(--mono);margin:0}
@media(max-width:700px){
  .api-grid{grid-template-columns:1fr;gap:3px}
  .api-grid .api-lab{padding-top:10px}
  .api-row{align-items:stretch;flex-direction:column;gap:3px}
  .api-row .api-key{min-width:0}
  .api-sub{align-items:stretch;flex-direction:column}
  .api-url-row,.api-auth-row{grid-template-columns:1fr}
  .api-security-note,.api-url-note{margin-left:0}
  .api-response-row{grid-template-columns:1fr;gap:3px}
  .api-response-arrow{transform:rotate(90deg);width:max-content}
}
input[name*="_api_endpoint"],input[name*="_resp_"]{font-family:var(--mono);
  font-size:.92em}
.lbl-row{display:flex;gap:6px;align-items:center;margin:3px 0}
.lbl-row input.lbl-name{flex:1;margin-top:0}
.lbl-row select.lbl-next{flex:1;min-width:0}
.lbl-arrow{color:var(--muted);flex:none}
.lbl-row button,.lbl-add{font:inherit;font-size:var(--fs-sm);padding:3px 10px;
  cursor:pointer;background:var(--card);border:1px solid var(--line);
  border-radius:var(--radius);flex:none}
.lbl-row button:hover,.lbl-add:hover{border-color:var(--accent);color:var(--accent)}
.lbl-add{margin-top:var(--sp-1)}
.custom-logic-disabled{opacity:.5;background:var(--paper)}
.custom-logic-disabled .q-body{pointer-events:none}
ul{margin:var(--sp-1) 0;padding-left:20px}
footer{margin:var(--sp-4) 0 60px}
#result{background:var(--card);border:1px solid var(--line);
  border-radius:var(--radius);padding:12px 16px;margin-top:var(--sp-3)}
#result textarea{min-height:150px}
#validation-result{margin-top:10px;padding:10px 12px;border-radius:var(--radius);
  border:1px solid var(--line);background:var(--paper);font-size:var(--fs-sm)}
#validation-result[hidden]{display:none}
#validation-result.validation-error{border-color:var(--attn);color:var(--attn)}
#validation-result h3{margin:0 0 6px;font-size:1em}
#validation-result ul{margin:0;padding-left:20px;color:var(--ink)}
#validation-result li{margin:4px 0}
#return-dashboard{margin-top:12px}
#warn{font-weight:bold;margin-top:0}
#copy,#save{padding:5px 16px;border:1px solid var(--accent);color:var(--accent);
  background:var(--card);border-radius:var(--radius);cursor:pointer}
#copy-msg{color:var(--muted);font-size:var(--fs-sm);margin-left:8px}
@media(prefers-reduced-motion:reduce){
  html{scroll-behavior:auto}
  label.opt{transition:none}}
"""

_JS = """
var QUESTIONS = JSON.parse(document.getElementById('questions').textContent);
var PREVIOUS_TASK_CATALOG =
  JSON.parse(document.getElementById('previous-task-catalog').textContent);
var PREVIOUS_TASK_SOURCE = '__previous_task__';
var form = document.getElementById('f');
var detailGuide = document.getElementById('detail-guide');
var detailGuideOpen = document.getElementById('detail-guide-open');

function closeDetailGuide() {
  if (!detailGuide) return;
  if (detailGuide.close) detailGuide.close(); else detailGuide.removeAttribute('open');
}
if (detailGuide && detailGuideOpen) {
  detailGuideOpen.addEventListener('click', function () {
    if (detailGuide.showModal) detailGuide.showModal();
    else detailGuide.setAttribute('open', '');
    var closeButton = detailGuide.querySelector('.detail-guide-close');
    if (closeButton) closeButton.focus();
  });
  detailGuide.querySelectorAll('.detail-guide-close').forEach(function (button) {
    button.addEventListener('click', closeDetailGuide);
  });
  detailGuide.addEventListener('cancel', function (event) {
    event.preventDefault();
    closeDetailGuide();
  });
}

document.querySelectorAll('fieldset.q').forEach(function (fs) {
  var radios = fs.querySelectorAll('input[type=radio]');
  var details = fs.querySelectorAll('.detail');
  if (radios.length) {
    var sync = function () {
      var v = null;
      radios.forEach(function (r) { if (r.checked) v = r.value; });
      details.forEach(function (d) { d.style.display = (d.dataset.for === v) ? 'block' : 'none'; });
    };
    radios.forEach(function (r) { r.addEventListener('change', sync); });
    sync();
  }
});

document.querySelectorAll('[data-manual-url]').forEach(function (urlInput) {
  var row = urlInput.closest('.manual-url-row');
  var checkbox = row ? row.querySelector('[data-manual-copy-automation]') : null;
  if (!checkbox) return;
  var sync = function () {
    checkbox.disabled = !urlInput.value.trim();
    if (checkbox.disabled) checkbox.checked = false;
  };
  urlInput.addEventListener('input', sync);
  sync();
});

function syncCustomLogicFields(customFieldset) {
  var selected = customFieldset.querySelector('input[type=radio]:checked');
  var exclusive = !!selected && (
    selected.value === '커스텀 로직' || selected.value === '커스텀 로직 유지');
  var section = customFieldset.closest('section.node');
  if (!section) return;
  section.querySelectorAll('fieldset.q').forEach(function (fieldset) {
    if (fieldset === customFieldset || fieldset.classList.contains('labels_fixed')) return;
    fieldset.classList.toggle('custom-logic-disabled', exclusive);
    fieldset.querySelectorAll('input,select,textarea,button').forEach(function (control) {
      control.disabled = exclusive;
    });
  });
}
document.querySelectorAll('fieldset.custom_logic_opt').forEach(function (fieldset) {
  fieldset.querySelectorAll('input[type=radio]').forEach(function (radio) {
    radio.addEventListener('change', function () { syncCustomLogicFields(fieldset); });
  });
  syncCustomLogicFields(fieldset);
});

function apiRequestRows(builder) {
  return Array.prototype.slice.call(
    builder.querySelectorAll('[data-api-request-row]:not([data-api-request-template])'));
}

function syncApiRequestRow(row) {
  var mode = row.querySelector('[data-api-value-mode]').value;
  var source = row.querySelector('[data-api-source]');
  var literal = row.querySelector('[data-api-literal]');
  source.classList.toggle('api-hidden', mode !== 'source');
  literal.classList.toggle('api-hidden', mode === 'source');
}

function apiRequestPreviewValue(row) {
  var mode = row.querySelector('[data-api-value-mode]').value;
  if (mode === 'source') {
    var source = row.querySelector('[data-api-source]');
    var option = source.options[source.selectedIndex];
    return '{{' + (option ? option.textContent : '연결된 입력값') + '}}';
  }
  return row.querySelector('[data-api-literal]').value;
}

function updateApiPreview(builder) {
  var no = builder.dataset.apiNo;
  var method = el('q' + no + '_api_method').value;
  var endpoint = txt('q' + no + '_api_endpoint') || '(API 주소)';
  var authKind = el('q' + no + '_api_auth_kind').value;
  var remaining = {};
  apiRequestRows(builder).forEach(function (row) {
    var key = row.querySelector('[data-api-key]').value.trim();
    if (!key) return;
    var value = apiRequestPreviewValue(row);
    var marker = '{' + key + '}';
    if (endpoint.indexOf(marker) !== -1) {
      endpoint = endpoint.split(marker).join(value);
    } else {
      remaining[key] = value;
    }
  });
  var lines = [method + ' ' + endpoint];
  if (authKind) lines.push('Authorization: Bearer ••••••••');
  if (method === 'GET') {
    var query = Object.keys(remaining).map(function (key) {
      return key + '=' + remaining[key];
    }).join('&');
    if (query) lines[0] += (endpoint.indexOf('?') === -1 ? '?' : '&') + query;
  } else if (Object.keys(remaining).length) {
    lines.push('Content-Type: application/json');
    lines.push('');
    lines.push(JSON.stringify(remaining, null, 2));
  }
  builder.querySelector('[data-api-preview]').textContent = lines.join('\\n');
}

function syncApiAuth(builder) {
  var no = builder.dataset.apiNo;
  var kind = el('q' + no + '_api_auth_kind').value;
  el('q' + no + '_api_auth_name').classList.toggle('api-hidden', !kind);
}

document.querySelectorAll('[data-api-builder]').forEach(function (builder) {
  apiRequestRows(builder).forEach(syncApiRequestRow);
  syncApiAuth(builder);
  updateApiPreview(builder);
  builder.addEventListener('change', function (event) {
    var row = event.target.closest('[data-api-request-row]');
    if (row && event.target.matches('[data-api-value-mode]')) {
      syncApiRequestRow(row);
    }
    if (event.target.name
        && event.target.name.indexOf('_api_auth_kind') !== -1) {
      syncApiAuth(builder);
    }
    updateApiPreview(builder);
  });
  builder.addEventListener('input', function () {
    updateApiPreview(builder);
  });
  builder.addEventListener('click', function (event) {
    if (event.target.closest('.api-row-add')) {
      var template = builder.querySelector('[data-api-request-template]');
      var row = template.cloneNode(true);
      row.removeAttribute('data-api-request-template');
      row.hidden = false;
      row.querySelector('[data-api-key]').value = '';
      row.querySelector('[data-api-literal]').value = '';
      var source = row.querySelector('[data-api-source]');
      var hasSource = !!(source && source.value);
      row.querySelector('[data-api-value-mode]').value =
        hasSource ? 'source' : 'literal';
      template.parentNode.insertBefore(row, template);
      syncApiRequestRow(row);
      row.querySelector('[data-api-key]').focus();
      updateApiPreview(builder);
      return;
    }
    var remove = event.target.closest('.api-row-delete');
    if (remove) {
      remove.closest('[data-api-request-row]').remove();
      updateApiPreview(builder);
    }
  });
});

document.querySelectorAll('fieldset.io_confirm').forEach(function (fs) {
  fs.addEventListener('click', function (ev) {
    var target = ev.target;
    if (target.classList.contains('io-add')) {
      var kind = target.dataset.kind;
      var host = fs.querySelector(kind === 'input' ? '.io-inputs' : '.io-outputs');
      var template = host.querySelector('.io-template');
      var row = template.cloneNode(true);
      row.classList.remove('io-template'); row.hidden = false;
      if (kind === 'output') row.dataset.outputId = nextOutputId(fs);
      host.insertBefore(row, template);
      if (kind === 'input') ensurePreviousTaskControl(row);
      row.querySelector('.io-name').focus();
      syncIOReferences();
      refreshProgress();
      markNodeTestsStale();
    } else if (target.classList.contains('io-del')) {
      target.closest('.io-row').remove();
      syncIOReferences();
      refreshProgress();
      markNodeTestsStale();
    } else if (target.classList.contains('previous-source-open')) {
      var sourceRow = target.closest('.input-row');
      openPreviousTaskPicker(sourceRow, sourceRow.querySelector('.io-source').value);
    }
  });
});

function nextOutputId(fs) {
  var n = Number(fs.dataset.nextOutputSeq || 1);
  fs.dataset.nextOutputSeq = String(n + 1);
  return 'output_' + n;
}

function sourceNodeId(value) {
  var m = /^\\$\\.nodes\\.([^.]+)\\.output\\.(.+)$/.exec(value || '');
  return m ? { node: m[1], output: m[2] } : null;
}

function normalizePreviousTaskCatalog(catalog) {
  var rawTasks = Array.isArray(catalog) ? catalog : ((catalog && catalog.tasks) || []);
  return rawTasks.map(function (task) {
    var taskId = task.task_id || task.id || '';
    var taskName = task.task_name || task.name || taskId;
    var rawNodes = Array.isArray(task.nodes) ? task.nodes : [];
    return {
      task_id: taskId,
      task_name: taskName,
      nodes: rawNodes.map(function (node) {
        var nodeId = node.node_id || node.id || '';
        var nodeName = node.node_name || node.name || nodeId;
        var rawOutputs = Array.isArray(node.outputs) ? node.outputs : [];
        return {
          node_id: nodeId,
          node_name: nodeName,
          outputs: rawOutputs.map(function (output) {
            return {
              task_id: output.task_id || taskId,
              task_name: output.task_name || taskName,
              node_id: output.node_id || nodeId,
              node_name: output.node_name || nodeName,
              field_id: output.field_id || output.id || '',
              field_name: output.field_name || output.name ||
                          output.field_id || output.id || '',
              description: output.description || ''
            };
          }).filter(function (output) {
            return output.task_id && output.node_id && output.field_id;
          })
        };
      }).filter(function (node) { return node.node_id; })
    };
  }).filter(function (task) { return task.task_id; });
}

var PREVIOUS_TASKS = normalizePreviousTaskCatalog(PREVIOUS_TASK_CATALOG);
var previousPicker = document.getElementById('previous-task-picker');
var previousPickerState = {
  row: null, oldSource: null, oldRef: null,
  taskIndex: 0, nodeIndex: 0, outputIndex: 0
};

function previousSourceRef(row) {
  var task = row.dataset.previousTask || '';
  var node = row.dataset.previousNode || '';
  var field = row.dataset.previousField || '';
  return (task && node && field)
    ? { from_task: task, from_node: node, from_field: field }
    : null;
}

function clearPreviousSourceRef(row) {
  delete row.dataset.previousTask;
  delete row.dataset.previousNode;
  delete row.dataset.previousField;
  delete row.dataset.previousLabel;
}

function setPreviousSourceRef(row, output) {
  row.dataset.previousTask = output.task_id;
  row.dataset.previousNode = output.node_id;
  row.dataset.previousField = output.field_id;
  row.dataset.previousLabel =
    output.task_name + ' / ' + output.node_name + ' / ' + output.field_name;
}

function previousTaskOption(select) {
  return Array.from(select.options).find(function (option) {
    return option.value === PREVIOUS_TASK_SOURCE;
  }) || null;
}

function ensurePreviousTaskControl(row) {
  if (!PREVIOUS_TASKS.length) return;
  var select = row.querySelector('.io-source');
  if (!select) return;
  var option = previousTaskOption(select);
  if (!option) {
    option = document.createElement('option');
    option.value = PREVIOUS_TASK_SOURCE;
    option.textContent = '이전 task에서 받아오기…';
    select.appendChild(option);
  }
  var button = row.querySelector('.previous-source-open');
  if (!button) {
    button = document.createElement('button');
    button.type = 'button';
    button.className = 'previous-source-open';
    button.textContent = '이전 task 다시 선택';
    button.hidden = true;
    select.insertAdjacentElement('afterend', button);
  }
  if (!select.dataset.previousValue) select.dataset.previousValue = select.value;
  syncPreviousTaskControl(row);
}

function syncPreviousTaskControl(row) {
  var select = row.querySelector('.io-source');
  if (!select) return;
  var option = previousTaskOption(select);
  var button = row.querySelector('.previous-source-open');
  var selected = select.value === PREVIOUS_TASK_SOURCE;
  var ref = previousSourceRef(row);
  if (option) {
    option.textContent = selected && ref && row.dataset.previousLabel
      ? '이전 task · ' + row.dataset.previousLabel
      : '이전 task에서 받아오기…';
  }
  if (button) {
    button.hidden = !ref;
    button.setAttribute('aria-label', ref && row.dataset.previousLabel
      ? row.dataset.previousLabel + ' 다시 선택'
      : '이전 task 출력 다시 선택');
  }
}

function copyPreviousSourceRef(ref) {
  return ref ? {
    from_task: ref.from_task,
    from_node: ref.from_node,
    from_field: ref.from_field
  } : null;
}

function restorePreviousSourceRef(row, ref) {
  clearPreviousSourceRef(row);
  if (!ref) return;
  row.dataset.previousTask = ref.from_task;
  row.dataset.previousNode = ref.from_node;
  row.dataset.previousField = ref.from_field;
  var output = findPreviousOutput(ref);
  if (output) {
    row.dataset.previousLabel =
      output.task_name + ' / ' + output.node_name + ' / ' + output.field_name;
  }
}

function findPreviousOutput(ref) {
  var found = null;
  PREVIOUS_TASKS.some(function (task) {
    if (task.task_id !== ref.from_task) return false;
    return task.nodes.some(function (node) {
      if (node.node_id !== ref.from_node) return false;
      return node.outputs.some(function (output) {
        if (output.field_id !== ref.from_field) return false;
        found = output;
        return true;
      });
    });
  });
  return found;
}

function currentPickerTask() {
  return PREVIOUS_TASKS[previousPickerState.taskIndex] || null;
}

function currentPickerNode() {
  var task = currentPickerTask();
  return task && task.nodes[previousPickerState.nodeIndex] || null;
}

function currentPickerOutput() {
  var node = currentPickerNode();
  return node && node.outputs[previousPickerState.outputIndex] || null;
}

function pickerButton(primary, secondary, index, level) {
  var button = document.createElement('button');
  button.type = 'button';
  button.className = 'previous-picker-option';
  button.dataset.index = String(index);
  button.dataset.level = level;
  button.setAttribute('role', 'option');
  button.setAttribute('aria-selected', 'false');
  button.tabIndex = -1;
  var strong = document.createElement('strong');
  strong.textContent = primary;
  button.appendChild(strong);
  if (secondary) {
    var span = document.createElement('span');
    span.textContent = secondary;
    button.appendChild(span);
  }
  return button;
}

function markPickerSelection(level, index) {
  previousPicker.querySelectorAll(
    '.previous-picker-option[data-level="' + level + '"]'
  ).forEach(function (button) {
    var active = Number(button.dataset.index) === index;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
    button.tabIndex = active ? 0 : -1;
  });
}

function renderPickerTasks() {
  var list = document.getElementById('previous-picker-tasks');
  list.textContent = '';
  if (!PREVIOUS_TASKS.length) {
    list.innerHTML = '<p class="previous-picker-empty">선택할 수 있는 이전 task가 없습니다.</p>';
    return;
  }
  PREVIOUS_TASKS.forEach(function (task, index) {
    var button = pickerButton(task.task_name, task.task_id, index, 'task');
    button.addEventListener('click', function () {
      activatePickerTask(index, false);
      focusPickerLevel('node');
    });
    list.appendChild(button);
  });
  markPickerSelection('task', previousPickerState.taskIndex);
}

function renderPickerNodes() {
  var list = document.getElementById('previous-picker-nodes');
  list.textContent = '';
  var task = currentPickerTask();
  if (!task || !task.nodes.length) {
    list.innerHTML = '<p class="previous-picker-empty">이 task에는 선택할 노드가 없습니다.</p>';
    renderPickerOutputs();
    return;
  }
  task.nodes.forEach(function (node, index) {
    var button = pickerButton(node.node_name, node.node_id, index, 'node');
    button.addEventListener('click', function () {
      activatePickerNode(index, false);
      focusPickerLevel('output');
    });
    list.appendChild(button);
  });
  markPickerSelection('node', previousPickerState.nodeIndex);
  renderPickerOutputs();
}

function renderPickerOutputs() {
  var list = document.getElementById('previous-picker-outputs');
  list.textContent = '';
  var node = currentPickerNode();
  if (!node || !node.outputs.length) {
    list.innerHTML = '<p class="previous-picker-empty">이 노드에는 선택할 출력값이 없습니다.</p>';
    updatePickerPath();
    return;
  }
  node.outputs.forEach(function (output, index) {
    var button = pickerButton(
      output.field_name,
      output.description || output.field_id,
      index,
      'output'
    );
    button.addEventListener('click', function () { choosePreviousOutput(output); });
    list.appendChild(button);
  });
  markPickerSelection('output', previousPickerState.outputIndex);
  updatePickerPath();
}

function activatePickerTask(index, focusNext) {
  if (!PREVIOUS_TASKS[index]) return;
  var changed = previousPickerState.taskIndex !== index;
  previousPickerState.taskIndex = index;
  if (changed) {
    previousPickerState.nodeIndex = 0;
    previousPickerState.outputIndex = 0;
  }
  markPickerSelection('task', index);
  renderPickerNodes();
  if (focusNext) focusPickerLevel('node');
}

function activatePickerNode(index, focusNext) {
  var task = currentPickerTask();
  if (!task || !task.nodes[index]) return;
  var changed = previousPickerState.nodeIndex !== index;
  previousPickerState.nodeIndex = index;
  if (changed) previousPickerState.outputIndex = 0;
  markPickerSelection('node', index);
  renderPickerOutputs();
  if (focusNext) focusPickerLevel('output');
}

function updatePickerPath() {
  var task = currentPickerTask();
  var node = currentPickerNode();
  var output = currentPickerOutput();
  var values = [];
  if (task) values.push(task.task_name);
  if (node) values.push(node.node_name);
  if (output) values.push(output.field_name);
  document.getElementById('previous-picker-path').textContent =
    values.length ? values.join(' → ') : '출력값을 선택하세요.';
}

function focusPickerLevel(level) {
  var list = document.getElementById('previous-picker-' +
    (level === 'task' ? 'tasks' : level === 'node' ? 'nodes' : 'outputs'));
  var active = list.querySelector('.previous-picker-option.active') ||
               list.querySelector('.previous-picker-option');
  if (active) active.focus();
}

function locatePickerRef(ref) {
  if (!ref) return false;
  for (var ti = 0; ti < PREVIOUS_TASKS.length; ti += 1) {
    var task = PREVIOUS_TASKS[ti];
    if (task.task_id !== ref.from_task) continue;
    for (var ni = 0; ni < task.nodes.length; ni += 1) {
      var node = task.nodes[ni];
      if (node.node_id !== ref.from_node) continue;
      for (var oi = 0; oi < node.outputs.length; oi += 1) {
        if (node.outputs[oi].field_id === ref.from_field) {
          previousPickerState.taskIndex = ti;
          previousPickerState.nodeIndex = ni;
          previousPickerState.outputIndex = oi;
          return true;
        }
      }
    }
  }
  return false;
}

function openPreviousTaskPicker(row, oldSource) {
  if (!PREVIOUS_TASKS.length || !previousPicker || previousPicker.open) return;
  previousPickerState.row = row;
  previousPickerState.oldSource = oldSource || row.querySelector('.io-source').value;
  previousPickerState.oldRef = copyPreviousSourceRef(previousSourceRef(row));
  previousPickerState.taskIndex = 0;
  previousPickerState.nodeIndex = 0;
  previousPickerState.outputIndex = 0;
  locatePickerRef(previousSourceRef(row));
  renderPickerTasks();
  renderPickerNodes();
  if (previousPicker.showModal) previousPicker.showModal();
  else previousPicker.setAttribute('open', '');
  focusPickerLevel('task');
}

function closePreviousTaskPicker(restore) {
  var row = previousPickerState.row;
  if (restore && row && row.isConnected) {
    var select = row.querySelector('.io-source');
    select.value = previousPickerState.oldSource || '__external__';
    restorePreviousSourceRef(row, previousPickerState.oldRef);
    select.dataset.previousValue = select.value;
    syncPreviousTaskControl(row);
    syncIOReferences();
    refreshProgress();
    select.focus();
  }
  if (previousPicker.close) previousPicker.close();
  else previousPicker.removeAttribute('open');
  previousPickerState.row = null;
}

function choosePreviousOutput(output) {
  var row = previousPickerState.row;
  if (!row || !row.isConnected) return;
  var select = row.querySelector('.io-source');
  setPreviousSourceRef(row, output);
  select.value = PREVIOUS_TASK_SOURCE;
  select.dataset.previousValue = PREVIOUS_TASK_SOURCE;
  delete row.dataset.broken;
  row.classList.remove('broken');
  var warning = row.querySelector('.io-warning');
  if (warning) warning.hidden = true;
  syncPreviousTaskControl(row);
  closePreviousTaskPicker(false);
  syncIOReferences();
  refreshProgress();
  markNodeTestsStale();
  select.focus();
}

function movePickerFocus(level, delta) {
  var list = document.getElementById('previous-picker-' +
    (level === 'task' ? 'tasks' : level === 'node' ? 'nodes' : 'outputs'));
  var buttons = Array.from(list.querySelectorAll('.previous-picker-option'));
  if (!buttons.length) return;
  var current = buttons.indexOf(document.activeElement);
  if (current < 0) current = 0;
  var next = (current + delta + buttons.length) % buttons.length;
  buttons[next].focus();
}

previousPicker.addEventListener('keydown', function (event) {
  var button = event.target.closest('.previous-picker-option');
  if (!button) return;
  var level = button.dataset.level;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    movePickerFocus(level, event.key === 'ArrowDown' ? 1 : -1);
  } else if (event.key === 'ArrowRight') {
    event.preventDefault();
    if (level === 'task') focusPickerLevel('node');
    else if (level === 'node') focusPickerLevel('output');
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault();
    if (level === 'output') focusPickerLevel('node');
    else if (level === 'node') focusPickerLevel('task');
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    var index = Number(button.dataset.index);
    if (level === 'output') {
      var node = currentPickerNode();
      if (node && node.outputs[index]) choosePreviousOutput(node.outputs[index]);
    } else if (level === 'task') {
      activatePickerTask(index, false);
      focusPickerLevel('node');
    } else {
      activatePickerNode(index, false);
      focusPickerLevel('output');
    }
  }
});
previousPicker.addEventListener('cancel', function (event) {
  event.preventDefault();
  closePreviousTaskPicker(true);
});
previousPicker.querySelectorAll('.previous-picker-close,.previous-picker-cancel')
  .forEach(function (button) {
    button.addEventListener('click', function () { closePreviousTaskPicker(true); });
  });

function syncIOReferences() {
  var catalog = {};
  var nodeNos = {};
  QUESTIONS.forEach(function (q) { nodeNos[q.node_id] = Number(q.node_no || 0); });
  QUESTIONS.forEach(function (q) {
    (q.source_options || []).forEach(function (opt) {
      var parsed = sourceNodeId(opt.value);
      if (parsed && !catalog[opt.value]) {
        catalog[opt.value] = { value: opt.value, label: opt.label,
                               nodeNo: nodeNos[parsed.node] || null, nodeId: parsed.node };
      }
    });
  });
  document.querySelectorAll('fieldset.io_confirm').forEach(function (producer) {
    var nodeId = producer.dataset.nodeId;
    var nodeNo = Number(producer.dataset.nodeNo || 0);
    Object.keys(catalog).forEach(function (value) {
      var parsed = sourceNodeId(value);
      if (parsed && parsed.node === nodeId) delete catalog[value];
    });
    producer.querySelectorAll('.output-row:not(.io-template)').forEach(function (row) {
      var outputId = row.dataset.outputId;
      var name = row.querySelector('.io-name').value.trim() || outputId;
      if (!outputId) return;
      var value = '$.nodes.' + nodeId + '.output.' + outputId;
      catalog[value] = { value: value,
        label: '[' + nodeNo + '. ' + producer.dataset.nodeName + ']의 ' + name + ' 출력',
        nodeNo: nodeNo, nodeId: nodeId };
    });
  });

  document.querySelectorAll('fieldset.io_confirm').forEach(function (consumer) {
    var consumerNo = Number(consumer.dataset.nodeNo || 0);
    consumer.querySelectorAll('.input-row:not(.io-template)').forEach(function (row) {
      var select = row.querySelector('.io-source');
      var current = select.value;
      Array.from(select.options).forEach(function (opt) {
        if (sourceNodeId(opt.value)) opt.remove();
      });
      Object.keys(catalog).sort().forEach(function (value) {
        var item = catalog[value];
        if (item.nodeNo && item.nodeNo >= consumerNo) return;
        var opt = document.createElement('option');
        opt.value = item.value; opt.textContent = item.label;
        select.appendChild(opt);
      });
      var parsed = sourceNodeId(current);
      var broken = parsed && !catalog[current];
      if (broken) {
        var invalid = document.createElement('option');
        invalid.value = current;
        invalid.textContent = '선택 필요 — 삭제된 선행 출력';
        invalid.dataset.broken = 'true';
        select.insertBefore(invalid, select.firstChild);
      }
      if (Array.from(select.options).some(function (opt) { return opt.value === current; })) {
        select.value = current;
      }
      if (row.dataset.broken === 'removed') broken = true;
      row.classList.toggle('broken', !!broken);
      var warning = row.querySelector('.io-warning');
      if (warning) {
        warning.hidden = !broken;
        warning.textContent = parsed ? '선행 출력이 삭제되어 출처를 다시 선택해야 합니다.'
                                     : '선행 노드가 삭제되어 출처를 다시 선택해야 합니다.';
      }
      syncPreviousTaskControl(row);
    });
  });
}

document.querySelectorAll('.input-row').forEach(function (row) {
  ensurePreviousTaskControl(row);
});
document.querySelectorAll('fieldset.io_confirm').forEach(function (fs) {
  var maxOutputSeq = 0;
  fs.querySelectorAll('.output-row:not(.io-template)').forEach(function (row) {
    var match = /^output_(\\d+)$/.exec(row.dataset.outputId || '');
    if (match) maxOutputSeq = Math.max(maxOutputSeq, Number(match[1]));
  });
  fs.dataset.nextOutputSeq = String(maxOutputSeq + 1);
  fs.addEventListener('input', function (ev) {
    if (ev.target.classList.contains('io-name') && ev.target.closest('.output-row')) {
      syncIOReferences();
    }
  });
  fs.addEventListener('focusin', function (ev) {
    if (ev.target.classList.contains('io-source')) {
      ev.target.dataset.previousValue = ev.target.value;
    }
  });
  fs.addEventListener('pointerdown', function (ev) {
    if (ev.target.classList.contains('io-source')) {
      ev.target.dataset.previousValue = ev.target.value;
    }
  });
  fs.addEventListener('change', function (ev) {
    if (ev.target.classList.contains('io-source')) {
      var row = ev.target.closest('.input-row');
      if (ev.target.value === PREVIOUS_TASK_SOURCE) {
        openPreviousTaskPicker(row, ev.target.dataset.previousValue || '__external__');
        return;
      }
      clearPreviousSourceRef(row);
      syncPreviousTaskControl(row);
      delete row.dataset.broken;
      ev.target.dataset.previousValue = ev.target.value;
      syncIOReferences();
    }
  });
});
syncIOReferences();

function updateAgentDraftCard(textarea, value) {
  var fieldset = textarea && textarea.closest('fieldset.q');
  var card = fieldset && fieldset.querySelector('.agent-draft-card');
  if (!card) return;
  var original = textarea.dataset.draft || '';
  var edited = value !== original;
  var no = Number(fieldset.dataset.no || 0);
  var question = QUESTIONS.find(function (item) { return item.no === no; });
  var source = card.querySelector('.agent-draft-source');
  var preview = card.querySelector('.agent-draft-preview');
  if (source) {
    source.textContent = edited
      ? '직접 수정한 초안'
      : (question && question.agent_draft_ready
        ? 'AI가 수정한 초안'
        : '기본 초안');
  }
  if (preview) {
    preview.textContent = value || '프롬프트 내용이 비어 있습니다.';
  }
  card.classList.toggle('user-edited', edited);
}

document.querySelectorAll('.prompt-open').forEach(function (button) {
  button.addEventListener('click', function () {
    var dialog = document.getElementById(button.dataset.dialog);
    openPromptDialog(dialog);
  });
});
function openPromptDialog(dialog) {
  if (!dialog || dialog.open) return;
  var ta = dialog.querySelector('textarea');
  dialog.dataset.before = ta.value;
  if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', '');
  ta.focus();
}
document.querySelectorAll('input[data-open-dialog]').forEach(function (radio) {
  radio.addEventListener('change', function () {
    if (radio.checked) openPromptDialog(document.getElementById(radio.dataset.openDialog));
  });
});
document.querySelectorAll('.prompt-dialog').forEach(function (dialog) {
  var close = function (restore) {
    if (restore) dialog.querySelector('textarea').value = dialog.dataset.before || '';
    if (dialog.close) dialog.close(); else dialog.removeAttribute('open');
    refreshProgress();
  };
  dialog.querySelectorAll('.prompt-cancel').forEach(function (b) {
    b.addEventListener('click', function () { close(true); });
  });
  dialog.querySelector('.prompt-reset').addEventListener('click', function () {
    var ta = dialog.querySelector('textarea'); ta.value = ta.dataset.draft || ''; ta.focus();
  });
  dialog.querySelector('.prompt-apply').addEventListener('click', function () {
    var preview = dialog.closest('.prompt-detail').querySelector('.prompt-preview');
    var textarea = dialog.querySelector('textarea');
    var value = textarea.value;
    preview.textContent = value || dialog.dataset.emptyPreview || '';
    updateAgentDraftCard(textarea, value);
    close(false);
    markNodeTestsStale({target: dialog});
  });
  dialog.addEventListener('cancel', function (ev) { ev.preventDefault(); close(true); });
});
document.querySelectorAll('.agent-draft-edit textarea').forEach(function (textarea) {
  if (textarea.closest('.prompt-dialog')) return;
  textarea.addEventListener('input', function () {
    updateAgentDraftCard(textarea, textarea.value);
  });
});
document.querySelectorAll('input[type="radio"][value="agent_draft_use"]').forEach(
  function (radio) {
    radio.addEventListener('change', function () {
      if (!radio.checked) return;
      var fieldset = radio.closest('fieldset.q');
      var textarea = fieldset && fieldset.querySelector(
        '.agent-draft-edit textarea');
      if (textarea) updateAgentDraftCard(
        textarea, textarea.dataset.draft || '');
    });
  });

function agentDraftQuestion(jobId) {
  return QUESTIONS.find(function (question) {
    return question.agent_draft_id === jobId;
  });
}

function agentDraftFieldset(question) {
  return document.querySelector(
    'fieldset.q[data-no="' + question.no + '"]');
}

function setAgentDraftEditingLocked(question, locked) {
  var fieldset = agentDraftFieldset(question);
  if (!fieldset) return;
  fieldset.classList.toggle('agent-draft-locked', locked);
  var editRadio = fieldset.querySelector(
    'input[type="radio"][value="agent_draft_edit"]');
  if (editRadio) editRadio.disabled = locked;
  fieldset.querySelectorAll(
    '.agent-draft-edit textarea, .agent-draft-edit .prompt-open, ' +
    '.agent-draft-edit .prompt-reset, .agent-draft-edit .prompt-apply'
  ).forEach(function (control) {
    control.disabled = locked;
  });
}

function applyAgentDraftUpdate(update) {
  if (!update || typeof update.content !== 'string') return;
  var question = agentDraftQuestion(update.job_id);
  if (!question || update.revision !== question.agent_draft_revision) return;
  var content = update.content.trim();
  if (!content) return;
  var fieldset = agentDraftFieldset(question);
  if (!fieldset) return;
  question.agent_draft = content;
  question.agent_draft_pending = false;
  question.agent_draft_ready = true;
  setAgentDraftEditingLocked(question, false);
  var status = fieldset.querySelector('.agent-draft-status');
  if (status) status.textContent = 'AI가 수정한 초안입니다.';
  var generateButton = fieldset.querySelector('.agent-draft-generate');
  if (generateButton) generateButton.remove();
  fieldset.querySelectorAll('.agent-draft-edit textarea').forEach(function (textarea) {
    textarea.dataset.draft = content;
    textarea.value = content;
  });
  syncDraftSubmissionLock();
  var card = fieldset.querySelector('.agent-draft-card');
  var source = card && card.querySelector('.agent-draft-source');
  var preview = card && card.querySelector('.agent-draft-preview');
  if (source) source.textContent = 'AI가 수정한 초안';
  if (preview) preview.textContent = content;
  if (card) card.classList.remove('user-edited');
  fieldset.querySelectorAll('.prompt-preview').forEach(function (item) {
    item.textContent = content;
  });
  var useRadio = fieldset.querySelector(
    'input[type="radio"][value="agent_draft_use"]');
  if (useRadio) {
    useRadio.checked = true;
    useRadio.dispatchEvent(new Event('change', {bubbles: true}));
  }
  refreshProgress();
}

var authorStateTimer = null;
var authorStatePolling = false;
var awaitingViewTransition = false;

function markDecisionDraftsPending() {
  QUESTIONS.filter(function (question) {
    return question.qtype === 'decision_prompt' && question.agent_draft_id;
  }).forEach(function (question) {
    if (question.agent_draft_ready) return;
    question.agent_draft_pending = true;
    setAgentDraftEditingLocked(question, true);
    var fieldset = agentDraftFieldset(question);
    var status = fieldset && fieldset.querySelector('.agent-draft-status');
    if (status) status.textContent = 'AI가 초안을 수정하고 있습니다…';
  });
}

function syncDraftSubmissionLock() {
  var pending = QUESTIONS.filter(function (question) {
    return question.agent_draft_pending;
  }).length;
  var confirm = document.getElementById('confirm');
  var message = document.getElementById('ai-draft-submit-lock');
  if (confirm) confirm.disabled = pending > 0;
  if (message) {
    message.hidden = pending === 0;
    message.textContent = pending
      ? 'AI 초안 ' + pending + '개 수정 중 · 완료 후 확정 가능'
      : '';
  }
}

function applyDraftRequestState(request) {
  if (!request || !request.job_id) return;
  var question = agentDraftQuestion(request.job_id);
  if (!question) return;
  var fieldset = agentDraftFieldset(question);
  if (!fieldset) return;
  var pending = request.state === 'requested' || request.state === 'processing';
  if (!question.agent_draft_ready) question.agent_draft_pending = pending;
  setAgentDraftEditingLocked(question, pending);
  var button = fieldset.querySelector('.agent-draft-generate');
  if (button) {
    button.disabled = pending;
    button.textContent = pending ? 'AI 수정 중…' : 'AI로 초안 수정';
  }
  var status = fieldset.querySelector('.agent-draft-status');
  if (status && pending) {
    status.textContent = 'AI가 초안을 수정하고 있습니다…';
  }
}

function updateDraftGenerationUI(body) {
  if (!body) return false;
  var state = body.draft_generation_state || 'idle';
  var requests = Array.isArray(body.draft_requests)
    ? body.draft_requests
    : [];
  requests.forEach(applyDraftRequestState);
  var active = QUESTIONS.some(function (question) {
    return question.agent_draft_pending;
  });
  var button = document.getElementById('ai-draft-generate');
  var progress = document.getElementById('ai-draft-progress');
  var detail = body.draft_progress || {};
  if (!requests.length && (state === 'requested' || state === 'processing')) {
    markDecisionDraftsPending();
    active = true;
  }
  if (button) {
    button.disabled = active;
    button.textContent = active ? 'AI 초안 생성 중…' : '판단 노드 AI 초안 갱신';
  }
  if (progress) {
    if (active) {
      progress.textContent = '판단 노드 초안을 준비하고 있습니다. 완료 ' +
        String(detail.completed || 0) + '/' + String(detail.total || 0);
    } else if (state === 'complete') {
      progress.textContent = '판단 노드 AI 초안 갱신이 완료되었습니다.';
    } else {
      progress.textContent = '';
    }
  }
  syncDraftSubmissionLock();
  return active;
}

function scheduleAuthorStatePoll(delay) {
  if (authorStateTimer !== null) return;
  authorStateTimer = window.setTimeout(function () {
    authorStateTimer = null;
    pollAuthorState();
  }, delay);
}

function pollAuthorState() {
  if (!CONNECTED || !CONNECTED.state_url || typeof fetch !== 'function') return;
  if (authorStatePolling) return;
  authorStatePolling = true;
  fetch(CONNECTED.state_url, {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store'
  }).then(function (response) {
    if (!response.ok) throw new Error('draft status unavailable');
    return response.json();
  }).then(function (body) {
    if (
      Number(body.view_generation || 0) >
      Number(CONNECTED.view_generation || 0)
    ) {
      window.location.reload();
      return;
    }
    (body.draft_updates || []).forEach(applyAgentDraftUpdate);
    var draftActive = updateDraftGenerationUI(body);
    authorStatePolling = false;
    if (awaitingViewTransition || draftActive) scheduleAuthorStatePoll(1200);
  }).catch(function () {
    authorStatePolling = false;
    if (
      awaitingViewTransition ||
      QUESTIONS.some(function (question) {
        return question.agent_draft_pending;
      })
    ) scheduleAuthorStatePoll(2500);
  });
}

if (CONNECTED && Array.isArray(CONNECTED.draft_updates)) {
  CONNECTED.draft_updates.forEach(applyAgentDraftUpdate);
}
if (CONNECTED) {
  var initialDraftActive = updateDraftGenerationUI(CONNECTED);
  if (initialDraftActive) scheduleAuthorStatePoll(0);
}

document.querySelectorAll('.agent-draft-generate').forEach(function (button) {
  button.addEventListener('click', function () {
    if (!CONNECTED || !CONNECTED.draft_generate_url || typeof fetch !== 'function') {
      return;
    }
    var question = agentDraftQuestion(button.dataset.jobId);
    if (!question || question.agent_draft_pending || question.agent_draft_ready) {
      return;
    }
    var fieldset = agentDraftFieldset(question);
    var status = fieldset && fieldset.querySelector('.agent-draft-status');
    question.agent_draft_pending = true;
    setAgentDraftEditingLocked(question, true);
    button.disabled = true;
    button.textContent = 'AI 수정 요청 중…';
    if (status) status.textContent = 'AI 수정 요청을 보내고 있습니다…';
    syncDraftSubmissionLock();
    fetch(CONNECTED.draft_generate_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Ops-CSRF': CONNECTED.csrf_token
      },
      credentials: 'same-origin',
      body: JSON.stringify({
        node_id: button.dataset.nodeId,
        job_id: button.dataset.jobId,
        revision: button.dataset.revision
      })
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (body) {
        if (!response.ok) {
          throw new Error(body.reason || 'AI 초안 수정을 시작하지 못했습니다.');
        }
        return body;
      });
    }).then(function (body) {
      button.textContent = 'AI 수정 중…';
      updateDraftGenerationUI(body);
      scheduleAuthorStatePoll(0);
    }).catch(function (error) {
      question.agent_draft_pending = false;
      setAgentDraftEditingLocked(question, false);
      button.disabled = false;
      button.textContent = 'AI로 초안 수정';
      if (status) {
        status.textContent =
          'AI 수정을 시작하지 못했습니다. 기본 초안은 그대로 유지됩니다. ' +
          error.message;
      }
      syncDraftSubmissionLock();
    });
  });
});

var aiDraftDialog = document.getElementById('ai-draft-confirm');
var aiDraftButton = document.getElementById('ai-draft-generate');
if (aiDraftButton && aiDraftDialog) {
  aiDraftButton.addEventListener('click', function () {
    if (aiDraftDialog.showModal) aiDraftDialog.showModal();
    else aiDraftDialog.setAttribute('open', '');
  });
  aiDraftDialog.querySelectorAll('.ai-draft-cancel').forEach(function (button) {
    button.addEventListener('click', function () {
      if (aiDraftDialog.close) aiDraftDialog.close();
      else aiDraftDialog.removeAttribute('open');
    });
  });
  aiDraftDialog.addEventListener('cancel', function (event) {
    event.preventDefault();
    if (aiDraftDialog.close) aiDraftDialog.close();
    else aiDraftDialog.removeAttribute('open');
  });
  aiDraftDialog.querySelector('.ai-draft-confirm').addEventListener(
    'click', function () {
      if (aiDraftDialog.close) aiDraftDialog.close();
      else aiDraftDialog.removeAttribute('open');
      aiDraftButton.disabled = true;
      aiDraftButton.textContent = 'AI 초안 생성 요청 중…';
      fetch(CONNECTED.draft_generate_url, {
        method: 'POST',
        headers: { 'X-Ops-CSRF': CONNECTED.csrf_token },
        credentials: 'same-origin'
      }).then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (body) {
          if (!response.ok) {
            throw new Error(body.reason || 'AI 초안 생성을 시작하지 못했습니다.');
          }
          return body;
        });
      }).then(function (body) {
        updateDraftGenerationUI(body);
        scheduleAuthorStatePoll(0);
      }).catch(function (error) {
        aiDraftButton.disabled = false;
        aiDraftButton.textContent = '판단 노드 AI 초안 갱신';
        var progress = document.getElementById('ai-draft-progress');
        if (progress) progress.textContent =
          'AI 초안 생성을 시작하지 못했습니다: ' + error.message;
      });
    });
}

// 라벨 편집 행 — 추가는 숨은 템플릿 복제, 삭제는 행 제거 (재렌더 없는 정적 폼 관례)
document.querySelectorAll('fieldset.labels_fixed').forEach(function (fs) {
  fs.addEventListener('click', function (ev) {
    var t = ev.target;
    if (t.classList.contains('lbl-add')) {
      var tpl = fs.querySelector('.lbl-template');
      var row = tpl.cloneNode(true);
      row.classList.remove('lbl-template');
      row.hidden = false;
      tpl.parentNode.insertBefore(row, fs.querySelector('.lbl-add'));
      refreshProgress();
      markNodeTestsStale({target: fs});
    } else if (t.classList.contains('lbl-del')) {
      t.closest('.lbl-row').remove();
      refreshProgress();
      markNodeTestsStale({target: fs});
    }
  });
});

function el(name) { return form.elements[name]; }
function txt(name) { var e = el(name); return e ? e.value.trim() : ''; }

function collect(q) {
  var n = q.no, qt = q.qtype, e = el('q' + n);
  if (q.design_locked && qt === 'labels_fixed') {
    return { value: '그대로' };
  }
  if (q.agent_draft !== undefined &&
      (qt === 'decision_prompt' || qt === 'file_write_content')) {
    if (!e || !e.value) return { missing: true };
    if (qt === 'file_write_content' && e.value === 'agent_template') {
      var agentTpl = txt('q' + n + '_template');
      return agentTpl
        ? { value: { mode: 'template', content: agentTpl } }
        : { missing: true };
    }
    var content = q.agent_draft || '';
    if (e.value === 'agent_draft_edit') {
      content = txt('q' + n + '_agent_draft');
    }
    if (!content.trim()) return { missing: true };
    if (qt === 'decision_prompt') {
      return { value: '판단 기준 입력', detail: content };
    }
    return { value: { mode: 'generate', content: content } };
  }
  if (qt === 'labels_fixed') {
    // 최종 배열 제출 — 이름 변경·추가·삭제·분기 대상까지. 무수정이면 '그대로'를
    // 명시 제출해 번호 공백을 없애고, 이름이 비거나 겹치면·행이 0개면 미입력 처리
    var fsL = document.querySelector('fieldset[data-no="' + n + '"]');
    var rowsL = fsL.querySelectorAll('.lbl-row:not(.lbl-template)');
    var outL = [], seenL = {}, badL = false, changedL = rowsL.length !== q.labels.length;
    rowsL.forEach(function (row) {
      var nameEl = row.querySelector('.lbl-name');
      var name = nameEl.value.trim();
      var next = row.querySelector('.lbl-next').value || null;
      if (!name || seenL[name]) { badL = true; return; }
      seenL[name] = true;
      var was = nameEl.dataset.was || null;
      var item = { label: name, next: next };
      if (was) item.was = was;
      outL.push(item);
      if (!was || was !== name || (row.dataset.next || '') !== (next || '')) changedL = true;
    });
    if (badL || !outL.length) return { missing: true };
    if (!changedL) return { value: '그대로' };
    return { value: outL };
  }
  if (qt === 'method_choice' || qt === 'notify_channel') {
    var v = e.value;
    if (!v) return { missing: true };
    var a = { value: v };
    if (qt === 'method_choice') {
      if (v === 'api') {
        // 구조화 api 상세 — endpoint는 사실값이라 없으면 답이 아니다(실측 규칙 유지)
        var ep = txt('q' + n + '_api_endpoint');
        if (!ep) return { missing: true };
        var det = { endpoint: ep, http_method: el('q' + n + '_api_method').value };
        var ak = el('q' + n + '_api_auth_kind').value;
        if (ak) {
          var an = txt('q' + n + '_api_auth_name');
          if (!an) return { missing: true };  // 방식만 있고 이름 없음 = 미입력
          det.auth = { kind: ak, name: an };
        }
        var req = {}, badReq = false;
        var builder = document.querySelector(
          '[data-api-builder][data-api-no="' + n + '"]');
        apiRequestRows(builder).forEach(function (row) {
          var key = row.querySelector('[data-api-key]').value.trim();
          if (!key) return;
          if (req[key] !== undefined) {
            badReq = true;
            return;
          }
          var mode = row.querySelector('[data-api-value-mode]').value;
          if (mode === 'source') {
            var source = row.querySelector('[data-api-source]').value;
            if (!source) {
              badReq = true;
              return;
            }
            req[key] = source;
          } else {
            req[key] = row.querySelector('[data-api-literal]').value;
          }
        });
        if (badReq) return { missing: true };
        if (Object.keys(req).length) det.request = req;
        var rf = {}, badResp = false;
        (q.output_fields || []).forEach(function (o) {
          var re = el('q' + n + '_resp_' + o.id);
          if (!re) return;
          var pv = re.value.trim();
          if (!pv) return;
          var original = re.dataset.apiResponseOriginal || '';
          var originalDisplay = re.dataset.apiResponseDisplay || '';
          if (original && pv === originalDisplay) {
            rf[o.id] = original;
          } else if (pv === '응답 전체') {
            rf[o.id] = '$.body';
          } else if (pv.indexOf('$.body') === 0) {
            rf[o.id] = pv;
          } else if (pv.indexOf('$.') === 0) {
            badResp = true;
          } else {
            rf[o.id] = '$.body.' + pv;
          }
        });
        if (badResp) return { missing: true };
        if (Object.keys(rf).length) det.response_fields = rf;
        a.detail = det;
        return a;
      }
      if (v === 'command') {
        // 실행 파일 경로만 — 입력값 인자 전달 command는 적용기가 조립한다
        var cp = txt('q' + n + '_command');
        if (!cp) return { missing: true };
        a.detail = q.legacy_command ? { command: cp } : { path: cp };
        return a;
      }
      if (v === 'mcp') {
        // 서버 이름·지시문 둘 다 사실값 — 하나라도 없으면 답이 아니다
        var ms = txt('q' + n + '_mcp_server');
        var mi = txt('q' + n + '_mcp_instruction');
        if (!ms || !mi) return { missing: true };
        a.detail = { server: ms, instruction: mi };
        return a;
      }
      if (v === 'manual') {
        var d = el('q' + n + '_manual');
        var det2 = {};
        if (d.defaultValue.trim() && d.value === d.defaultValue) det2.guide = '그대로';
        else if (d.value.trim()) det2.guide = d.value.trim();
        var mu = txt('q' + n + '_manual_url');
        if (mu && !(mu.toLowerCase().startsWith('http://') ||
                    mu.toLowerCase().startsWith('https://'))) return { missing: true };
        if (mu) det2.url = mu;
        var copyAutomation = el('q' + n + '_manual_copy_automation');
        if (mu && copyAutomation && copyAutomation.checked) {
          det2.copy_automation = true;
        }
        if (det2.guide !== undefined || det2.url !== undefined) a.detail = det2;
        return a;
      }
    }
    return a;
  }
  if (qt === 'manual_guide') {
    if (e.defaultValue.trim() && e.value === e.defaultValue) return { value: '그대로' };
    if (e.value.trim()) return { value: e.value.trim() };
    return { missing: true };
  }
  if (qt === 'decision_prompt') {
    // 판단 기준은 항상 파일 관리 — '그대로'(초안 그대로 생성) 또는
    // '판단 기준 입력'(사용자 원문을 그대로 파일로 작성)
    if (!e.value) return { missing: true };
    if (e.value === '판단 기준 입력') {
      var criteriaEl = el('q' + n + '_criteria');
      var criteria = criteriaEl ? criteriaEl.value : '';
      return criteria.trim() ? { value: '판단 기준 입력', detail: criteria } : { missing: true };
    }
    return { value: e.value };
  }
  if (qt === 'custom_logic_opt') {
    // 기본 '사용 안 함' 체크 — '커스텀 로직 구현하기'는 로직 설명이 있어야 답이 된다
    // (설명 없이 코드를 만들면 로직 지어내기가 된다)
    if (!e || !e.value) return { missing: true };
    if (e.value === '커스텀 로직 유지') {
      return { value: e.value, detail: {
        expected_asset_fingerprint: q.asset_fingerprint || null
      }};
    }
    if (e.value !== '커스텀 로직') return { value: e.value };
    var lg = txt('q' + n + '_logic');
    return lg ? { value: '커스텀 로직', detail: {
      description: lg,
      expected_asset_fingerprint: q.asset_fingerprint || null
    }} : { missing: true };
  }
  if (qt === 'labels_input') {
    var ls = e.value.split('\\n').map(function (s) { return s.trim(); })
      .filter(function (s) { return s; });
    return ls.length ? { value: ls } : { missing: true };
  }
  if (qt === 'file_read_spec') {
    var v4 = e.value;
    if (!v4) return { missing: true };
    if (v4 === 'path') {
      var fp = txt('q' + n + '_path');
      return fp ? { value: { mode: 'path', path: fp } } : { missing: true };
    }
    if (v4 === 'runtime_path') {
      var pfi = txt('q' + n + '_path_input');
      return pfi ? { value: { mode: 'runtime_path', path_input: pfi } } : { missing: true };
    }
    if (v4 === 'folder_hint') {
      var dir = txt('q' + n + '_directory'), hint = txt('q' + n + '_file_hint');
      return (dir && hint) ? { value: { mode: 'folder_hint', directory: dir, file_hint: hint } }
                           : { missing: true };
    }
    // manual이면 안내문도 함께 받는다 — 추천 무수정은 '그대로'(manual_guide 규칙 동일)
    var g = el('q' + n + '_manual');
    if (g) {
      if (g.defaultValue.trim() && g.value === g.defaultValue) return { value: 'manual', detail: '그대로' };
      if (g.value.trim()) return { value: 'manual', detail: g.value.trim() };
      return { missing: true };
    }
    return { value: 'manual' };
  }
  if (qt === 'file_write_path') {
    if (el('q' + n + '_manual').checked) return { value: 'manual' };
    var wp = e.value.trim();
    return wp ? { value: wp } : { missing: true };
  }
  if (qt === 'file_write_content') {
    if (!e.value) return { missing: true };
    if (e.value === 'generate') {
      var gp = txt('q' + n + '_generation_prompt');
      return gp ? { value: { mode: 'generate', content: gp } } : { missing: true };
    }
    var tpl = txt('q' + n + '_template');
    return tpl ? { value: { mode: 'template', content: tpl } } : { missing: true };
  }
  if (qt === 'io_confirm') {
    var fsI = document.querySelector('fieldset[data-no="' + n + '"]');
    var ins = [], outs = [], seenIn = {}, bad = false;
    fsI.querySelectorAll('.input-row:not(.io-template)').forEach(function (row) {
      var name = row.querySelector('.io-name').value.trim();
      var source = row.querySelector('.io-source').value;
      var sourceRef = source === PREVIOUS_TASK_SOURCE ? previousSourceRef(row) : null;
      var pair = name + '\\n' + source;
      if (!name || !source || (source === PREVIOUS_TASK_SOURCE && !sourceRef) ||
          seenIn[pair] || row.classList.contains('broken')) {
        bad = true; return;
      }
      seenIn[pair] = true;
      var input = { field: name, source: source,
                    original_field: row.dataset.originalField || null };
      if (sourceRef) input.source_ref = sourceRef;
      ins.push(input);
    });
    fsI.querySelectorAll('.output-row:not(.io-template)').forEach(function (row) {
      var name = row.querySelector('.io-name').value.trim();
      if (!name) { bad = true; return; }
      outs.push({ id: row.dataset.outputId || null, name: name });
    });
    return bad ? { missing: true } : { value: { inputs: ins, outputs: outs } };
  }
  var free = e.value.trim();
  return free ? { value: free } : { missing: true };
}

// 진행 카운터·레일 도트 — collect()를 재사용해 "지금 확정하면 답이 되는가"를 센다.
// 카운터는 번호 있는 질문(disp)만 — 고급 옵션은 기본값이 있어 세면 시작부터 부푼다
function refreshProgress() {
  var missing = {};
  QUESTIONS.forEach(function (q) { missing[q.no] = !!collect(q).missing; });
  var tracked = QUESTIONS.filter(function (q) { return q.disp; });
  var done = tracked.filter(function (q) { return !missing[q.no]; }).length;
  document.getElementById('progress').textContent = '답변 ' + done + '/' + tracked.length;
  document.querySelectorAll('.rail-item').forEach(function (it) {
    var ok = it.dataset.nos.split(',').every(function (n) { return !missing[n]; });
    it.classList.toggle('done', ok);
    // 노드별 답변 수 — 번호 있는 질문(tracked)만 센다
    var c = it.querySelector('.rail-count');
    var tracked = (it.dataset.tracked || '').split(',').filter(Boolean);
    if (c && tracked.length) {
      var d = tracked.filter(function (n) { return !missing[n]; }).length;
      c.textContent = d + '/' + tracked.length;
    }
  });
}
form.addEventListener('input', refreshProgress);
form.addEventListener('change', refreshProgress);

function scrollBehavior() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
}

var nodeTestPollTimers = Object.create(null);
var nodeTestVersions = Object.create(null);
var NODE_TEST_POLL_MS = 1000;

function collectNodeTestPayload(nodeId) {
  var answers = [], unanswered = [];
  var customModes = {};
  QUESTIONS.forEach(function (q) {
    if (q.qtype !== 'custom_logic_opt') return;
    var choice = el('q' + q.no);
    customModes[q.node_id] = choice ? choice.value : '';
  });
  QUESTIONS.forEach(function (q) {
    var customMode = customModes[q.node_id];
    if (q.qtype !== 'custom_logic_opt' &&
        (customMode === '커스텀 로직' || customMode === '커스텀 로직 유지')) {
      return;
    }
    var r = collect(q);
    if (r.missing) {
      unanswered.push({
        no: q.no,
        disp: q.disp || ('노드' + q.node_no + ' 고급 옵션'),
        node_id: q.node_id,
        qtype: q.qtype,
        target: q.target
      });
      return;
    }
    var answer = {
      no: q.no,
      node_id: q.node_id,
      qtype: q.qtype,
      target: q.target
    };
    if (q.system) answer.system = q.system;
    if (q.current_revision) answer.current_revision = q.current_revision;
    answer.value = r.value;
    if (r.detail !== undefined) answer.detail = r.detail;
    answers.push(answer);
  });
  return {
    action: 'prepare',
    type: PAYLOAD_TYPE,
    task_id: TASK_ID,
    node_id: nodeId,
    question_count: QUESTIONS.length,
    answers: answers,
    unanswered: unanswered
  };
}

function cancelNodeTestPoll(nodeId) {
  if (nodeTestPollTimers[nodeId] !== undefined) {
    window.clearTimeout(nodeTestPollTimers[nodeId]);
    delete nodeTestPollTimers[nodeId];
  }
}

function nextNodeTestVersion(nodeId) {
  nodeTestVersions[nodeId] = (nodeTestVersions[nodeId] || 0) + 1;
  return nodeTestVersions[nodeId];
}

function nodeTestText(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string' || typeof value === 'number' ||
      typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(nodeTestText).filter(Boolean).join(', ');
  }
  if (typeof value === 'object') {
    if (value.name && value.id) return String(value.name) + ' (' + String(value.id) + ')';
    if (value.name) return String(value.name);
    if (value.label) return String(value.label);
    if (value.field) return String(value.field);
    return Object.keys(value).map(function (key) {
      return key + ': ' + nodeTestText(value[key]);
    }).join(', ');
  }
  return String(value);
}

function appendNodeTestValue(host, label, value) {
  if (value === undefined || value === null || value === '') return;
  var row = document.createElement('p');
  var title = document.createElement('strong');
  title.textContent = label + ': ';
  var content = document.createElement('span');
  content.textContent = nodeTestText(value);
  row.appendChild(title);
  row.appendChild(content);
  host.appendChild(row);
}

function appendNodeTestList(host, label, items) {
  if (items === undefined || items === null) return;
  var values = Array.isArray(items)
    ? items
    : Object.keys(items).map(function (key) {
        return key + ': ' + nodeTestText(items[key]);
      });
  if (!values.length) return;
  var title = document.createElement('strong');
  title.textContent = label;
  host.appendChild(title);
  var list = document.createElement('ul');
  values.forEach(function (item) {
    var li = document.createElement('li');
    li.textContent = nodeTestText(item);
    list.appendChild(li);
  });
  host.appendChild(list);
}

function appendNodeTestNote(host, text) {
  if (!text) return;
  var note = document.createElement('p');
  note.className = 'node-test-note';
  note.textContent = text;
  host.appendChild(note);
}

function addNodeTestTextarea(form, label, key, suggested) {
  var row = document.createElement('label');
  row.className = 'node-test-runtime-field';
  var title = document.createElement('strong');
  title.textContent = label;
  var input = document.createElement('textarea');
  input.dataset.nodeTestKey = key;
  input.placeholder = '필요한 값을 직접 입력해 주세요';
  if (suggested !== undefined && suggested !== null) {
    input.value = nodeTestText(suggested);
  }
  row.appendChild(title);
  row.appendChild(input);
  form.appendChild(row);
  return input;
}

function addNodeTestSelect(form, label, key, choices) {
  var row = document.createElement('label');
  row.className = 'node-test-runtime-field';
  var title = document.createElement('strong');
  title.textContent = label;
  var select = document.createElement('select');
  select.dataset.nodeTestKey = key;
  var blank = document.createElement('option');
  blank.value = '';
  blank.textContent = '선택해 주세요';
  select.appendChild(blank);
  (choices || []).forEach(function (choice) {
    var option = document.createElement('option');
    option.value = String(choice);
    option.textContent = String(choice);
    select.appendChild(option);
  });
  row.appendChild(title);
  row.appendChild(select);
  form.appendChild(row);
  return select;
}

function addNodeTestAction(form, label, handler) {
  var actions = form.querySelector('.node-test-runtime-actions');
  if (!actions) {
    actions = document.createElement('div');
    actions.className = 'node-test-runtime-actions';
    form.appendChild(actions);
  }
  var button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', handler);
  actions.appendChild(button);
  return button;
}

function nodeTestAssistantMode(body) {
  if (!CONNECTED || !CONNECTED.automatic_agent_processing) {
    return {dashboard: false, connected: false};
  }
  if (body && body.assistant_watch &&
      typeof body.assistant_watch === 'object') {
    CONNECTED.assistant_watch = body.assistant_watch;
  }
  var watch = CONNECTED.assistant_watch || {};
  return {
    dashboard: true,
    connected: watch.connected === true,
    disconnected: watch.state === 'disconnected'
  };
}

function copyNodeTestAgentRequest(section, button, status) {
  var value = CONNECTED && CONNECTED.assistant_request_prompt;
  if (!value) {
    status.textContent =
      '요청문을 준비하지 못했습니다. Dashboard의 Agent 요청문 복사를 사용해 주세요.';
    return;
  }
  var done = function () {
    section.querySelector('.node-test-panel').dataset.agentRequestCopied = 'true';
    status.textContent =
      '복사되었습니다. Code Assistant 대화에 붙여넣어 전송해 주세요.';
    button.textContent = '요청문 복사됨';
  };
  var fallback = function () {
    var temporary = document.createElement('textarea');
    temporary.value = value;
    temporary.setAttribute('readonly', '');
    temporary.style.position = 'fixed';
    temporary.style.opacity = '0';
    document.body.appendChild(temporary);
    temporary.focus();
    temporary.select();
    try {
      if (document.execCommand('copy')) {
        temporary.remove();
        done();
        return;
      }
    } catch (_error) {}
    temporary.remove();
    status.textContent =
      '자동 복사에 실패했습니다. Dashboard의 Agent 요청문 복사를 사용해 주세요.';
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(value).then(done, fallback);
  } else {
    fallback();
  }
}

function nodeTestRequest(section, payload, version, loadingText) {
  if (!CONNECTED || !CONNECTED.node_test_url || typeof fetch !== 'function') return;
  var els = nodeTestElements(section);
  els.panel.hidden = false;
  els.panel.dataset.status = 'waiting_agent';
  els.status.textContent = loadingText || '노드 테스트를 요청하는 중입니다...';
  els.detail.textContent = '';
  els.button.disabled = true;
  els.button.setAttribute('aria-expanded', 'true');
  fetch(CONNECTED.node_test_url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Ops-CSRF': CONNECTED.csrf_token
    },
    credentials: 'same-origin',
    body: JSON.stringify(payload)
  }).then(function (response) {
    return response.json().catch(function () { return {}; }).then(function (body) {
      if (!response.ok) {
        if (!body || typeof body !== 'object') body = {};
        if (!body.status) body.status = 'failed';
        if (!body.reason) body.reason = '서버가 노드 테스트를 처리하지 못했습니다.';
      }
      return body;
    });
  }).then(function (body) {
    if (nodeTestVersions[section.dataset.nodeId] !== version) return;
    renderNodeTestResponse(section, body, version);
  }).catch(function (error) {
    if (nodeTestVersions[section.dataset.nodeId] !== version) return;
    renderNodeTestResponse(section, {
      status: 'failed',
      reason: '노드 테스트를 요청하지 못했습니다: ' + error.message
    }, version);
  });
}

function nodeTestElements(section) {
  return {
    panel: section.querySelector('.node-test-panel'),
    status: section.querySelector('.node-test-status'),
    detail: section.querySelector('.node-test-detail'),
    button: section.querySelector('.node-test-button')
  };
}

function nodeTestStateUrl(nodeId, testId) {
  if (!CONNECTED || !CONNECTED.node_test_state_url) return null;
  var separator = CONNECTED.node_test_state_url.indexOf('?') === -1 ? '?' : '&';
  var url = CONNECTED.node_test_state_url + separator +
    'node_id=' + encodeURIComponent(nodeId);
  if (testId) url += '&test_id=' + encodeURIComponent(testId);
  return url;
}

function scheduleNodeTestPoll(section, nodeId, testId, version) {
  var url = nodeTestStateUrl(nodeId, testId);
  if (!url || typeof fetch !== 'function') return;
  cancelNodeTestPoll(nodeId);
  nodeTestPollTimers[nodeId] = window.setTimeout(function () {
    delete nodeTestPollTimers[nodeId];
    fetch(url, {
      method: 'GET',
      headers: { 'X-Ops-CSRF': CONNECTED.csrf_token },
      credentials: 'same-origin',
      cache: 'no-store'
    }).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (body) {
        if (!response.ok) {
          if (!body || typeof body !== 'object') body = {};
          if (!body.status) body.status = 'failed';
          if (!body.reason) body.reason = '테스트 진행 상태를 확인하지 못했습니다.';
        }
        return body;
      });
    }).then(function (body) {
      if (nodeTestVersions[nodeId] !== version) return;
      renderNodeTestResponse(section, body, version);
    }).catch(function (error) {
      if (nodeTestVersions[nodeId] !== version) return;
      renderNodeTestResponse(section, {
        status: 'failed',
        reason: '테스트 진행 상태를 확인하지 못했습니다: ' + error.message
      }, version);
    });
  }, NODE_TEST_POLL_MS);
}

function renderNodeTestResponse(section, body, version) {
  var els = nodeTestElements(section);
  if (!els.panel || !els.status || !els.detail || !els.button) return;
  body = body && typeof body === 'object' ? body : {};
  var known = {
    needs_input: true,
    waiting_user: true,
    waiting_agent: true,
    completed: true,
    preview_only: true,
    cancelled: true,
    stale: true,
    invalid: true,
    conflict: true,
    busy: true,
    failed: true
  };
  var state = known[body.status] ? body.status : 'failed';
  var job = body.job && typeof body.job === 'object' ? body.job : {};
  cancelNodeTestPoll(section.dataset.nodeId);
  els.panel.hidden = false;
  els.panel.dataset.status = state;
  if (body.test_id) els.panel.dataset.testId = body.test_id;
  els.button.setAttribute('aria-expanded', 'true');
  els.detail.textContent = '';

  if (state === 'needs_input') {
    els.status.textContent = '테스트에 필요한 값을 입력해 주세요.';
    appendNodeTestNote(
      els.detail,
      '이전 노드를 테스트했다면 결과가 자동으로 반영됩니다. '
      + '아직 테스트하지 않았다면 아래에 직접 입력해 주세요.');
    var inputForm = document.createElement('div');
    inputForm.className = 'node-test-runtime-form';
    var systemChoices = body.system_choices || job.system_choices || [];
    var systemInput = null;
    if (systemChoices.length) {
      systemInput = addNodeTestSelect(
        inputForm, '테스트할 시스템', '__system__', systemChoices);
    }
    var missingInputs = body.missing_inputs || job.missing_inputs || [];
    missingInputs.forEach(function (item) {
      var key = item.key || item.source || item.field;
      var label = item.label || item.field || item.source || '임시 입력';
      var control;
      if (Array.isArray(item.choices) && item.choices.length) {
        control = addNodeTestSelect(inputForm, label, key, item.choices);
      } else {
        control = addNodeTestTextarea(inputForm, label, key, item.suggested);
      }
      if (Array.isArray(item.systems) && item.systems.length) {
        control.closest('.node-test-runtime-field').dataset.nodeTestSystems =
          item.systems.join('\\u001f');
      }
    });
    var syncSystemInputs = function () {
      var chosen = systemInput ? systemInput.value : '';
      inputForm.querySelectorAll('[data-node-test-systems]').forEach(
        function (row) {
          var applies = row.dataset.nodeTestSystems.split('\\u001f');
          row.hidden = !!systemInput && (
            !chosen || applies.indexOf(chosen) === -1);
        }
      );
    };
    if (systemInput) {
      systemInput.addEventListener('change', syncSystemInputs);
      syncSystemInputs();
    }
    addNodeTestAction(inputForm, '이 입력으로 테스트', function (event) {
      var values = {};
      var selectedSystem = null;
      var missing = [];
      inputForm.querySelectorAll('[data-node-test-key]').forEach(function (control) {
        var row = control.closest('.node-test-runtime-field');
        if (row && row.hidden) return;
        var value = control.value;
        if (!String(value).trim()) {
          missing.push(control);
          return;
        }
        if (control.dataset.nodeTestKey === '__system__') {
          selectedSystem = value;
        } else {
          values[control.dataset.nodeTestKey] = value;
        }
      });
      if (missing.length) {
        els.status.textContent = '임시 입력과 시스템 선택을 모두 채워 주세요.';
        missing[0].focus();
        return;
      }
      event.currentTarget.disabled = true;
      nodeTestRequest(section, {
        action: 'start',
        test_id: body.test_id,
        values: values,
        system: selectedSystem
      }, version, '입력값으로 대상 노드만 실행하는 중입니다...');
    });
    els.detail.appendChild(inputForm);
  } else if (state === 'waiting_user') {
    els.status.textContent = '수동 실행 결과를 입력해 주세요.';
    appendNodeTestList(
      els.detail, '이번 테스트에 연결된 실제 입력',
      body.resolved_inputs || job.inputs);
    appendNodeTestValue(els.detail, '안내', job.prompt || body.prompt);
    var userForm = document.createElement('div');
    userForm.className = 'node-test-runtime-form';
    var slot = job.slot || body.slot;
    var fields = job.fields || body.fields || [];
    var deferrable = job.kind === 'ask_user_deferrable';
    var submitUserResult = function (result, clicked) {
      if (clicked) clicked.disabled = true;
      nodeTestRequest(section, {
        action: 'user_submit',
        test_id: body.test_id,
        job_id: job.job_id,
        expected_revision: job.revision,
        result: result
      }, version, '입력한 결과를 반영하는 중입니다...');
    };
    if (slot === 'output' || slot === 'inputs') {
      fields.forEach(function (field) {
        addNodeTestTextarea(
          userForm,
          field.name || field.id,
          field.id,
          field.suggested
        );
      });
      addNodeTestAction(userForm, '결과 반영', function (event) {
        var output = {};
        var empty = [];
        userForm.querySelectorAll('textarea[data-node-test-key]').forEach(
          function (control) {
            if (!control.value.trim()) empty.push(control);
            output[control.dataset.nodeTestKey] = control.value;
          }
        );
        if (empty.length) {
          els.status.textContent = '테스트 결과값을 모두 입력해 주세요.';
          empty[0].focus();
          return;
        }
        submitUserResult({output: output}, event.currentTarget);
      });
      if (deferrable) {
        addNodeTestAction(
          userForm, '미진행(결과 없이 완료)', function (event) {
            var output = {};
            fields.forEach(function (field) {
              output[field.id] = null;
            });
            submitUserResult({output: output}, event.currentTarget);
          }
        );
        addNodeTestAction(userForm, '다음에 재진행', function (event) {
          event.currentTarget.disabled = true;
          nodeTestRequest(section, {
            action: 'cancel',
            test_id: body.test_id,
            deferred: true
          }, version, '부분 테스트를 보류하는 중입니다...');
        });
      }
    } else if (slot === 'content' || slot === 'path') {
      var valueInput = addNodeTestTextarea(
        userForm,
        slot === 'path' ? '찾은 파일 경로' : '생성 결과',
        slot
      );
      addNodeTestAction(userForm, '결과 반영', function (event) {
        if (!valueInput.value.trim()) {
          els.status.textContent = '테스트 결과값을 입력해 주세요.';
          valueInput.focus();
          return;
        }
        var result = {};
        result[slot] = valueInput.value;
        submitUserResult(result, event.currentTarget);
      });
    } else if (slot === 'system') {
      var schema = job.result_schema || {};
      var choices = (((schema.properties || {}).system || {}).enum || []);
      var systemInput = addNodeTestSelect(
        userForm, '테스트할 시스템', 'system', choices);
      addNodeTestAction(userForm, '시스템 선택', function (event) {
        if (!systemInput.value) {
          els.status.textContent = '테스트할 시스템을 선택해 주세요.';
          systemInput.focus();
          return;
        }
        submitUserResult({system: systemInput.value}, event.currentTarget);
      });
    } else if (
      slot === 'confirm' || slot === 'approval'
      || slot === 'confirm_retry' || slot === 'confirm_done'
    ) {
      addNodeTestAction(userForm, '완료로 반영', function (event) {
        submitUserResult({confirmed: true}, event.currentTarget);
      });
      addNodeTestAction(userForm, '중단으로 반영', function (event) {
        submitUserResult({confirmed: false}, event.currentTarget);
      });
    } else {
      appendNodeTestNote(
        userForm, '이 입력 형식은 화면에서 처리할 수 없습니다. 다시 테스트해 주세요.');
    }
    els.detail.appendChild(userForm);
  } else if (state === 'waiting_agent') {
    var assistantMode = nodeTestAssistantMode(body);
    els.status.textContent = assistantMode.connected
      ? '연결된 Agent가 테스트를 처리하고 있습니다.'
      : assistantMode.disconnected
        ? 'Agent 연결이 필요합니다.'
        : assistantMode.dashboard
          ? 'Agent 연결 상태를 확인하고 있습니다.'
          : 'Code Assistant의 테스트 실행을 기다리고 있습니다.';
    appendNodeTestList(
      els.detail, '이번 테스트에 연결된 실제 입력',
      body.resolved_inputs || job.inputs);
    if (body.temporary_reference_used) {
      appendNodeTestNote(
        els.detail, '직접 붙여넣은 테스트 참고자료를 판단에 함께 전달했습니다.');
    }
    if (assistantMode.connected) {
      delete els.panel.dataset.agentRequestCopied;
      appendNodeTestNote(
        els.detail, '요청문을 다시 복사할 필요가 없습니다.');
    } else if (assistantMode.disconnected) {
      appendNodeTestNote(
        els.detail,
        '아래 요청문을 복사해 Code Assistant 대화에 붙여넣어 전송해 주세요.');
      var agentForm = document.createElement('div');
      agentForm.className = 'node-test-runtime-form';
      var copyStatus = document.createElement('p');
      copyStatus.className = 'node-test-copy-status';
      copyStatus.setAttribute('role', 'status');
      if (els.panel.dataset.agentRequestCopied === 'true') {
        copyStatus.textContent =
          '복사되었습니다. Code Assistant 대화에 붙여넣어 전송해 주세요.';
      }
      var copyButton = addNodeTestAction(
        agentForm,
        els.panel.dataset.agentRequestCopied === 'true'
          ? '요청문 복사됨'
          : 'Agent 요청문 복사',
        function (event) {
          copyNodeTestAgentRequest(
            section, event.currentTarget, copyStatus);
        }
      );
      copyButton.classList.add('agent-request-copy');
      agentForm.appendChild(copyStatus);
      els.detail.appendChild(agentForm);
    } else if (!assistantMode.dashboard) {
      appendNodeTestNote(
        els.detail,
        body.instruction || 'Code Assistant 대화에서 이 노드 테스트 진행을 알려 주세요.');
    } else {
      appendNodeTestNote(
        els.detail, '연결 상태를 다시 확인하고 있습니다. 잠시만 기다려 주세요.');
    }
    appendNodeTestNote(
      els.detail, '완료되면 결과가 이 화면에 자동으로 표시됩니다.');
  } else if (state === 'completed') {
    els.status.textContent = '노드 테스트가 완료되었습니다.';
    appendNodeTestValue(els.detail, '요약', body.summary);
    appendNodeTestList(
      els.detail, '이번 테스트에 연결된 실제 입력',
      body.resolved_inputs);
    var result = body.result || {};
    appendNodeTestValue(els.detail, '판단 라벨', result.label);
    if (Array.isArray(result.display_outputs) && result.display_outputs.length) {
      result.display_outputs.forEach(function (item) {
        appendNodeTestValue(
          els.detail, item.name || item.id || '출력', item.value);
      });
    } else {
      appendNodeTestValue(els.detail, '출력', result.output);
    }
    appendNodeTestValue(els.detail, '근거', result.evidence);
    appendNodeTestValue(els.detail, '파일 경로', result.path);
    if (body.temporary_reference_used) {
      appendNodeTestNote(
        els.detail, '직접 붙여넣은 테스트 참고자료를 포함해 판단했습니다.');
    }
  } else if (state === 'preview_only') {
    els.status.textContent = '실제 실행 없이 설정 미리보기를 완료했습니다.';
    appendNodeTestValue(els.detail, '요약', body.summary);
    var preview = body.preview || {};
    appendNodeTestValue(els.detail, 'Action', preview.action_type);
    appendNodeTestValue(els.detail, '실행 방식', preview.method || preview.channel);
    appendNodeTestValue(els.detail, '대상 경로', preview.path);
    appendNodeTestValue(els.detail, '입력', preview.inputs);
    appendNodeTestValue(els.detail, '안내', preview.manual_guide);
    appendNodeTestNote(
      els.detail,
      preview.note || '외부 변경 가능성이 있어 실제 작업은 실행하지 않았습니다.');
  } else {
    els.status.textContent = state === 'stale'
      ? '설정이 변경되어 다시 테스트해야 합니다.'
      : state === 'cancelled'
        ? '이번 부분 테스트를 보류했습니다.'
        : '노드 테스트를 진행하지 못했습니다.';
    appendNodeTestValue(
      els.detail, '원인',
      body.reason || body.message || body.error || job.error || '알 수 없는 오류');
  }

  var currentTestId = els.panel.dataset.testId;
  var polling = (
    state === 'waiting_agent'
    && !!currentTestId
    && !!nodeTestStateUrl(section.dataset.nodeId, currentTestId)
  );
  els.button.disabled = (
    polling || state === 'needs_input' || state === 'waiting_user');
  if (polling) {
    scheduleNodeTestPoll(
      section, section.dataset.nodeId, currentTestId, version);
  }
}

function showDecisionNodeTestSetup(button) {
  var section = button.closest('section.node');
  if (!section || section.dataset.nodeTestReference !== 'true') return false;
  var nodeId = section.dataset.nodeId;
  nextNodeTestVersion(nodeId);
  cancelNodeTestPoll(nodeId);
  invalidateNodeTest(section);
  var els = nodeTestElements(section);
  delete els.panel.dataset.testId;
  els.panel.hidden = false;
  els.panel.dataset.status = 'setup';
  els.button.disabled = false;
  els.button.setAttribute('aria-expanded', 'true');
  els.status.textContent = '참고자료가 있다면 붙여넣고 테스트를 시작해 주세요.';
  els.detail.textContent = '';

  var setupForm = document.createElement('div');
  setupForm.className = 'node-test-runtime-form';
  var referenceInput = addNodeTestTextarea(
    setupForm, '테스트 참고자료', '__reference__');
  referenceInput.classList.add('node-test-reference-text');
  referenceInput.placeholder =
    '이번 판단 테스트에서 사용할 참고자료를 붙여넣어 주세요';
  addNodeTestAction(setupForm, '테스트 시작', function (event) {
    event.currentTarget.disabled = true;
    runNodeTest(button, true);
  });
  els.detail.appendChild(setupForm);
  referenceInput.focus();
  return true;
}

function runNodeTest(button, startNow) {
  if (!CONNECTED || !CONNECTED.node_test_url || typeof fetch !== 'function') return;
  var section = button.closest('section.node');
  if (!section) return;
  if (!startNow && showDecisionNodeTestSetup(button)) return;
  var nodeId = section.dataset.nodeId;
  var version = nextNodeTestVersion(nodeId);
  cancelNodeTestPoll(nodeId);
  var panel = section.querySelector('.node-test-panel');
  if (panel) delete panel.dataset.testId;
  syncIOReferences();
  var payload = collectNodeTestPayload(nodeId);
  var referenceTexts = {};
  var referenceInput = section.querySelector('.node-test-reference-text');
  if (referenceInput && referenceInput.value.trim()) {
    referenceTexts[nodeId] = referenceInput.value;
  }
  if (Object.keys(referenceTexts).length) {
    payload.node_test_reference_texts = referenceTexts;
  }
  nodeTestRequest(
    section, payload, version, '저장 전 설정으로 대상 노드만 준비하는 중입니다...');
}

document.querySelectorAll('.node-test-button').forEach(function (button) {
  button.addEventListener('click', function () { runNodeTest(button, false); });
});

function invalidateNodeTest(section) {
  if (!CONNECTED || !CONNECTED.node_test_url || typeof fetch !== 'function') return;
  var panel = section.querySelector('.node-test-panel');
  var testId = panel && panel.dataset.testId;
  if (!testId) return;
  delete panel.dataset.testId;
  fetch(CONNECTED.node_test_url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Ops-CSRF': CONNECTED.csrf_token
    },
    credentials: 'same-origin',
    body: JSON.stringify({action: 'cancel', test_id: testId})
  }).catch(function () {
    // 화면에서는 이미 stale이다. 서버 정리는 다음 테스트 시작 때도 보장된다.
  });
}

function currentNodeTestDependencies(nodeId, visiting) {
  var seen = visiting || {};
  if (seen[nodeId]) return [];
  seen[nodeId] = true;
  var direct = (NODE_TEST_DEPENDENCIES[nodeId] || []).slice();
  document.querySelectorAll('fieldset.io_confirm').forEach(function (fieldset) {
    if (fieldset.dataset.nodeId !== nodeId) return;
    fieldset.querySelectorAll('.input-row:not(.io-template) .io-source')
      .forEach(function (select) {
        var parsed = sourceNodeId(select.value);
        if (parsed && direct.indexOf(parsed.node) === -1) {
          direct.push(parsed.node);
        }
      });
  });
  var result = direct.slice();
  direct.forEach(function (sourceNode) {
    currentNodeTestDependencies(sourceNode, seen).forEach(function (ancestor) {
      if (result.indexOf(ancestor) === -1) result.push(ancestor);
    });
  });
  return result;
}

function markNodeTestsStale(event) {
  if (event && event.target && event.target.closest('.node-test-panel')) return;
  var changedSection = (
    event && event.target ? event.target.closest('section.node') : null);
  var changedNodeId = changedSection ? changedSection.dataset.nodeId : null;
  document.querySelectorAll('.node-test-panel').forEach(function (panel) {
    var state = panel.dataset.status;
    if (!state || state === 'stale') return;
    var section = panel.closest('section.node');
    if (!section) return;
    var nodeId = section.dataset.nodeId;
    var dependencies = currentNodeTestDependencies(nodeId);
    if (
      changedNodeId
      && nodeId !== changedNodeId
      && dependencies.indexOf(changedNodeId) === -1
    ) return;
    var els = nodeTestElements(section);
    nextNodeTestVersion(nodeId);
    cancelNodeTestPoll(nodeId);
    invalidateNodeTest(section);
    panel.dataset.status = 'stale';
    els.status.textContent = '설정이 변경되어 다시 테스트해야 합니다.';
    els.detail.textContent = '';
    els.button.disabled = false;
  });
}
form.addEventListener('input', function (event) { markNodeTestsStale(event); });
form.addEventListener('change', function (event) { markNodeTestsStale(event); });

document.getElementById('confirm').addEventListener('click', function () {
  if (QUESTIONS.some(function (question) {
    return question.agent_draft_pending;
  })) {
    syncDraftSubmissionLock();
    return;
  }
  syncIOReferences();
  var broken = document.querySelector('.input-row.broken');
  if (broken) {
    document.getElementById('result').hidden = false;
    document.getElementById('warn').textContent =
      '선행 출력이 삭제된 입력이 있습니다. 다른 출력·외부 입력으로 연결하거나 입력을 삭제해 주세요.';
    broken.closest('fieldset').classList.add('missing');
    broken.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
    return;
  }
  var answers = [], unanswered = [];
  QUESTIONS.forEach(function (q) {
    var r = collect(q);
    if (r.missing) {
      // disp('3-2')가 사용자·AI 공용 표시 번호 — 고급 옵션은 disp가 없어 노드로 짚는다
      unanswered.push({ no: q.no, disp: q.disp || ('노드' + q.node_no + ' 고급 옵션'),
                        node_id: q.node_id, qtype: q.qtype, target: q.target });
      return;
    }
    var a = { no: q.no, node_id: q.node_id, qtype: q.qtype, target: q.target };
    if (q.system) a.system = q.system;
    if (q.current_revision) a.current_revision = q.current_revision;
    a.value = r.value;
    if (r.detail !== undefined) a.detail = r.detail;
    answers.push(a);
  });
  var payload = { type: PAYLOAD_TYPE, task_id: TASK_ID,
                  question_count: QUESTIONS.length, answers: answers, unanswered: unanswered };
  var text = JSON.stringify(payload, null, 2);
  var resultJson = document.getElementById('result-json');
  if (resultJson) resultJson.value = text;
  document.getElementById('result').hidden = false;
  document.getElementById('warn').textContent = unanswered.length
    ? '미입력 질문 ' + unanswered.length + '개 (' +
      unanswered.map(function (u) { return u.disp; }).join(', ') +
      ') — 이대로 제출하면 해당 항목은 채팅에서 다시 여쭤봅니다.'
    : '모든 질문에 답했습니다.';
  document.querySelectorAll('fieldset.q.missing').forEach(function (fs) {
    fs.classList.remove('missing');
  });
  unanswered.forEach(function (u) {
    var fs = document.querySelector('fieldset[data-no="' + u.no + '"]');
    if (fs) fs.classList.add('missing');
  });
  submitOrCopy(text);
  document.getElementById('result').scrollIntoView({ behavior: scrollBehavior() });
});

function submitOrCopy(text) {
  if (!CONNECTED) {
    copyResult();
    return;
  }
  var message = document.getElementById('submit-msg');
  var button = document.getElementById('confirm');
  if (!CONNECTED.submit_url || typeof fetch !== 'function') {
    if (message) {
      message.textContent =
        '서버에 연결하지 못했습니다. 창을 닫지 말고 잠시 후 다시 시도해 주세요.';
    }
    return;
  }
  if (button) button.disabled = true;
  if (message) message.textContent = '변경 내용을 저장하고 검증하는 중입니다...';
  fetch(CONNECTED.submit_url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Ops-CSRF': CONNECTED.csrf_token
    },
    body: text
  }).then(function (response) {
    return response.json().catch(function () { return {}; }).then(function (body) {
      if (!response.ok) {
        throw new Error(body.reason || '서버가 요청을 처리하지 못했습니다.');
      }
      return body;
    });
  }).then(function (body) {
    if (body.status === 'ok' && body.next_stage === 'ready_to_validate') {
      finishValidatedSubmission(body, message, button);
    } else {
      if (message) {
        message.textContent =
          '저장되었습니다. 다음 화면을 준비하고 있습니다.';
      }
      awaitingViewTransition = true;
      scheduleAuthorStatePoll(0);
    }
  }).catch(function (error) {
    if (button) button.disabled = false;
    if (message) {
      message.textContent =
        '저장하지 못했습니다: ' + error.message + ' 내용을 확인한 뒤 다시 시도해 주세요.';
    }
  });
}

function renderValidationResult(validation) {
  var panel = document.getElementById('validation-result');
  if (!panel) return;
  panel.textContent = '';
  panel.classList.toggle('validation-error', !validation.ok);
  var issues = validation.ok
    ? visibleValidationWarnings(validation)
    : (validation.errors || []).map(presentValidationIssue);
  var heading = document.createElement('h3');
  heading.textContent = validation.ok
    ? (issues.length
      ? '검증 통과 · 확인 권장 사항 ' + issues.length + '개'
      : '검증을 통과했습니다.')
    : '검증 오류 ' + issues.length + '개';
  panel.appendChild(heading);
  var rehearsal = validation.rehearsal || [];
  if (validation.ok && rehearsal.length) {
    var rehearsalSummary = document.createElement('p');
    rehearsalSummary.textContent =
      '실행 흐름 ' + rehearsal.length + '개 단계를 리허설로 확인했습니다.';
    panel.appendChild(rehearsalSummary);
  }
  if (issues.length) {
    var list = document.createElement('ul');
    issues.forEach(function (issue) {
      var item = document.createElement('li');
      item.textContent = String(issue);
      list.appendChild(item);
    });
    panel.appendChild(list);
  }
  panel.hidden = false;
}

var VALIDATION_NODE_LABELS = {};
QUESTIONS.forEach(function (question) {
  if (
    question.node_id && question.node_label
    && !VALIDATION_NODE_LABELS[question.node_id]
  ) {
    VALIDATION_NODE_LABELS[question.node_id] = question.node_label;
  }
});

function presentValidationIssue(issue) {
  var text = String(issue);
  var match = /^\\[([^\\]]+)\\]\\s*/.exec(text);
  if (!match || !VALIDATION_NODE_LABELS[match[1]]) return text;
  return VALIDATION_NODE_LABELS[match[1]]
    + ' — ' + text.slice(match[0].length);
}

function visibleValidationWarnings(validation) {
  return (validation.warnings || []).filter(function (warning) {
    return String(warning).indexOf('재작업 순환 경로가 있습니다') !== 0;
  }).map(presentValidationIssue);
}

function finishValidatedSubmission(body, message, button) {
  var validation = body.validation || {
    ok: false,
    errors: ['검증 결과를 확인하지 못했습니다. Code Assistant에 수정을 요청해 주세요.'],
    warnings: []
  };
  renderValidationResult(validation);
  if (!validation.ok) {
    if (button) button.disabled = false;
    if (message) {
      message.textContent =
        '저장은 완료됐지만 검증 오류가 있습니다. 아래 내용을 확인한 뒤 Code Assistant에 수정을 요청해 주세요.';
    }
    return;
  }
  var warningCount = visibleValidationWarnings(validation).length;
  var warningText = warningCount
    ? ' 확인 권장 사항 ' + warningCount + '개가 있습니다.'
    : '';
  if (CONNECTED.completion_url) {
    if (message) {
      message.textContent =
        '저장과 검증이 완료되었습니다.' + warningText
        + ' 아래 검증 내역을 확인한 뒤 대시보드로 돌아가세요.';
    }
    var panel = document.getElementById('validation-result');
    var returnButton = document.createElement('button');
    returnButton.type = 'button';
    returnButton.id = 'return-dashboard';
    returnButton.textContent = '대시보드로 돌아가기';
    returnButton.addEventListener('click', function () {
      window.location.replace(CONNECTED.completion_url);
    });
    if (panel) {
      panel.appendChild(returnButton);
      panel.hidden = false;
    }
    return;
  }
  if (message) {
    message.textContent =
      '상세 설정 저장과 검증이 완료되었습니다.' + warningText
      + ' 이 창을 닫아도 됩니다.';
  }
}

function copyResult() {
  var ta = document.getElementById('result-json');
  if (!ta) return;
  var done = function () {
    document.getElementById('copy-msg').textContent = '복사되었습니다 — 채팅에 붙여넣어 주세요.';
  };
  var fallback = function () {
    ta.focus(); ta.select();
    try { if (document.execCommand('copy')) { done(); return; } } catch (err) {}
    document.getElementById('copy-msg').textContent =
      '자동 복사에 실패했습니다 — 위 텍스트를 클릭해 Ctrl+A, Ctrl+C로 복사해 주세요.';
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(ta.value).then(done, fallback);
  } else { fallback(); }
}

var copyButton = document.getElementById('copy');
if (copyButton) copyButton.addEventListener('click', copyResult);

var activityLastSentAt = 0;
var activitySendTimer = null;
function sendCreatorActivity() {
  activitySendTimer = null;
  if (!CONNECTED || !CONNECTED.activity_url || typeof fetch !== 'function') return;
  activityLastSentAt = Date.now();
  fetch(CONNECTED.activity_url, {
    method: 'POST',
    headers: { 'X-Ops-CSRF': CONNECTED.csrf_token },
    credentials: 'same-origin',
    keepalive: true
  }).catch(function () {
    // Submission reports connection failures. Activity updates are best effort.
  });
}
function noteCreatorUserActivity(event) {
  if (!CONNECTED || !CONNECTED.activity_url) return;
  if (event && event.isTrusted === false) return;
  var wait = Math.max(0, 1000 - (Date.now() - activityLastSentAt));
  if (wait === 0) {
    sendCreatorActivity();
  } else if (activitySendTimer === null) {
    activitySendTimer = window.setTimeout(sendCreatorActivity, wait);
  }
}
['input', 'change', 'keydown', 'pointerdown', 'touchstart', 'wheel'].forEach(
  function (eventName) {
    document.addEventListener(eventName, noteCreatorUserActivity, true);
  });

refreshProgress();
"""


_LABEL_RE = re.compile(r"^\[([^\]]+)\]\s*(.*)$")


def _form_nodes(task, questions, include_all=False):
    """화면에 표시할 노드와 실제 질문을 분리해 실행 순서대로 묶는다."""
    questions_by_node = {}
    question_order = []
    for question in questions:
        node_id = question.get("node_id")
        if node_id not in questions_by_node:
            questions_by_node[node_id] = []
            question_order.append(node_id)
        questions_by_node[node_id].append(question)

    items, seen = [], set()
    if include_all:
        node_no = 0
        for node in task.get("nodes") or []:
            if not isinstance(node, dict) or node.get("type") == "if":
                continue
            node_no += 1
            node_id = node.get("id")
            node_questions = questions_by_node.get(node_id, [])
            if node_questions:
                label = node_questions[0]["node_label"]
                shown_no = node_questions[0]["node_no"]
            else:
                kind = ACTION_TYPE_KO.get(node.get("action_type"))
                name = node.get("name") or node_id or ""
                label = f"[{kind}] {name}" if kind else name
                shown_no = node_no
            items.append({
                "node_id": node_id,
                "node_no": shown_no,
                "node_label": label,
                "questions": node_questions,
            })
            seen.add(node_id)

    for node_id in question_order:
        if node_id in seen:
            continue
        node_questions = questions_by_node[node_id]
        items.append({
            "node_id": node_id,
            "node_no": node_questions[0]["node_no"],
            "node_label": node_questions[0]["node_label"],
            "questions": node_questions,
        })
    return items


def _rail_html(form_nodes):
    """좌측 워크플로우 레일 — 노드(=섹션)를 실행 순서대로, 노드 번호 표기.
    도트는 소속 질문이 다 채워지면 JS가 accent로 채우고(data-nos가 그 매핑),
    노드별 답변 수("2/3")는 번호 있는 질문(data-tracked)만 센다 — 고급 옵션은
    기본값이 있어 세면 시작부터 부푼다."""
    items = []
    for node in form_nodes:
        node_no = node["node_no"]
        label = node["node_label"]
        questions = node["questions"]
        nos = [question["no"] for question in questions]
        tracked = [
            question["no"] for question in questions if question.get("disp")
        ]
        m = _LABEL_RE.match(label)
        badge, name = (m.group(1), m.group(2)) if m else ("", label)
        items.append(
            f'<a class="rail-item" href="#node-{node_no}" data-nos="{",".join(map(str, nos))}"'
            f' data-tracked="{",".join(map(str, tracked))}">'
            '<span class="dot"></span><span>'
            f'<span class="badge">{_esc(badge)}</span>'
            f'<span class="rail-name">{node_no}. {_esc(name)}'
            '<span class="rail-count"></span></span></span></a>')
    return "".join(items)


_ADV_QTYPES = ("custom_logic_opt",)


def _embedded_questions(questions, connected, agent_draft_mode=False):
    """브라우저 JS에 필요한 최소 질문 메타데이터를 만든다.

    서버 연결 AI 초안 위젯은 결정적 suggestion이나 생성 근거용 필드를
    사용하지 않는다. 해당 값이 페이지 소스에 다시 노출되지 않도록 필요한 계약
    필드만 남긴다.
    """
    if connected is None:
        return questions
    embedded = []
    for question in questions:
        if (
            not agent_draft_mode
            or question.get("qtype") not in _AGENT_DRAFT_QTYPES
        ):
            if question.get("qtype") == "labels_fixed":
                item = dict(question)
                item["design_locked"] = True
                embedded.append(item)
            else:
                embedded.append(question)
            continue
        item = {
            key: question.get(key)
            for key in (
                "no", "disp", "node_id", "node_no", "node_label",
                "qtype", "target", "system",
                "agent_draft_id", "agent_draft_revision",
                "agent_draft_pending", "agent_draft_ready",
                "revision", "current_mode", "current_revision",
            )
            if question.get(key) is not None
        }
        # 키가 있어야 JS가 Connected 전용 apply 계약과 비동기 갱신으로 분기한다.
        # Agent 결과가 없으면 overlay가 넣은 결정적 기본 초안을 사용한다.
        item["agent_draft"] = question.get("agent_draft") or ""
        embedded.append(item)
    return embedded


def build_form_html(task, questions, previous_task_catalog=None, connected=None,
                    payload_type="ops_author_answers", form_title=None,
                    agent_draft_mode=None, mcp_statuses=None):
    """자기완결 정적 HTML — 외부 리소스 0, 인라인 CSS/JS, file://로 열린다.

    섹션 헤더는 노드 번호+타입 배지+이름, 질문 번호는 disp('3-2').
    커스텀 로직/스킬은 번호 없는 '고급 옵션' 접이식 영역으로 — 노드당 질문 수를
    부풀리지 않는다(실사용 피드백)."""
    tname = task.get("task_name") or task.get("task_id", "")
    form_title = form_title or "초안 생성 질문지"
    if agent_draft_mode is None:
        agent_draft_mode = connected is not None
    node_test_enabled = bool(
        connected is not None and connected.get("node_test_url"))
    nodes_by_id = {
        node.get("id"): node
        for node in task.get("nodes") or []
        if isinstance(node, dict) and node.get("id")
    }
    form_nodes = _form_nodes(
        task,
        questions,
        include_all=payload_type == "ops_author_answers",
    )
    body = []
    for form_node in form_nodes:
        node_id = form_node["node_id"]
        node_no = form_node["node_no"]
        node_questions = form_node["questions"]
        m = _LABEL_RE.match(form_node["node_label"])
        badge, name = (
            (m.group(1), m.group(2))
            if m else ("", form_node["node_label"])
        )
        badge_html = (
            f'<span class="type-badge">{_esc(badge)}</span>' if badge else ""
        )
        node_test_html = ""
        reference_attr = ""
        if node_test_enabled:
            panel_id = f"node-test-panel-{node_no}"
            target_node = nodes_by_id.get(node_id) or {}
            if target_node.get("action_type") == "decision":
                reference_attr = ' data-node-test-reference="true"'
            node_test_html = (
                f'<button type="button" class="node-test-button" '
                f'data-node-id="{_esc(node_id)}" '
                f'aria-controls="{_esc(panel_id)}" aria-expanded="false">'
                '이 노드 테스트</button></h2>'
                f'<div id="{_esc(panel_id)}" class="node-test-panel" '
                f'data-node-id="{_esc(node_id)}" hidden '
                'aria-live="polite" aria-atomic="false">'
                '<p class="node-test-status"></p>'
                '<div class="node-test-detail"></div></div>'
            )
        else:
            node_test_html = "</h2>"
        has_questions = "true" if node_questions else "false"
        body.append(
            f'<section class="node" id="node-{node_no}"'
            f' data-node-id="{_esc(node_id)}"'
            f' data-has-questions="{has_questions}"{reference_attr}>'
            f'<h2><span class="node-no">{node_no}</span>'
            f'{badge_html}<span class="node-name">{_esc(name)}</span>'
            f'{node_test_html}'
        )
        if not node_questions:
            body.append(
                '<p class="node-no-questions">'
                '추가로 입력할 상세 설정이 없습니다.</p>'
            )
        adv_open = False
        for q in node_questions:
            if q["qtype"] in _ADV_QTYPES and not adv_open:
                body.append(
                    '<details class="advanced"><summary>⚙ 고급 옵션 — 표준 방식으로 '
                    '표현이 안 되는 노드만 (커스텀 로직)</summary>'
                )
                adv_open = True
            num = f'{q["disp"]}. ' if q.get("disp") else ""
            widget_html = _widget(
                q,
                connected=connected is not None,
                agent_draft_mode=agent_draft_mode,
                draft_generation_enabled=bool(
                    connected and connected.get("draft_generate_url")),
            )
            # 질문 행은 라벨-컨트롤 2컬럼 그리드(≥960px) — fieldset 자체를 그리드
            # 컨테이너로 쓰면 legend 배치가 브라우저마다 어긋나므로 내부 래퍼로 푼다
            body.append(
                f'<fieldset class="q {q["qtype"]}" data-no="{q["no"]}" '
                f'data-node-id="{_esc(q["node_id"])}" '
                f'data-node-no="{q["node_no"]}" '
                f'data-node-name="{_esc(name)}">'
                f'<div class="q-grid"><div class="q-label">'
                f'{num}{_legend(q)}</div>'
                f'<div class="q-body">{widget_html}'
                '</div></div></fieldset>'
            )
        if adv_open:
            body.append("</details>")
        body.append("</section>")
    # </script> 문자열이 임베드 JSON에 들어 있으면 script 블록이 조기 종료된다
    meta = json.dumps(
        _embedded_questions(questions, connected, agent_draft_mode),
        ensure_ascii=False,
    ).replace("</", "<\\/")
    previous_meta = json.dumps(
        previous_task_catalog if previous_task_catalog is not None else {"tasks": []},
        ensure_ascii=False,
    ).replace("</", "<\\/")
    task_id_meta = json.dumps(
        task.get("task_id", ""), ensure_ascii=False).replace("</", "<\\/")
    payload_type_meta = json.dumps(
        payload_type, ensure_ascii=False).replace("</", "<\\/")
    connected_meta = json.dumps(
        None if connected is None else {
            "submit_url": connected["submit_url"],
            "csrf_token": connected["csrf_token"],
            **(
                {"activity_url": connected["activity_url"]}
                if connected.get("activity_url") else {}
            ),
            **(
                {
                    "state_url": connected["state_url"],
                    "view_generation": int(
                        connected.get("view_generation") or 0),
                }
                if connected.get("state_url") else {}
            ),
            **(
                {"draft_generate_url": connected["draft_generate_url"]}
                if connected.get("draft_generate_url") else {}
            ),
            **(
                {"draft_generation_state": connected["draft_generation_state"]}
                if connected.get("draft_generation_state") else {}
            ),
            **(
                {"draft_progress": connected["draft_progress"]}
                if connected.get("draft_progress") else {}
            ),
            **(
                {"draft_updates": connected["draft_updates"]}
                if connected.get("draft_updates") else {}
            ),
            **(
                {"draft_requests": connected["draft_requests"]}
                if connected.get("draft_requests") else {}
            ),
            **(
                {"node_test_url": connected["node_test_url"]}
                if connected.get("node_test_url") else {}
            ),
            **(
                {"node_test_state_url": connected["node_test_state_url"]}
                if connected.get("node_test_state_url") else {}
            ),
            **(
                {"completion_url": connected["completion_url"]}
                if connected.get("completion_url") else {}
            ),
            **(
                {
                    "automatic_agent_processing": True,
                    "assistant_watch": (
                        connected.get("assistant_watch") or {
                            "connected": False,
                            "state": "disconnected",
                            "domain": None,
                        }
                    ),
                    **(
                        {
                            "assistant_request_prompt": (
                                connected["assistant_request_prompt"])
                        }
                        if connected.get("assistant_request_prompt") else {}
                    ),
                }
                if connected.get("automatic_agent_processing") else {}
            ),
        },
        ensure_ascii=False,
    ).replace("</", "<\\/")
    dependency_meta = json.dumps(
        _node_test_dependencies(task), ensure_ascii=False,
    ).replace("</", "<\\/")
    consts = (f"var TASK_ID = {task_id_meta};\n"
              f"var PAYLOAD_TYPE = {payload_type_meta};\n"
              f"var CONNECTED = {connected_meta};\n"
              f"var NODE_TEST_DEPENDENCIES = {dependency_meta};\n")
    numbered = sum(1 for q in questions if q.get("disp"))
    show_detail_guide = payload_type != "ops_author_io_answers"
    mcp_panel = (
        _mcp_status_panel(mcp_statuses)
        if _SHOW_MCP_STATUS_PANEL
        and connected is not None
        and payload_type == "ops_author_answers"
        and mcp_statuses is not None
        else ""
    )
    has_decision_drafts = any(
        question.get("qtype") == "decision_prompt"
        and question.get("agent_draft_id")
        for question in questions
    )
    ai_draft_panel = (
        '<section class="ai-draft-panel" aria-labelledby="ai-draft-panel-title">'
        '<p><strong id="ai-draft-panel-title">판단 노드 프롬프트를 AI로 보완</strong><br>'
        '원할 때만 실행합니다. 현재 노드 구성과 입출력을 바탕으로 판단 노드의 '
        '프롬프트 초안을 한 번에 고도화합니다.</p>'
        '<button id="ai-draft-generate" type="button">판단 노드 AI 초안 갱신</button>'
        '<span id="ai-draft-progress" class="ai-draft-progress" '
        'aria-live="polite"></span></section>\n'
        if _SHOW_DECISION_DRAFT_REFRESH
        and connected is not None
        and connected.get("draft_generate_url")
        and has_decision_drafts
        else ""
    )
    ai_draft_dialog = (
        '<dialog id="ai-draft-confirm" class="detail-guide-dialog" '
        'aria-labelledby="ai-draft-confirm-title">'
        '<div class="dialog-head"><strong id="ai-draft-confirm-title">'
        '판단 노드 AI 초안을 갱신할까요?</strong>'
        '<button type="button" class="ai-draft-cancel" aria-label="닫기">×</button></div>'
        '<div class="detail-guide-body">'
        '<p>현재 노드 구성과 입출력을 기반으로 모든 판단 노드의 프롬프트 초안을 '
        'AI가 고도화합니다.</p>'
        '<div class="detail-guide-callout"><strong>AI 결과가 초안에 자동 반영됩니다.</strong><br>'
        '생성 도중에도 다른 상세 설정은 계속 편집할 수 있지만, 요청한 초안은 결과가 '
        '도착할 때까지 직접 수정할 수 없습니다.</div></div>'
        '<div class="dialog-actions"><span class="grow"></span>'
        '<button type="button" class="ai-draft-cancel">취소</button>'
        '<button type="button" class="ai-draft-confirm">확인</button></div></dialog>\n'
        if ai_draft_panel else ""
    )
    guide_button = (
        '<button id="detail-guide-open" type="button" aria-haspopup="dialog" '
        'aria-controls="detail-guide">가이드 보기</button>\n'
        if show_detail_guide else ""
    )
    guide_dialog = (
        '<dialog id="detail-guide" class="detail-guide-dialog" '
        'aria-labelledby="detail-guide-title">\n'
        '<div class="dialog-head"><strong id="detail-guide-title">상세 설정 가이드</strong>'
        '<button type="button" class="detail-guide-close" aria-label="닫기">×</button></div>\n'
        '<div class="detail-guide-body">'
        '<p>노드가 실제로 작업하는 방식을 선택하면 필요한 설정만 표시됩니다.</p>'
        '<dl class="detail-guide-list">'
        '<div><dt>API</dt><dd>HTTP 요청으로 자동 처리합니다. API 주소와 요청 방식이 '
        '필요합니다.</dd></div>'
        '<div><dt>배치파일</dt><dd>실행 PC의 스크립트를 실행합니다. 실행 파일 경로가 '
        '필요합니다.</dd></div>'
        '<div><dt>MCP</dt><dd>Code Assistant에 연결된 도구로 처리합니다. MCP 서버 '
        '이름과 지시문이 필요합니다.</dd></div>'
        '<div><dt>수동</dt><dd>실행 중 사용자에게 작업 방법과 입력할 항목을 '
        '안내합니다.</dd></div>'
        '</dl>'
        '<div class="detail-guide-callout"><strong>필수 정보를 모른다면</strong><br>'
        'API 주소·실행 파일 경로·MCP 서버 이름은 임의로 정할 수 없습니다. 수동 방식을 '
        '선택하거나 시스템 담당자에게 확인해 주세요.</div>'
        '</div>'
        '<div class="dialog-actions"><span class="grow"></span>'
        '<button type="button" class="detail-guide-close">닫기</button></div>\n'
        '</dialog>\n'
        if show_detail_guide else ""
    )
    if connected is None:
        intro = (
            '<p class="intro">각 노드가 실제로 작업하는 방식을 확인합니다. 실행 방식을 '
            '선택한 뒤 필요한 정보만 입력해 주세요. 추천 초안은 그대로 사용하거나 '
            '수정할 수 있습니다.</p>\n')
        result = (
            '<section id="result" hidden>\n<p id="warn"></p>\n'
            "<p>결과가 클립보드에 복사됩니다. 채팅에 그대로 붙여넣어 주세요.</p>\n"
            '<textarea id="result-json" readonly></textarea>\n'
            '<button id="copy" type="button" aria-label="클립보드 복사">복사</button> '
            '<span id="copy-msg"></span>\n'
            "</section>\n")
    elif payload_type == "ops_author_io_answers":
        intro = (
            '<p class="intro">노드별 입력·출력 이름과 값이 전달되는 경로를 확인해 주세요. '
            "필요하면 항목을 추가·수정·삭제할 수 있습니다.</p>\n")
        result = (
            '<section id="result" hidden aria-live="polite">\n'
            '<p id="warn"></p><p id="submit-msg"></p>\n'
            '<div id="validation-result" hidden></div>\n'
            "</section>\n")
    else:
        intro = (
            '<p class="intro">각 노드가 실제로 작업하는 방식을 확인합니다. 실행 방식을 '
            '선택한 뒤 필요한 정보만 입력해 주세요. 표시된 초안은 그대로 사용하거나 '
            '수정할 수 있습니다.</p>\n')
        result = (
            '<section id="result" hidden aria-live="polite">\n'
            '<p id="warn"></p><p id="submit-msg"></p>\n'
            '<div id="validation-result" hidden></div>\n'
            "</section>\n")
    return (
        '<!doctype html>\n<html lang="ko">\n<head>\n<meta charset="utf-8">\n'
        # 모바일 브라우저에서도 CSS 픽셀 기준 반응형 레이아웃을 사용한다.
        '<meta name="viewport" content="width=device-width,initial-scale=1">\n'
        f"<title>【{_esc(form_title)}】 {_esc(tname)}</title>\n"
        f"<style>{_CSS}</style>\n</head>\n<body>\n"
        '<header id="topbar">\n'
        f'<div><span class="eyebrow">{_esc(form_title)}</span><h1>{_esc(tname)}</h1>'
        f'<span class="meta">{_esc(task.get("task_id", ""))} · 질문 {numbered}개</span></div>\n'
        '<div class="grow"></div>\n'
        f'{guide_button}'
        '<span id="ai-draft-submit-lock" class="ai-draft-submit-lock" '
        'aria-live="polite" hidden></span>\n'
        f'<span id="progress">답변 0/{numbered}</span>\n'
        '<button id="confirm" type="button">확정</button>\n'
        "</header>\n"
        '<div class="layout">\n'
        f'<nav id="rail">{_rail_html(form_nodes)}</nav>\n'
        "<main>\n"
        + intro +
        ai_draft_panel +
        mcp_panel +
        '<form id="f" onsubmit="return false">\n'
        + "\n".join(body) +
        "\n</form>\n<footer>\n"
        + result +
        "</footer>\n</main>\n</div>\n"
        + guide_dialog +
        ai_draft_dialog +
        '<dialog id="previous-task-picker" class="previous-task-picker" '
        'aria-labelledby="previous-picker-title">\n'
        '<div class="previous-picker-head">'
        '<strong id="previous-picker-title">이전 task에서 받아오기</strong>'
        '<span class="previous-picker-help">마우스를 올리거나 클릭해 탐색하고, '
        '방향키와 Enter로도 선택할 수 있습니다.</span>'
        '<button type="button" class="previous-picker-close" aria-label="닫기">×</button>'
        '</div>\n'
        '<div class="previous-picker-grid">\n'
        '<section class="previous-picker-pane" aria-label="이전 task">'
        '<h3 id="previous-picker-tasks-label">1. 이전 task</h3>'
        '<div id="previous-picker-tasks" class="previous-picker-list" '
        'role="listbox" aria-labelledby="previous-picker-tasks-label"></div></section>\n'
        '<section class="previous-picker-pane" aria-label="노드">'
        '<h3 id="previous-picker-nodes-label">2. 노드</h3>'
        '<div id="previous-picker-nodes" class="previous-picker-list" '
        'role="listbox" aria-labelledby="previous-picker-nodes-label"></div></section>\n'
        '<section class="previous-picker-pane" aria-label="출력값">'
        '<h3 id="previous-picker-outputs-label">3. 출력값</h3>'
        '<div id="previous-picker-outputs" class="previous-picker-list" '
        'role="listbox" aria-labelledby="previous-picker-outputs-label"></div></section>\n'
        '</div>\n'
        '<div class="previous-picker-actions">'
        '<span id="previous-picker-path" aria-live="polite"></span>'
        '<span class="grow"></span>'
        '<button type="button" class="previous-picker-cancel">취소</button>'
        '</div>\n</dialog>\n'
        f'<script type="application/json" id="questions">{meta}</script>\n'
        f'<script type="application/json" id="previous-task-catalog">{previous_meta}</script>\n'
        f"<script>\n{consts}{_JS}</script>\n</body>\n</html>\n")


def write_form(task, task_json_path, questions, previous_task_catalog=None):
    """폼 HTML을 task JSON 옆에 저장 — 파생 일회용 파일이라 무경고 덮어쓰기."""
    path = form_path(task_json_path, task)
    d = os.path.dirname(path)
    if d:
        os.makedirs(d, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(build_form_html(
            task, questions, previous_task_catalog=previous_task_catalog))
    return path
