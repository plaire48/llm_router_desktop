# -*- coding: utf-8 -*-
"""알림 송신 — ba_entity(BA DataEntity 내장), API 또는 수동 방식."""
import os

from . import common


def _render_message(cfg, inputs):
    msg = cfg.get("message", "")
    try:
        return msg.format(**inputs), None
    except (KeyError, IndexError, ValueError) as exc:
        return None, f"알림 메시지 템플릿의 값을 찾을 수 없습니다: {exc}"


def handle(node, cfg, inputs, ctx, provided=None):
    channel = cfg.get("channel", "manual")
    rendered_message, render_error = _render_message(cfg, inputs)
    if render_error:
        return {"error": render_error}

    if channel == "manual":
        recipient = cfg.get("recipient", "수신자")
        prompt = (f"다음 내용을 {recipient}에게 전달해 주세요.\n\n[전달할 내용]\n"
                  + (rendered_message or common.input_lines(inputs)))
        fields = common.fields_from_outputs(node)
        if fields:
            prompt += "\n\n전달을 완료하셨으면 아래 항목의 결과를 알려 주세요."
            if common.attach_suggestions(fields, inputs):
                prompt += "\n(위 [전달할 내용]과 같은 값이면 '그대로'라고만 답하셔도 됩니다.)"
            return common.pause("ask_user", prompt, fields)
        prompt += "\n\n전달을 완료하셨나요?"
        return common.pause("confirm", prompt, slot="confirm_done")

    if channel == "api":
        return common.http_exec(cfg.get("integration", {}), ctx)

    if channel == "ba_entity":
        entity = cfg.get("entity")
        if not entity:
            return {"error": "notify_send(ba_entity) 노드에 entity가 없습니다"}
        base = cfg.get("base_url") or os.getenv("BA_BASE_URL")
        if not base:
            return {"error": "BA DataEntity 주소가 없습니다 – 노드의 base_url 또는 환경변수 BA_BASE_URL을 설정해 주세요"}
        integration = {
            "endpoint": base.rstrip("/") + f"/asset/api/v1/entities/{entity}/data",
            "http_method": "POST",
            "auth": cfg.get("auth"),
            "request": {"message": rendered_message, "data": inputs},
            "response_fields": {},
        }
        return common.http_exec(integration, ctx)

    return {"error": f"알 수 없는 notify_send channel: {channel}"}
