# -*- coding: utf-8 -*-
"""시스템 실행 – api: HTTP 호출 / command: 로컬 명령 / mcp: AI 에이전트의 MCP 도구 위임 / manual: 데이터를 주고 직접 입력 요청

manual일 때:
- 출력 필드가 있으면 ask_user – 값을 받아야 하므로.
- 출력 필드가 없으면 confirm – 완료 여부만 확인한다. "안 했는데 완료된 척"을 막기 위해
  confirmed=false면 엔진이 중단 처리한다 (slot: confirm_done).
"""
from . import common


def handle(node, cfg, inputs, ctx, provided=None):
    method = cfg.get("method", "manual")
    if method == "api":
        return common.http_exec(cfg.get("integration", {}), ctx)
    if method == "command":
        return common.command_exec(node, cfg, inputs, ctx)
    if method == "mcp":
        return common.mcp_pause(node, cfg, inputs, write=True)
    prompt = ("다음 데이터를 시스템에 직접 입력해 주세요.\n\n[입력할 데이터]\n"
              + common.input_lines(inputs))
    guide = cfg.get("manual_guide")
    if guide:
        prompt += "\n\n" + guide
    url, error = common.resolve_manual_url(cfg.get("manual_url"), inputs)
    if error:
        return {"error": error}
    if url:
        prompt += (f"\n\n[작업 화면] {url}\n"
                   "이 안내가 표시된 뒤 약 2초 후 브라우저에서 작업 화면을 엽니다.")
    fields = common.fields_from_outputs(node)
    if fields:
        prompt += "\n\n입력을 완료하셨으면 아래 항목의 결과를 알려 주세요."
        if common.attach_suggestions(fields, inputs):
            prompt += "\n(위 [입력할 데이터]와 같은 값이면 '그대로'라고만 답하셔도 됩니다.)"
        return common.pause("ask_user", prompt, fields, open_url=url)
    prompt += "\n\n입력을 완료하셨나요?"
    return common.pause("confirm", prompt, slot="confirm_done", open_url=url)
