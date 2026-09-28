# -*- coding: utf-8 -*-
"""Creator의 커스텀 로직 AI 초안 작업을 영속화하고 안전하게 적용한다."""
from __future__ import annotations

import hashlib
import json
import os
import re

from . import logic_draft, util, validate, workspace


_LAUNCH_ID_RE = re.compile(r"^[A-Za-z0-9_-]{20,80}$")
_MAX_TEXT = 2 * 1024 * 1024
_DROP_KEYS = {
    "method", "manual_guide", "manual_url", "manual_copy_automation", "integration",
    "command", "command_spec", "mcp_server", "mcp_instruction",
    "prompt", "prompt_file", "references", "topic", "channel",
    "recipient", "message", "guide", "path", "path_input",
    "directory", "file_hint", "generation_prompt", "template", "systems",
}


def _canonical(path):
    return os.path.normcase(os.path.realpath(os.path.abspath(path)))


def _inside(path, root):
    try:
        return os.path.commonpath([_canonical(path), _canonical(root)]) == _canonical(root)
    except ValueError:
        return False


def _state_path(controller, launch_id):
    if not isinstance(launch_id, str) or not _LAUNCH_ID_RE.fullmatch(launch_id):
        raise ValueError("launch_id 형식이 잘못되었습니다")
    root = os.path.realpath(os.path.join(
        controller.controller_dir, "creator-launches"))
    path = os.path.realpath(os.path.join(root, launch_id + ".logic-jobs.json"))
    if not controller._inside(path, root):
        raise ValueError("커스텀 로직 작업 경로가 잘못되었습니다")
    return path


def _load(controller, launch_id, task_ref=None):
    path = _state_path(controller, launch_id)
    if not os.path.isfile(path):
        return {
            "type": "ops_creator_custom_logic_jobs",
            "launch_id": launch_id,
            "task_ref": task_ref,
            "jobs": [],
        }
    value = util.load_json(path)
    if (
        not isinstance(value, dict)
        or value.get("type") != "ops_creator_custom_logic_jobs"
        or value.get("launch_id") != launch_id
    ):
        raise ValueError("커스텀 로직 작업 상태가 올바르지 않습니다")
    if task_ref is not None and value.get("task_ref") != task_ref:
        raise ValueError("커스텀 로직 작업의 task_ref가 일치하지 않습니다")
    value.setdefault("jobs", [])
    return value


def _write(controller, launch_id, value):
    document = {
        "type": "ops_creator_custom_logic_jobs",
        "launch_id": launch_id,
        "task_ref": value.get("task_ref"),
        "jobs": value.get("jobs") or [],
    }
    util.atomic_write_json(_state_path(controller, launch_id), document)
    return document


def _file_digest(path):
    if not os.path.isfile(path):
        return None
    with open(path, "rb") as handle:
        return hashlib.sha256(handle.read()).hexdigest()


def asset_fingerprint(folder):
    if not isinstance(folder, str) or not folder:
        return None
    material = []
    found = False
    for name in ("LOGIC.md", "run.py", logic_draft.SIDECAR):
        path = os.path.join(folder, name)
        digest = _file_digest(path)
        found = found or digest is not None
        material.append([name, digest])
    if not found:
        return None
    return hashlib.sha256(json.dumps(
        material, ensure_ascii=False, separators=(",", ":")
    ).encode("utf-8")).hexdigest()


def resolve_logic_folder(task_path, stored_or_display):
    if not isinstance(stored_or_display, str) or not stored_or_display.strip():
        raise ValueError("커스텀 로직 폴더가 비었습니다")
    value = workspace.resolve_project_path(stored_or_display.strip(), task_path)
    return os.path.realpath(os.path.abspath(value))


def _owned_folder(task_path, folder):
    activity_root = os.path.realpath(os.path.dirname(task_path))
    logic_root = os.path.realpath(os.path.join(activity_root, "logic"))
    return (
        _inside(folder, logic_root)
        and _canonical(folder) != _canonical(logic_root)
    )


def _iter_other_tasks(project_root, excluded):
    workflow_root = os.path.join(project_root, "workflows")
    if not os.path.isdir(workflow_root):
        return
    for root, dirs, files in os.walk(workflow_root):
        dirs[:] = [name for name in dirs if not name.startswith(".")]
        for name in files:
            if not name.endswith(".json"):
                continue
            path = os.path.realpath(os.path.join(root, name))
            if _canonical(path) == _canonical(excluded):
                continue
            try:
                task = util.load_json(path)
            except (OSError, ValueError, json.JSONDecodeError):
                continue
            if isinstance(task, dict) and isinstance(task.get("nodes"), list):
                yield path, task


def removable_folder(task_path, task, node_id, stored):
    """전용·비공유 로직 폴더만 반환하고 나머지는 거부한다."""
    folder = resolve_logic_folder(task_path, stored)
    if not _owned_folder(task_path, folder):
        raise PermissionError(
            "Task 전용 logic 하위 폴더만 삭제할 수 있습니다")
    for node in task.get("nodes") or []:
        if node.get("id") == node_id:
            continue
        other = node.get("custom_logic")
        if other and _canonical(resolve_logic_folder(task_path, other)) == _canonical(folder):
            raise PermissionError("같은 Task의 다른 노드가 사용하는 공유 로직 폴더입니다")
    project_root = workspace.project_root(task_path)
    for other_path, other_task in _iter_other_tasks(project_root, task_path) or []:
        for node in other_task.get("nodes") or []:
            stored_other = node.get("custom_logic")
            if not stored_other:
                continue
            try:
                used = resolve_logic_folder(other_path, stored_other)
            except (OSError, ValueError):
                continue
            if _canonical(used) == _canonical(folder) or _inside(used, folder):
                raise PermissionError("다른 Task가 사용하는 공유 로직 폴더입니다")
    return folder


def queue_from_remaining(controller, launch_id, task_ref, remaining, task_revision):
    requests = [
        item for item in (remaining or [])
        if isinstance(item, dict) and item.get("action") == "custom_logic"
    ]
    if not requests:
        return {"status": "ok", "job_count": 0, "jobs": []}
    task_path = controller._task_path(task_ref)
    task = util.load_json(task_path)
    state = _load(controller, launch_id, task_ref=controller._ref(task_path))
    jobs = [item for item in state.get("jobs") or [] if item.get("status") == "done"]
    by_id = {node.get("id"): node for node in task.get("nodes") or []}
    for request in requests:
        node_id = request.get("node_id")
        node = by_id.get(node_id)
        if node is None:
            raise ValueError("커스텀 로직 대상 노드를 찾을 수 없습니다")
        logic_dir = request.get("logic_dir")
        folder = resolve_logic_folder(task_path, logic_dir)
        if not _owned_folder(task_path, folder):
            raise PermissionError("커스텀 로직 생성 위치는 Task의 logic 하위여야 합니다")
        description = str(request.get("detail") or "").strip()
        if not description:
            raise ValueError("커스텀 로직 설명이 비었습니다")
        current = node.get("custom_logic")
        current_folder = (
            resolve_logic_folder(task_path, current) if current else None)
        current_fingerprint = (
            asset_fingerprint(current_folder) if current_folder else None)
        expected = request.get("expected_asset_fingerprint")
        if expected is not None and expected != current_fingerprint:
            raise ValueError("커스텀 로직 파일이 화면을 연 뒤 변경되었습니다")
        material = "\0".join([
            launch_id, controller._ref(task_path), str(node_id),
            str(task_revision), description, folder,
        ])
        job_id = hashlib.sha256(material.encode("utf-8")).hexdigest()[:24]
        revision = hashlib.sha256((material + "\0" + str(current_fingerprint)).encode(
            "utf-8")).hexdigest()
        jobs = [item for item in jobs if item.get("job_id") != job_id]
        jobs.append({
            "job_id": job_id,
            "revision": revision,
            "status": "pending",
            "task_revision": task_revision,
            "node_id": node_id,
            "node_name": node.get("name") or node_id,
            "description": description,
            "logic_dir": folder,
            "stored_logic_dir": workspace.project_relative(folder, task_path),
            "replace_existing": bool(current),
            "asset_fingerprint": current_fingerprint,
        })
    saved = _write(controller, launch_id, {
        "task_ref": controller._ref(task_path),
        "jobs": jobs,
    })
    return {
        "status": "ok",
        "job_count": sum(item.get("status") == "pending" for item in saved["jobs"]),
    }


def list_jobs(controller, launch_id):
    state = _load(controller, launch_id)
    task_path = controller._task_path(state["task_ref"])
    task = util.load_json(task_path)
    by_id = {node.get("id"): node for node in task.get("nodes") or []}
    result = []
    for stored in state.get("jobs") or []:
        if stored.get("status") != "pending":
            continue
        node = by_id.get(stored.get("node_id")) or {}
        result.append({
            "job_id": stored["job_id"],
            "revision": stored["revision"],
            "kind": "custom_logic",
            "node_id": stored["node_id"],
            "node_label": stored.get("node_name") or stored["node_id"],
            "task_revision": stored.get("task_revision"),
            "asset_fingerprint": stored.get("asset_fingerprint"),
            "target_folder": stored.get("stored_logic_dir"),
            "prompt": (
                "사용자 설명을 원문 의미 그대로 구현하는 커스텀 로직 초안을 작성하세요. "
                "설명에 없는 경로·주소·업무 규칙은 만들지 마세요."
            ),
            "context": {
                "task_name": task.get("task_name") or task.get("task_id"),
                "node": {
                    "id": node.get("id"),
                    "name": node.get("name"),
                    "action_type": node.get("action_type"),
                    "description": node.get("description"),
                    "inputs": node.get("inputs") or [],
                    "outputs": node.get("outputs") or [],
                    "labels": node.get("labels") or [],
                },
                "user_description": stored["description"],
                "execution_contract": {
                    "stdin": ["task", "node", "key", "inputs", "outputs", "labels(optional)"],
                    "stdout": {"output": "declared output ids", "label": "declared label when branched"},
                    "logs": "stderr",
                },
            },
            "response_schema": {
                "type": "object",
                "required": ["logic_md", "run_py"],
                "properties": {
                    "logic_md": {"type": "string"},
                    "run_py": {"type": "string"},
                },
            },
        })
    return {
        "status": "ok",
        "task_ref": state.get("task_ref"),
        "job_count": len(result),
        "jobs": result,
    }


def submit(controller, launch_id, job_id, expected_revision, payload):
    if not isinstance(payload, dict):
        return controller._invalid(
            "커스텀 로직 결과는 JSON 객체여야 합니다",
            reason_code="invalid_custom_logic_result")
    logic_md = payload.get("logic_md")
    run_py = payload.get("run_py")
    if not all(isinstance(value, str) and value.strip() for value in (logic_md, run_py)):
        return controller._invalid(
            "LOGIC.md와 run.py 본문이 모두 필요합니다",
            reason_code="incomplete_custom_logic_result")
    if len(logic_md.encode("utf-8")) > _MAX_TEXT or len(run_py.encode("utf-8")) > _MAX_TEXT:
        return controller._invalid(
            "커스텀 로직 결과가 허용 크기를 초과했습니다",
            reason_code="custom_logic_result_too_large")
    state = _load(controller, launch_id)
    job = next((item for item in state.get("jobs") or []
                if item.get("job_id") == job_id), None)
    if job is None:
        return controller._conflict("unknown_custom_logic_job", "현재 작업을 찾을 수 없습니다")
    if job.get("status") == "done":
        return {"status": "ok", "job_id": job_id, "remaining_jobs": sum(
            item.get("status") == "pending" for item in state.get("jobs") or [])}
    if expected_revision != job.get("revision"):
        return controller._conflict(
            "stale_custom_logic_job", "커스텀 로직 작업을 받은 뒤 대상이 변경되었습니다",
            current_revision=job.get("revision"))
    task_path = controller._task_path(state["task_ref"])
    if controller._revision(task_path) != job.get("task_revision"):
        return controller._conflict(
            "stale_task_revision", "커스텀 로직 작업을 받은 뒤 Task가 변경되었습니다",
            current_revision=controller._revision(task_path))
    folder = os.path.realpath(job["logic_dir"])
    if not _owned_folder(task_path, folder):
        return controller._invalid(
            "커스텀 로직 생성 위치가 Task 전용 폴더가 아닙니다",
            reason_code="invalid_custom_logic_folder")
    if job.get("asset_fingerprint") != asset_fingerprint(folder):
        return controller._conflict(
            "stale_custom_logic_files", "커스텀 로직 파일이 작업 요청 뒤 변경되었습니다")

    task = util.load_json(task_path)
    before_task = json.loads(json.dumps(task, ensure_ascii=False))
    node = next((item for item in task.get("nodes") or []
                 if item.get("id") == job.get("node_id")), None)
    if node is None:
        return controller._conflict(
            "custom_logic_node_missing", "커스텀 로직 대상 노드가 없습니다")
    paths = [os.path.join(folder, name) for name in (
        "LOGIC.md", "run.py", logic_draft.SIDECAR)]
    previous = {}
    for path in paths:
        if os.path.isfile(path):
            with open(path, "rb") as handle:
                previous[path] = handle.read()
        else:
            previous[path] = None
    try:
        os.makedirs(folder, exist_ok=True)
        util.atomic_write_text(os.path.join(folder, "LOGIC.md"), logic_md.rstrip() + "\n")
        util.atomic_write_text(os.path.join(folder, "run.py"), run_py.rstrip() + "\n")
        marked = logic_draft.mark(folder)
        if marked.get("status") != "ok":
            raise ValueError(marked.get("reason") or "AI 초안 표시 실패")
        for key in _DROP_KEYS:
            node.pop(key, None)
        node["custom_logic"] = job["stored_logic_dir"].rstrip("/") + "/"
        util.atomic_write_json(task_path, task)
        checked = validate.validate(task, task_path)
        if not checked.get("ok"):
            raise ValueError(json.dumps(checked.get("errors") or [], ensure_ascii=False))
        job["status"] = "done"
        job["completed_task_revision"] = controller._revision(task_path)
        for pending in state.get("jobs") or []:
            if pending is not job and pending.get("status") == "pending":
                pending["task_revision"] = job["completed_task_revision"]
        _write(controller, launch_id, state)
    except Exception as exc:
        util.atomic_write_json(task_path, before_task)
        for path, content in previous.items():
            try:
                if content is None:
                    if os.path.isfile(path):
                        os.remove(path)
                else:
                    temporary = path + ".rollback"
                    with open(temporary, "wb") as handle:
                        handle.write(content)
                    os.replace(temporary, path)
            except OSError:
                pass
        if all(content is None for content in previous.values()):
            try:
                os.rmdir(folder)
            except OSError:
                pass
        return controller._conflict(
            "custom_logic_validation_failed",
            "커스텀 로직 결과를 안전하게 적용하지 못해 변경을 되돌렸습니다",
            detail=str(exc))
    remaining = sum(item.get("status") == "pending" for item in state.get("jobs") or [])
    return {
        "status": "ok",
        "job_id": job_id,
        "task_ref": state["task_ref"],
        "task_revision": controller._revision(task_path),
        "logic_dir": job["stored_logic_dir"],
        "remaining_jobs": remaining,
        "validation": controller.task_validate(state["task_ref"], rehearsal=True),
    }
