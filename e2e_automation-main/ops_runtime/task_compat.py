# -*- coding: utf-8 -*-
"""이전 변환기가 만든 task 산출물을 읽을 때 필요한 호환 처리를 제공한다.

저장된 JSON은 변경하지 않는다. 과거 변환기의 If·Parallel 경로 결함이 명확히
확인되는 경우에만 검증과 실행에 사용하는 메모리 복사본을 보정한다.
"""
from __future__ import annotations

import copy
import os

from . import util, workspace, yaml_to_task


def _source_candidates(task, task_path):
    source = task.get("source_yaml")
    if not isinstance(source, str) or not source.strip():
        return []
    source = source.strip()
    if os.path.isabs(source):
        return [os.path.normpath(source)]
    folder = os.path.dirname(os.path.abspath(task_path))
    root = workspace.project_root(task_path)
    result = []
    seen = set()
    for candidate in (os.path.join(folder, source), os.path.join(root, source)):
        candidate = os.path.normpath(candidate)
        key = os.path.normcase(os.path.realpath(candidate))
        if key not in seen:
            seen.add(key)
            result.append(candidate)
    return result


def _matching_source(task, task_path):
    expected = task.get("source_yaml_sha256")
    if not isinstance(expected, str) or not expected.strip():
        return None
    expected = expected.strip().lower()
    for candidate in _source_candidates(task, task_path):
        if not os.path.isfile(candidate):
            continue
        try:
            accepted = {value.lower() for value in util.source_yaml_hashes(candidate)}
        except OSError:
            continue
        if expected in accepted:
            return candidate
    return None


def _reachable(node_ids, nodes):
    if not node_ids:
        return set()
    index = {node_id: i for i, node_id in enumerate(node_ids)}
    adjacency = {}
    for i, node in enumerate(nodes):
        node_id = node.get("id")
        if node.get("type") == "if":
            adjacency[node_id] = {
                case.get("next") for case in (node.get("cases") or [])
                if case.get("next") in index
            }
        elif node.get("next") in index:
            adjacency[node_id] = {node["next"]}
        elif i + 1 < len(nodes):
            adjacency[node_id] = {nodes[i + 1].get("id")}
        else:
            adjacency[node_id] = set()
    seen, pending = set(), [node_ids[0]]
    while pending:
        current = pending.pop()
        if current in seen:
            continue
        seen.add(current)
        pending.extend(adjacency.get(current, ()))
    return seen


def _known_parallel_routing_defect(raw, canonical):
    raw_nodes = raw.get("nodes") or []
    canonical_nodes = canonical.get("nodes") or []
    raw_ids = [node.get("id") for node in raw_nodes]
    canonical_ids = [node.get("id") for node in canonical_nodes]

    # Reordering, adding, or deleting nodes is treated as an intentional edit.
    if raw_ids != canonical_ids or len(set(raw_ids)) != len(raw_ids):
        return False

    canonical_by_id = {node.get("id"): node for node in canonical_nodes}
    reachable = _reachable(raw_ids, raw_nodes)
    order = {node_id: i for i, node_id in enumerate(raw_ids)}
    changed = False

    for raw_node in raw_nodes:
        node_id = raw_node.get("id")
        expected = canonical_by_id[node_id]
        if raw_node.get("type") != expected.get("type"):
            return False
        if raw_node.get("type") != "if":
            if raw_node.get("action_type") != expected.get("action_type"):
                return False
            if raw_node.get("next") != expected.get("next"):
                return False
            continue

        if raw_node.get("source_node") != expected.get("source_node"):
            return False
        raw_cases = raw_node.get("cases") or []
        expected_cases = expected.get("cases") or []
        if [case.get("value") for case in raw_cases] != [
                case.get("value") for case in expected_cases]:
            return False
        for old_case, new_case in zip(raw_cases, expected_cases):
            old_target = old_case.get("next")
            new_target = new_case.get("next")
            if old_target == new_target:
                continue
            # The known converter defect skips one or more earlier Parallel
            # branches and jumps to a later branch or continuation.
            if (old_target not in order or new_target not in order
                    or order[new_target] >= order[old_target]
                    or new_target in reachable):
                return False
            changed = True
    return changed


def effective_task(task, task_path):
    """실행용 복사본과 과거 경로 결함의 보정 여부를 반환한다."""
    original = copy.deepcopy(task)
    if not isinstance(task_path, str) or not task_path:
        return original, False
    source = _matching_source(task, task_path)
    if source is None:
        return original, False
    task_id = task.get("source_task_id") or task.get("task_id")
    if not isinstance(task_id, str) or not task_id:
        return original, False
    try:
        # 과거 보정의 비교 기준은 그 결함이 있던 2.1 변환 결과로 고정한다.
        # 최신 변환기가 2.2 제어 연결을 추가해도 submit 산출물 판별은 바뀌지 않는다.
        canonical = yaml_to_task.build_task(
            source, task_id, _schema_version="2.1"
        )
    except Exception:
        return original, False
    if not _known_parallel_routing_defect(task, canonical):
        return original, False

    expected_by_id = {
        node.get("id"): node for node in (canonical.get("nodes") or [])
    }
    for node in original.get("nodes") or []:
        if node.get("type") != "if":
            continue
        expected = expected_by_id[node.get("id")]
        expected_next = {
            case.get("value"): case.get("next")
            for case in (expected.get("cases") or [])
        }
        for case in node.get("cases") or []:
            case["next"] = expected_next.get(case.get("value"))
    return original, True


def load_effective_task(task_path):
    task = util.load_json(task_path)
    return effective_task(task, task_path)[0]
