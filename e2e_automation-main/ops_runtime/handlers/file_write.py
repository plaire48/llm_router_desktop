# -*- coding: utf-8 -*-
"""파일 변경 — template 채움 또는 generation_prompt(LLM 생성) 후 저장.

generation_prompt가 있으면 2단계: ① llm_generate 일시정지 → ② resume된 content로 저장.
엔진이 resume 시 provided=content 로 재호출한다.
"""
import os

from . import common


class _SafeDict(dict):
    def __missing__(self, key):
        return "{" + key + "}"


def handle(node, cfg, inputs, ctx, provided=None):
    path = cfg.get("path")
    if not path:
        return {"error": "file_write 노드에 path가 없습니다 (저작 단계에서 채워야 합니다)"}
    path, err = common.authorize_task_path(ctx, path, "write")
    if err:
        return {"error": err}

    if provided is not None:
        content = provided
    elif cfg.get("generation_prompt"):
        prompt = (cfg["generation_prompt"] + "\n\n[재료가 되는 입력]\n" + common.input_lines(inputs))
        return common.pause("llm_generate", prompt)
    elif cfg.get("template"):
        content = cfg["template"].format_map(_SafeDict(inputs))
    else:
        content = common.input_lines(inputs)

    try:
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
    except OSError as exc:
        return {"error": f"파일을 쓸 수 없습니다: {path} ({exc})"}
    outputs = node.get("outputs", [])
    out = {outputs[0]["id"]: path} if outputs else {}
    # 원문은 실행 엔진에만 넘긴다. 엔진이 고정 길이 미리보기로 줄여 run history에
    # 기록하므로 Dashboard가 이후 변경된 파일을 다시 읽을 필요가 없다.
    return {
        "output": out,
        "written_file": {"path": path, "content": content},
    }
