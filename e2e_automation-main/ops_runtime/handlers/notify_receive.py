# -*- coding: utf-8 -*-
"""알림 수신 – 자동 수신 없음(폴링 비목표). 지금 입력 / 다음에 재진행 / 미수신 처리
."""
from . import common


def handle(node, cfg, inputs, ctx, provided=None):
    guide = cfg.get("guide") or node.get("name", "알림")
    prompt = (f"[알림 수신 대기] {guide}\n\n"
              "어떻게 할까요?\n"
              "① 지금 입력 – 수신한 내용을 바로 입력합니다\n"
              "② 다음에 재진행 – 여기서 멈추고, 다시 실행할 때 이 지점부터 이어집니다\n"
              "③ 미수신 처리 – 수신 내용 없이 다음 단계로 넘어갑니다 (결과는 전부 '없음' 처리)")
    return common.pause("ask_user_deferrable", prompt, common.fields_from_outputs(node))
