# -*- coding: utf-8 -*-
"""Standalone Creator와 Code Assistant 사이의 AI 저작 초안 계약."""
from __future__ import annotations

import hashlib
import json
import re

from . import author_questions


_QTYPE_KIND = {
    "decision_prompt": "decision_prompt",
    "file_write_content": "generation_prompt",
}
_MAX_DRAFT_CHARS = 256 * 1024
_NODE_OUTPUT_SOURCE_RE = re.compile(
    r"^\$\.nodes\.([^.]+)\.output\.([^.]+)$")
_EXTERNAL_SOURCE_RE = re.compile(r"^\$\.inputs_from\.(.+)$")


def _digest(value, length=24):
    raw = json.dumps(
        value, ensure_ascii=False, sort_keys=True,
        separators=(",", ":"), default=str).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()[:length]


def _node_name(node, fallback="이름 없는 작업"):
    value = node.get("name") if isinstance(node, dict) else None
    if isinstance(value, str) and value.strip():
        return value
    if isinstance(node, dict) and node.get("type") == "if":
        return "분기"
    return fallback


def _clean_outputs(values):
    return [
        {
            key: item.get(key)
            for key in ("name", "field", "description")
            if item.get(key) is not None
        }
        for item in (values or [])
        if isinstance(item, dict)
    ]


def _semantic_inputs(task, values):
    """내부 source 경로를 AI가 복사할 수 없는 사람용 출처 정보로 바꾼다."""
    nodes = {
        node.get("id"): node
        for node in (task.get("nodes") or [])
        if isinstance(node, dict) and node.get("id")
    }
    roots = {
        item.get("name"): item
        for item in (task.get("inputs_from") or [])
        if isinstance(item, dict) and item.get("name")
    }
    result = []
    for item in values or []:
        if not isinstance(item, dict):
            continue
        semantic = {
            "field": item.get("field") or item.get("name") or "입력",
        }
        source = str(item.get("source") or "")
        node_match = _NODE_OUTPUT_SOURCE_RE.fullmatch(source)
        external_match = _EXTERNAL_SOURCE_RE.fullmatch(source)
        if node_match:
            source_node = nodes.get(node_match.group(1)) or {}
            semantic["source_node_name"] = (
                source_node.get("name") or "선행 노드")
        elif external_match:
            root = roots.get(external_match.group(1)) or {}
            semantic["source_node_name"] = (
                root.get("display_name")
                or root.get("name")
                or external_match.group(1))
        else:
            semantic["source_node_name"] = "설계된 입력"
        result.append(semantic)
    return result


def _workflow_context(task):
    """AI가 현재 판단 노드의 역할을 앞뒤 흐름 안에서 해석할 수 있는 최소 문맥."""
    raw_nodes = [
        node for node in (task.get("nodes") or [])
        if isinstance(node, dict)
    ]
    names = {
        node.get("id"): _node_name(node)
        for node in raw_nodes if node.get("id")
    }
    branches = {
        node.get("source_node"): node
        for node in raw_nodes
        if node.get("type") == "if" and node.get("source_node")
    }
    actionable = [node for node in raw_nodes if node.get("type") != "if"]
    total = len(actionable)
    workflow = []
    for position, node in enumerate(actionable, 1):
        item = {
            "position": position,
            "total": total,
            "name": _node_name(node),
            "description": node.get("description"),
            "action_type": node.get("action_type"),
            "inputs": _semantic_inputs(task, node.get("inputs")),
            "outputs": _clean_outputs(node.get("outputs")),
        }
        if node.get("action_type") == "decision":
            item["labels"] = [
                value for value in (node.get("labels") or [])
                if isinstance(value, str) and value.strip()
            ]
            branch = branches.get(node.get("id")) or {}
            item["branches"] = [
                {
                    "label": case.get("value"),
                    "next_node_name": names.get(
                        case.get("next"), "다음 작업"),
                }
                for case in (branch.get("cases") or [])
                if isinstance(case, dict)
            ]
        workflow.append(item)
    return workflow


def _job_context(task, node, kind):
    workflow = _workflow_context(task)
    actionable = [
        item for item in (task.get("nodes") or [])
        if isinstance(item, dict) and item.get("type") != "if"
    ]
    focus_position = next(
        (position for position, item in enumerate(actionable, 1)
         if item.get("id") == node.get("id")),
        None,
    )
    focus = (
        workflow[focus_position - 1]
        if focus_position and focus_position <= len(workflow)
        else {}
    )
    return {
        "activity": task.get("activity"),
        "task_name": task.get("task_name") or "이름 없는 업무",
        "workflow": workflow,
        "focus_node": {
            "name": _node_name(node),
            "position": focus.get("position"),
            "total": focus.get("total"),
        },
        "node": {
            "name": _node_name(node),
            "description": node.get("description"),
            "action_type": node.get("action_type"),
            "inputs": _semantic_inputs(task, node.get("inputs")),
            "outputs": _clean_outputs(node.get("outputs")),
            "labels": [
                value for value in (node.get("labels") or [])
                if isinstance(value, str) and value.strip()
            ],
            "reference_paths": [
                value for value in (node.get("references") or [])
                if isinstance(value, str) and value.strip()
            ],
        },
        "draft_kind": kind,
    }


def _instruction(kind):
    if kind == "decision_prompt":
        return (
            "context.workflow의 전체 노드 구성과 focus_node의 위치를 먼저 살펴 이 판단 "
            "노드가 업무 흐름에서 어떤 용도로 쓰이는지 해석하세요. 그 역할에 맞춰 실행 "
            "AI가 바로 사용할 판단 프롬프트를 Markdown으로 작성하세요. 확정된 입력·출력과 "
            "분기 라벨을 지키고 판단 목적, 판단 절차, 라벨 선택 기준, 출력 작성 규칙을 "
            "구체적으로 적되 context에 없는 업무 기준·사실·수치를 만들지 마세요. 입력은 "
            "context.node.inputs의 field와 source_node_name만 사용해 '# 입력' 아래에 "
            "'- 입력 항목명 — 출처: 출처 노드명' 형식으로 적으세요. node_id, output_2, "
            "$.nodes 같은 내부 ID나 source 경로는 절대 본문에 넣지 마세요. JSON이나 코드 "
            "펜스 없이 바로 저장할 Markdown 본문만 반환하세요.")
    return (
        "context만 사용해 해당 산출물을 작성할 실행 AI용 생성 프롬프트를 Markdown으로 "
        "작성하세요. 산출물 구성과 필수 내용을 구체적으로 적되 context에 없는 업무 사실이나 "
        "수치를 만들지 마세요. JSON이나 코드 펜스 없이 프롬프트 본문만 반환하세요.")


def _private_revision_context(task, node):
    """화면에 노출하지 않고 초안 무효화에만 쓰는 실제 연결 지문."""
    branches = [
        {
            "id": item.get("id"),
            "cases": item.get("cases") or [],
        }
        for item in (task.get("nodes") or [])
        if isinstance(item, dict)
        and item.get("type") == "if"
        and item.get("source_node") == node.get("id")
    ]
    return {
        "node_id": node.get("id"),
        "input_sources": [
            item.get("source")
            for item in (node.get("inputs") or [])
            if isinstance(item, dict)
        ],
        "output_ids": [
            item.get("id")
            for item in (node.get("outputs") or [])
            if isinstance(item, dict)
        ],
        "branches": branches,
    }


def _source_replacements(task, node):
    """초안에 나타날 수 있는 내부 참조와 사람용 표현을 만든다."""
    nodes = {
        item.get("id"): item
        for item in (task.get("nodes") or [])
        if isinstance(item, dict) and item.get("id")
    }
    replacements = []
    for item in node.get("inputs") or []:
        if not isinstance(item, dict):
            continue
        source = str(item.get("source") or "")
        match = _NODE_OUTPUT_SOURCE_RE.fullmatch(source)
        field = item.get("field") or item.get("name") or "입력"
        if match:
            source_node_id, output_id = match.groups()
            source_node = nodes.get(source_node_id) or {}
            source_name = _node_name(source_node, "선행 노드")
            tokens = (
                source,
                f"{source_node_id}.{output_id}",
                f"{source_node_id}.output.{output_id}",
            )
        else:
            external = _EXTERNAL_SOURCE_RE.fullmatch(source)
            if not external:
                continue
            source_name = external.group(1)
            tokens = (source,)
        replacements.append({
            "field": field,
            "source_name": source_name,
            "tokens": tokens,
        })
    return replacements, nodes


def _replace_internal_token(content, token, readable):
    """긴 ID가 짧은 ID의 접두사여도 정확한 토큰만 바꾼다."""
    pattern = (
        r"(?<![A-Za-z0-9_])`?"
        + re.escape(token)
        + r"`?(?![A-Za-z0-9_])"
    )
    return re.sub(pattern, lambda _match: readable, content)


def normalize_generated_content(task, job, content):
    """AI 초안에 포함된 내부 참조를 사용자용 표현으로 바꾼다.

    task의 실제 source와 사용자가 저장한 prompt는 변경하지 않는다.
    """
    node_id = job.get("node_id") if isinstance(job, dict) else None
    node = next(
        (item for item in (task.get("nodes") or [])
         if isinstance(item, dict) and item.get("id") == node_id),
        None,
    )
    if node is None or not isinstance(content, str):
        return content
    replacements, nodes = _source_replacements(task, node)
    lines = content.splitlines()
    for index, line in enumerate(lines):
        matches = [
            (len(token), item)
            for item in replacements
            for token in item["tokens"]
            if token and token in line
        ]
        if matches:
            _length, item = max(matches, key=lambda match: match[0])
            bullet = re.match(r"^(\s*)[-*]\s+", line)
            if bullet:
                lines[index] = (
                    f"{bullet.group(1)}- {item['field']} "
                    f"— 출처: {item['source_name']}")
    normalized = "\n".join(lines)

    # 목록 외 문장에 복사된 내부 경로도 사람이 읽을 수 있는 표현으로 바꾼다.
    token_replacements = sorted(
        (
            (token, f"{item['field']} — 출처: {item['source_name']}")
            for item in replacements
            for token in item["tokens"]
            if token
        ),
        key=lambda pair: len(pair[0]),
        reverse=True,
    )
    for token, readable in token_replacements:
        normalized = _replace_internal_token(
            normalized, token, readable)

    # 초안의 다른 절에 노드 ID가 단독으로 복사된 경우에도 노드명으로 정리한다.
    for internal_id, source_node in sorted(
            nodes.items(), key=lambda pair: len(pair[0]), reverse=True):
        readable = _node_name(source_node)
        if readable != internal_id:
            normalized = _replace_internal_token(
                normalized, internal_id, readable)

    # focus node의 출력 ID가 단독으로 복사된 경우에는 해당 출력 업무명으로 바꾼다.
    for output in node.get("outputs") or []:
        if not isinstance(output, dict):
            continue
        output_id = output.get("id")
        output_name = output.get("name")
        if output_id and output_name and output_id != output_name:
            normalized = _replace_internal_token(
                normalized, output_id, output_name)
    return normalized


def build_jobs(task, base_dir=None, task_ref=None, task_revision=None,
               detail_questions=False):
    """설계 확정 뒤 Code Assistant가 처리할 의미 작업만 추출한다.

    신규 작성은 아직 채우지 않은 의미 항목만 대상으로 삼는다. 기존 Task의 상세
    설정을 다시 여는 경우에는 이미 저장된 판단·생성 초안도 현재 설계 문맥으로
    다시 만들 수 있어야 하므로 ``detail_questions``로 전체 상세 질문을 사용한다.
    """
    common = {
        "type": "ops_author_draft_jobs",
        "task_ref": task_ref,
        "task_revision": task_revision,
    }
    if task.get("structure_confirmed") is False:
        return {
            **common,
            "status": "blocked",
            "reason_code": "structure_confirmation_required",
            "job_count": 0,
            "jobs": [],
        }
    pending_questions = author_questions.collect_questions(task, base_dir)
    if any(question.get("qtype") == "io_confirm"
           for question in pending_questions):
        return {
            **common,
            "status": "blocked",
            "reason_code": "io_confirmation_required",
            "job_count": 0,
            "jobs": [],
        }
    if any(question.get("qtype") == "labels_input"
           for question in pending_questions):
        return {
            **common,
            "status": "blocked",
            "reason_code": "design_confirmation_required",
            "job_count": 0,
            "jobs": [],
        }
    questions = (
        author_questions.collect_detail_questions(task, base_dir)
        if detail_questions else pending_questions
    )
    nodes = {
        node.get("id"): node
        for node in (task.get("nodes") or [])
        if isinstance(node, dict) and node.get("id")
    }
    jobs = []
    for question in questions:
        kind = _QTYPE_KIND.get(question.get("qtype"))
        node_id = question.get("node_id")
        node = nodes.get(node_id)
        if not kind or node is None:
            continue
        context = _job_context(task, node, kind)
        identity = {"kind": kind, "node_id": node_id}
        jobs.append({
            "job_id": "creator_" + _digest(identity),
            "revision": _digest({
                "public_context": context,
                "private_topology": _private_revision_context(task, node),
            }),
            "kind": kind,
            "node_id": node_id,
            "node_label": question.get("node_label"),
            "prompt": _instruction(kind),
            "context": context,
            "response_schema": {
                "content": "non-empty Markdown string",
            },
        })
    return {
        **common,
        "status": "ok",
        "job_count": len(jobs),
        "jobs": jobs,
    }


def validate_content(content):
    if not isinstance(content, str):
        raise ValueError("AI 초안 본문은 문자열이어야 합니다")
    if "\x00" in content:
        raise ValueError("AI 초안 본문에 NUL 문자를 사용할 수 없습니다")
    if len(content) > _MAX_DRAFT_CHARS:
        raise ValueError("AI 초안 본문이 256KiB 제한을 초과했습니다")
    content = content.strip()
    if not content:
        raise ValueError("AI 초안 본문이 비었습니다")
    return content


def submitted_draft_map(value):
    """저장 상태에서 유효한 초안 항목만 job_id로 색인한다."""
    out = {}
    items = value.get("drafts") if isinstance(value, dict) else None
    for item in items or []:
        if not isinstance(item, dict):
            continue
        job_id = item.get("job_id")
        revision = item.get("revision")
        content = item.get("content")
        if (isinstance(job_id, str) and isinstance(revision, str)
                and isinstance(content, str) and content.strip()):
            out[job_id] = {
                "job_id": job_id,
                "revision": revision,
                "content": content,
            }
    return out


def matching_drafts(jobs_document, submitted):
    """현재 job revision과 정확히 일치하는 초안과 누락 job을 반환한다."""
    stored = submitted_draft_map(submitted)
    matched = {}
    missing = []
    for job in jobs_document.get("jobs") or []:
        item = stored.get(job["job_id"])
        if item and item.get("revision") == job.get("revision"):
            matched[job["job_id"]] = item
        else:
            missing.append(job)
    return matched, missing


def overlay_questions(task, questions, submitted, base_dir=None,
                      detail_questions=False):
    """현재 질문에 AI 초안 상태와 초안이 없을 때 사용할 기본 문구를 추가한다.

    AI 초안을 기다리는 동안에도 기존 추천 문구로 다른 설정을 계속 편집할 수 있다.
    AI 수정을 요청한 항목은 결과가 도착할 때까지 편집과 최종 확정을 막는다.
    """
    jobs_document = build_jobs(
        task,
        base_dir=base_dir,
        detail_questions=detail_questions,
    )
    submitted = submitted or {}
    matched, _missing = matching_drafts(jobs_document, submitted)
    # generation_requested가 없는 예전 호출자는 기존의 즉시 생성 계약을 유지한다.
    # 새 Dashboard 흐름은 False를 명시해 사용자가 버튼을 누를 때까지 대기하지 않는다.
    generation_requested = bool(submitted.get("generation_requested", True))
    requested_kinds = set(
        submitted.get("requested_kinds") or _QTYPE_KIND.values())
    requested_node_ids = submitted.get("requested_node_ids")
    requested_node_ids = (
        set(requested_node_ids)
        if requested_node_ids is not None
        else None
    )
    by_identity = {
        (job["node_id"], job["kind"]): job
        for job in jobs_document.get("jobs") or []
    }
    for question in questions:
        kind = _QTYPE_KIND.get(question.get("qtype"))
        job = by_identity.get((question.get("node_id"), kind))
        if not job:
            continue
        question["agent_draft_id"] = job["job_id"]
        question["agent_draft_revision"] = job["revision"]
        item = matched.get(job["job_id"])
        if item:
            question["agent_draft"] = normalize_generated_content(
                task, job, item["content"])
            question["agent_draft_pending"] = False
            question["agent_draft_ready"] = True
        else:
            question["agent_draft"] = question.get("suggestion") or ""
            question["agent_draft_pending"] = bool(
                generation_requested
                and kind in requested_kinds
                and (
                    requested_node_ids is None
                    or question.get("node_id") in requested_node_ids
                )
            )
            question["agent_draft_ready"] = False
    return questions
