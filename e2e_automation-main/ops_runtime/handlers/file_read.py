# -*- coding: utf-8 -*-
"""텍스트 파일을 읽어 첫 번째 출력 필드에 담는다.

경로가 정해지지 않았으면 폴더와 파일 힌트로 AI 검색을 요청할 수 있다. AI가 실제
파일 경로를 제출하면 엔진이 해당 파일을 직접 읽는다.
"""
import os

from . import common


def _read(node, path, ctx):
    path, err = common.authorize_task_path(ctx, path, "read")
    if err:
        return {"error": err}
    if not os.path.isfile(path):
        return {"error": f"파일을 찾을 수 없습니다: {path}"}
    try:
        with open(path, encoding="utf-8") as f:
            content = f.read()
    except UnicodeDecodeError:
        return {"error": f"텍스트로 읽을 수 없는 파일입니다: {path} – method: manual로 전환을 검토하세요"}
    except OSError as exc:
        return {"error": f"파일을 읽을 수 없습니다: {path} ({exc})"}
    outputs = node.get("outputs", [])
    out = {outputs[0]["id"]: content} if outputs else {}
    return {"output": out}


def handle(node, cfg, inputs, ctx, provided=None):
    if provided:
        # llm_find_file resume – AI 에이전트가 찾고 엔진이 실존 검증을 마친 경로
        return _read(node, provided, ctx)
    if cfg.get("method") == "manual":
        prompt = cfg.get("manual_guide") or "해당 문서의 내용을 복사해 붙여넣어 주세요."
        return common.pause("ask_user", prompt, common.fields_from_outputs(node))
    path_input = cfg.get("path_input")
    if path_input:
        path = inputs.get(path_input)
        if not isinstance(path, str) or not path.strip():
            return {"error": f"실행 시 파일 경로 입력 '{path_input}'이 비어 있습니다"}
        return _read(node, path.strip(), ctx)
    path = cfg.get("path")
    if not path:
        directory, hint = cfg.get("directory"), cfg.get("file_hint")
        if directory and hint:
            directory, err = common.authorize_task_path(ctx, directory, "read")
            if err:
                return {"error": err}
            if not os.path.isdir(directory):
                return {"error": f"폴더를 찾을 수 없습니다: {directory} – 저작 단계의 directory 값을 확인하세요"}
            hint = str(hint).format_map(common.SafeDict(inputs))
            prompt = ("아래 폴더에서 힌트에 해당하는 파일을 찾아 주세요.\n"
                      f"- 폴더: {directory}\n"
                      f"- 파일 힌트: {hint}\n"
                      f"참고 입력:\n{common.input_lines(inputs)}")
            return common.pause("llm_find_file", prompt)
        return {"error": "file_read 노드에 path가 없습니다 (저작 단계에서 path 또는 "
                         "directory+file_hint를 채워야 합니다)"}
    return _read(node, path, ctx)
