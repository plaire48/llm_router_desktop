# -*- coding: utf-8 -*-
"""Dashboard에서 YAML 기반 Task를 처음부터 다시 만들기 위한 삭제 manifest.

삭제 대상은 정본 Task가 소유한 프로젝트 내부 산출물과 Task/run/Creator launch로
직접 추적되는 ``.ops`` 상태로 제한한다. 일반 reference와 공유 자원은 지우지 않는다.
"""
from __future__ import annotations

import json
import os
import shutil

from . import engine, util, workspace, yaml_to_task


def _canonical(path):
    return os.path.normcase(os.path.realpath(os.path.abspath(path)))


def _inside(path, root):
    try:
        return os.path.commonpath([_canonical(path), _canonical(root)]) == _canonical(root)
    except ValueError:
        return False


def _walk_json(folder):
    if not os.path.isdir(folder):
        return
    for root, _dirs, files in os.walk(folder):
        for name in sorted(files):
            if not name.endswith(".json"):
                continue
            path = os.path.join(root, name)
            try:
                value = util.load_json(path)
            except (OSError, ValueError, json.JSONDecodeError):
                continue
            yield path, value


def _contains_value(value, wanted):
    if isinstance(value, dict):
        return any(_contains_value(item, wanted) for item in value.values())
    if isinstance(value, list):
        return any(_contains_value(item, wanted) for item in value)
    return isinstance(value, str) and value in wanted


def _resolve_project_value(controller, task_path, stored):
    if not isinstance(stored, str) or not stored.strip():
        return None
    value = workspace.resolve_project_path(stored, task_path)
    if not os.path.isabs(value):
        value = os.path.join(controller.project_root, value)
    return os.path.realpath(os.path.abspath(value))


def _yaml_source(controller, task):
    source = os.path.basename(str(task.get("source_yaml") or "")).casefold()
    source_task_id = task.get("source_task_id") or task.get("task_id")
    if not source or not source_task_id:
        return None
    for path in controller._project_files((".yaml", ".yml")):
        if os.path.basename(path).casefold() != source:
            continue
        try:
            tasks = yaml_to_task.list_tasks(path)
        except (OSError, ValueError, KeyError):
            continue
        if any(item.get("id") == source_task_id for item in tasks):
            return path
    return None


def _task_records(controller, excluded_path):
    workflow_root = os.path.join(controller.project_root, "workflows")
    for path in controller._project_files((".json",), roots=(workflow_root,)):
        if _canonical(path) == _canonical(excluded_path):
            continue
        try:
            task = util.load_json(path)
        except (OSError, ValueError, json.JSONDecodeError):
            continue
        if isinstance(task, dict) and isinstance(task.get("task_id"), str):
            yield path, task


def _asset_candidates(controller, task_path, task, other_records):
    activity_root = os.path.realpath(os.path.dirname(task_path))
    decisions_root = os.path.join(activity_root, "decisions")
    logic_root = os.path.join(activity_root, "logic")
    raw = []
    for node in task.get("nodes") or []:
        if not isinstance(node, dict):
            continue
        prompt = _resolve_project_value(controller, task_path, node.get("prompt_file"))
        if prompt and _inside(prompt, decisions_root):
            parent = os.path.dirname(prompt)
            raw.append((
                "prompt",
                parent if _canonical(parent) != _canonical(decisions_root) else prompt,
            ))
        logic = _resolve_project_value(controller, task_path, node.get("custom_logic"))
        if (
            logic
            and _inside(logic, logic_root)
            and _canonical(logic) != _canonical(logic_root)
        ):
            raw.append(("logic", logic))

    seen = set()
    candidates = []
    for kind, path in raw:
        key = (kind, _canonical(path))
        if key in seen:
            continue
        seen.add(key)
        candidates.append((kind, os.path.realpath(path)))

    used = []
    for other_path, other in other_records:
        for node in other.get("nodes") or []:
            if not isinstance(node, dict):
                continue
            for stored in [
                node.get("prompt_file"),
                node.get("custom_logic"),
                *(node.get("references") or []),
            ]:
                resolved = _resolve_project_value(controller, other_path, stored)
                if resolved:
                    used.append(resolved)

    removable = []
    shared = []
    for kind, path in candidates:
        # broad reference('.')가 모든 자원을 공유로 오인하지 않도록, 다른 Task가
        # 후보 자체 또는 후보 아래 파일을 직접 가리키는 경우만 공유로 본다.
        is_shared = any(
            _canonical(value) == _canonical(path) or _inside(value, path)
            for value in used
        )
        (shared if is_shared else removable).append({
            "kind": kind,
            "path": path,
        })
    return removable, shared


def _dependent_tasks(task, other_records):
    result = []
    for path, other in other_records:
        if other.get("activity") != task.get("activity"):
            continue
        if not any(
            isinstance(item, dict) and item.get("from_task") == task.get("task_id")
            for item in (other.get("inputs_from") or [])
        ):
            continue
        result.append({
            "task_ref": path,
            "task_name": other.get("task_name") or other.get("task_id"),
        })
    return result


def build_manifest(controller, task_ref):
    task_path = controller._task_path(task_ref)
    task = util.load_json(task_path)
    yaml_path = _yaml_source(controller, task)
    if yaml_path is None:
        raise ValueError("yaml_task_required")

    canonical_ref = controller._ref(task_path)
    other_records = list(_task_records(controller, task_path))
    assets, shared_assets = _asset_candidates(
        controller, task_path, task, other_records)
    dependents = _dependent_tasks(task, other_records)

    runs = list(controller._iter_task_runs(task))
    run_paths = [path for path, _run in runs]
    run_refs = {controller._ref(path) for path in run_paths}
    launch_ids = set()
    files = set(run_paths)
    directories = set()
    for run_path, run in runs:
        if not run.get("snapshot_ref"):
            continue
        directories.add(os.path.dirname(engine._snapshot_task_path(run_path)))

    launch_root = os.path.join(controller.controller_dir, "creator-launches")
    for path, value in _walk_json(launch_root) or []:
        if value.get("task_ref") != canonical_ref:
            continue
        launch_id = value.get("launch_id")
        if isinstance(launch_id, str):
            launch_ids.add(launch_id)
        files.add(path)
    for launch_id in launch_ids:
        for suffix in (".json", ".drafts.json", ".logic-jobs.json", ".stop.json"):
            candidate = os.path.join(launch_root, launch_id + suffix)
            if os.path.isfile(candidate):
                files.add(candidate)
        node_test_dir = os.path.join(
            controller.project_root, ".ops", "node-tests", launch_id)
        if os.path.isdir(node_test_dir):
            directories.add(node_test_dir)

    exact_values = {canonical_ref, controller._ref(task_path), *run_refs, *launch_ids}
    absolute_values = {_canonical(task_path), *[_canonical(path) for path in run_paths]}

    state_roots = [
        os.path.join(controller.controller_dir, "author-receipts"),
        os.path.join(controller.project_root, ".ops", "payloads"),
        os.path.join(controller.project_root, ".ops", "dashboard", "runner-inputs"),
        os.path.join(controller.project_root, ".ops", "dashboard", "operations"),
        controller.idempotency_dir,
    ]
    for root in state_roots:
        for path, value in _walk_json(root) or []:
            if _contains_value(value, exact_values) or _contains_value(
                value, absolute_values
            ):
                files.add(path)

    ui_root = os.path.join(
        controller.project_root, ".ops", "ui",
        workspace._safe(task.get("activity") or "workflow"),
    )
    stem = workspace._safe(os.path.splitext(os.path.basename(task_path))[0])
    for suffix in ("_질문지.html", "_구성편집.html"):
        candidate = os.path.join(ui_root, stem + suffix)
        if os.path.isfile(candidate):
            files.add(candidate)

    history_root = os.path.join(
        controller.project_root, ".ops", "history",
        workspace._safe(task.get("task_id") or "task"),
    )
    for path, value in _walk_json(history_root) or []:
        stored = value.get("task_path")
        if isinstance(stored, str) and _canonical(stored) == _canonical(task_path):
            files.add(path)

    return {
        "task_path": task_path,
        "task_ref": canonical_ref,
        "task": task,
        "task_name": task.get("task_name") or task.get("task_id"),
        "task_fingerprint": controller._fingerprint(task_path),
        "yaml_ref": controller._ref(yaml_path),
        "assets": assets,
        "shared_assets": shared_assets,
        "dependent_tasks": dependents,
        "run_paths": run_paths,
        "run_refs": sorted(run_refs),
        "launch_ids": sorted(launch_ids),
        "files": sorted({_canonical(path) for path in files}),
        "directories": sorted({_canonical(path) for path in directories}),
    }


def public_preview(controller, manifest):
    assets = manifest["assets"]
    state_files = [
        path for path in manifest["files"]
        if path not in {_canonical(item) for item in manifest["run_paths"]}
    ]
    return {
        "status": "ok",
        "task_ref": manifest["task_ref"],
        "task_name": manifest["task_name"],
        "task_fingerprint": manifest["task_fingerprint"],
        "yaml_ref": manifest["yaml_ref"],
        "recoverable": False,
        "delete_counts": {
            "task": 1,
            "runs": len(manifest["run_paths"]),
            "prompt_folders": sum(item["kind"] == "prompt" for item in assets),
            "custom_logic_folders": sum(item["kind"] == "logic" for item in assets),
            "local_state": len(state_files) + len(manifest["directories"]),
        },
        "dependent_tasks": [
            {
                "task_ref": controller._ref(item["task_ref"]),
                "task_name": item["task_name"],
            }
            for item in manifest["dependent_tasks"]
        ],
        "preserved_shared_assets": len(manifest["shared_assets"]),
    }


def delete_manifest(controller, manifest):
    removed_files = 0
    removed_directories = 0
    for path in manifest["files"]:
        if os.path.isfile(path):
            os.remove(path)
            removed_files += 1
    for path in sorted(manifest["directories"], key=len, reverse=True):
        if os.path.isdir(path):
            shutil.rmtree(path)
            removed_directories += 1
    for asset in sorted(manifest["assets"], key=lambda item: len(item["path"]), reverse=True):
        path = asset["path"]
        if os.path.isdir(path):
            shutil.rmtree(path)
            removed_directories += 1
        elif os.path.isfile(path):
            os.remove(path)
            removed_files += 1
    os.remove(manifest["task_path"])
    removed_files += 1

    # 생성된 빈 껍데기만 아래에서 위로 정리한다. YAML 원본과 다른 Task는 건드리지 않는다.
    activity_root = os.path.dirname(manifest["task_path"])
    for folder in (
        os.path.join(activity_root, "decisions"),
        os.path.join(activity_root, "logic"),
        activity_root,
    ):
        try:
            os.rmdir(folder)
        except OSError:
            pass
    return removed_files, removed_directories
