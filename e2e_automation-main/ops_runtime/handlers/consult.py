# -*- coding: utf-8 -*-
"""협의 — 지금 입력 / 다음에 재진행 / 미진행을 제공하는 사용자 작업.

미진행 선택지는 실사용 피드백 – 협의는 항상 하는 게 아닌데 '지금 입력'을 고른 뒤
"안 했음"이라고 다시 말해야 넘어갈 수 있었다."""
from . import common


def handle(node, cfg, inputs, ctx, provided=None):
    # 협의 대상은 별도 필드가 없다 – 노드 이름("고객 협의")이 담는다
    topic = cfg.get("topic") or node.get("name", "협의")
    prompt = (f"[협의 필요] 주제: {topic}\n\n"
              "어떻게 할까요?\n"
              "① 지금 입력 – 협의 결과를 바로 입력합니다\n"
              "② 다음에 재진행 – 여기서 멈추고, 다시 실행할 때 이 지점부터 이어집니다\n"
              "③ 미진행 – 협의 결과 없이 다음 단계로 넘어갑니다 (결과는 전부 '없음' 처리)")
    return common.pause("ask_user_deferrable", prompt, common.fields_from_outputs(node))
