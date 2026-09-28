# -*- coding: utf-8 -*-
"""의사결정/판단 — AI 에이전트가 prompt와 입력으로 판단한다.

- 분기 판단형(labels 있음): labels 중 하나를 판정 → llm_decision 정지.
  라벨 검증(집합 밖 라벨 거부)은 엔진의 resume 단계에서 수행된다.
- 판단 결과 산출형(labels 없음): 라벨 없이 출력 필드만 생성 → llm_decision_output 정지.

긴 프롬프트는 prompt_file(파일 관리), 과거 데이터는 references(파일/폴더 경로
배열)로 저작할 수 있다 – 채팅으로 긴 프롬프트를 받기 부적절하다는 실사용 피드백.
참고 자료는 목록만 프롬프트에 싣고 AI 에이전트가 판단 전에 직접 읽는다(내용 인라인이
아니므로 큰 폴더·비텍스트 파일도 동작).
"""
import os

from . import common

_REF_CAP = 100  # 폴더 하나가 프롬프트를 삼키지 않게 나열 상한


def _local_path(path, project_root=None):
    """task JSON의 프로젝트 상대경로를 실행 PC의 실제 경로로 바꾼다."""
    if not path or os.path.isabs(path) or not project_root:
        return path
    return os.path.abspath(os.path.join(project_root, path))


def _reference_lines(paths, exclude=None, project_root=None, ctx=None,
                     allow_missing=None):
    """참고 파일과 폴더를 나열해 ``(설명 목록, 오류)``로 반환한다.

    exclude(판단 기준 파일)는 목록에서 뺀다 – 판단 폴더(decisions/<이름>/)가
    main_prompt.md와 참조자료를 함께 담으므로 프롬프트 파일이
    참조자료로 중복 나열되지 않게 한다."""
    exclude = _local_path(exclude, project_root)
    skip = os.path.normcase(os.path.abspath(exclude)) if exclude else None
    allowed_missing = {
        os.path.normcase(os.path.realpath(_local_path(path, project_root)))
        for path in (allow_missing or [])
        if path
    }
    lines = []
    for stored_path in paths:
        p = _local_path(stored_path, project_root)
        normalized = os.path.normcase(os.path.realpath(p))
        if normalized in allowed_missing and not os.path.exists(p):
            # 저장 전 Creator 노드 테스트에서는 표준 판단 폴더와 main_prompt.md를
            # 정본에 만들지 않는다. prompt_file의 정확한 부모 폴더만 쓰기 경로
            # 정책으로 검증한 뒤 "아직 참고자료 없음"으로 취급한다.
            _checked, auth_error = common.authorize_task_path(ctx, p, "write")
            if auth_error:
                return None, auth_error
            continue
        p, auth_error = common.authorize_task_path(ctx, p, "read")
        if auth_error:
            return None, auth_error
        if os.path.isfile(p):
            if skip and os.path.normcase(os.path.abspath(p)) == skip:
                continue
            lines.append(f"- {p}")
        elif os.path.isdir(p):
            found = []
            for root, _dirs, files in os.walk(p):
                for f in files:
                    full = os.path.join(root, f)
                    full, auth_error = common.authorize_task_path(ctx, full, "read")
                    if auth_error:
                        return None, auth_error
                    if skip and os.path.normcase(os.path.abspath(full)) == skip:
                        continue
                    found.append(full)
            if not found:
                lines.append(f"- {p} (폴더 – 참조자료 없음)")
            else:
                lines.extend(f"- {f}" for f in found[:_REF_CAP])
                if len(found) > _REF_CAP:
                    lines.append(f"  … 외 {len(found) - _REF_CAP}개 ({p})")
        else:
            return None, (f"참고 자료 경로를 찾을 수 없습니다: {p} – "
                          "저작 단계의 references 값을 확인하세요")
    return lines, None


def _resolve_prompt(node, project_root=None, ctx=None):
    """prompt_file을 우선해 판단 지시문과 오류를 반환한다."""
    # Creator의 노드 테스트는 저장 전 판단 기준을 정본 prompt_file에 쓰지 않고
    # 격리 candidate에만 싣는다. 일반 task에는 생성되지 않는 내부 키다.
    if (ctx or {}).get("node_test") and "_node_test_prompt" in node:
        prompt = node.get("_node_test_prompt")
        if not isinstance(prompt, str) or not prompt.strip():
            return None, "노드 테스트의 판단 기준이 비어 있습니다"
        return prompt.strip(), None
    stored_path = node.get("prompt_file")
    if not stored_path:
        return node.get("prompt") or "아래 입력을 검토해 판단하라.", None
    prompt_file = _local_path(stored_path, project_root)
    prompt_file, auth_error = common.authorize_task_path(ctx, prompt_file, "read")
    if auth_error:
        return None, auth_error
    if not os.path.isfile(prompt_file):
        return None, (f"판단 프롬프트 파일을 찾을 수 없습니다: {prompt_file} – "
                      "저작 단계의 prompt_file 값을 확인하세요")
    try:
        with open(prompt_file, encoding="utf-8") as f:
            prompt = f.read().strip()
    except UnicodeDecodeError:
        return None, f"판단 프롬프트 파일을 텍스트로 읽을 수 없습니다: {prompt_file}"
    except OSError as exc:
        return None, f"판단 프롬프트 파일을 읽을 수 없습니다: {prompt_file} ({exc})"
    if not prompt:
        return None, f"판단 프롬프트 파일이 비어 있습니다: {prompt_file}"
    return prompt, None


def handle(node, cfg, inputs, ctx, provided=None):
    labels = [x for x in (node.get("labels") or []) if x]
    project_root = ctx.get("project_root")
    prompt, err = _resolve_prompt(node, project_root, ctx)
    if err:
        return {"error": err}
    prompt += "\n\n[입력]\n" + common.input_lines(inputs)
    if (ctx or {}).get("node_test"):
        reference_text = node.get("_node_test_reference_text")
        if isinstance(reference_text, str) and reference_text.strip():
            prompt += (
                "\n\n[테스트 전용 참고자료]\n"
                + reference_text.strip()
            )
    refs = node.get("references") or []
    if refs:
        allow_missing = []
        if (ctx or {}).get("node_test") and "_node_test_prompt" in node:
            prompt_file = _local_path(node.get("prompt_file"), project_root)
            if prompt_file:
                allow_missing.append(os.path.dirname(prompt_file))
        lines, err = _reference_lines(
            refs,
            exclude=node.get("prompt_file"),
            project_root=project_root,
            ctx=ctx,
            allow_missing=allow_missing,
        )
        if err:
            return {"error": err}
        if lines:
            prompt += ("\n\n[참고 자료] 판단 전에 아래 파일을 직접 읽고 반영하라:\n"
                       + "\n".join(lines))
            original_references = node.get("_snapshot_original_references") or []
            if original_references:
                original_lines, _original_error = _reference_lines(
                    original_references,
                    project_root=project_root,
                    ctx=ctx,
                )
                shown = original_lines or [
                    _local_path(path, project_root)
                    for path in original_references
                ]
                prompt += (
                    "\n[원본 Task 경로(진단용, 읽기는 위 스냅샷)]\n"
                    + "\n".join(shown)
                )
    fields = common.fields_from_outputs(node)
    if labels:
        if fields:
            prompt += ("\n\n판단과 함께 다음 출력 필드도 채워라(후속 노드가 사용한다): "
                       + ", ".join(f["name"] for f in fields))
        prompt += "\n\n반드시 다음 라벨 중 하나로만 답하라: " + ", ".join(labels)
        return common.pause("llm_decision", prompt, fields)
    # 산출형 – 라벨 강제 없이 출력 필드가 판단 결과의 유일한 전달 통로다
    if not fields:
        return {"error": "이 판단 노드에는 labels도 outputs도 없습니다 – 판단 결과를 담을 "
                         "출력 필드를 선언해야 합니다. /e2e-agent-creator 수정 모드로 고쳐 주세요."}
    prompt += ("\n\n판단 결과를 다음 출력 필드에 채워라(후속 노드가 그대로 사용한다): "
               + ", ".join(f["name"] for f in fields))
    return common.pause("llm_decision_output", prompt, fields)
