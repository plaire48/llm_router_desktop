# -*- coding: utf-8 -*-
"""초안 질문지에서 선택할 수 있는 선행 task 출력 카탈로그.

카탈로그는 실행 결과값을 읽지 않는다. 같은 workflow 폴더의 task JSON에서 출력
계약을 읽고, 현재 task의 선행 task임이 증명된 항목만 선택지로 제공한다.

신뢰 순서는 다음과 같다.

1. 출력 계약과 표시명은 실행 대상인 형제 task JSON을 우선한다.
2. 현재 task가 기록한 SHA-256과 정확히 일치하는 source YAML만, 의존 그래프와
   아직 JSON으로 생성되지 않은 선행 task의 출력 계약을 보충하는 데 사용한다.
3. YAML을 신뢰할 수 없으면 형제 JSON들의 ``inputs_from`` 역참조만 따라간다.
   폴더에 있다는 이유만으로 task를 노출하지 않는다(fail-closed).
"""

from __future__ import annotations

import json
import os
from typing import Any, Optional, Union

from . import util, workspace


def _identifier(value: Any) -> Optional[str]:
    """스키마 식별자로 쓸 수 있는, 비어 있지 않은 문자열만 반환한다."""
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value or None


def _display(value: Any, fallback: str) -> str:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return fallback


def _append_diagnostic(diagnostics: list[str], message: str) -> None:
    if message not in diagnostics:
        diagnostics.append(message)


def _load_sibling_tasks(
        task: dict, task_path: str, diagnostics: list[str]) -> dict[str, dict]:
    """현재 task와 같은 폴더의 JSON 파일을 task ID별로 읽는다."""
    folder = os.path.dirname(os.path.abspath(task_path))
    current_path = os.path.normcase(os.path.realpath(os.path.abspath(task_path)))
    current_activity = _identifier(task.get("activity"))
    current_hash = _identifier(task.get("source_yaml_sha256"))
    result: dict[str, dict] = {}

    try:
        names = sorted(os.listdir(folder), key=str.casefold)
    except OSError as exc:
        _append_diagnostic(
            diagnostics, f"형제 task JSON 폴더를 읽을 수 없습니다: {exc}")
        return result

    for name in names:
        if not name.lower().endswith(".json"):
            continue
        path = os.path.join(folder, name)
        if not os.path.isfile(path):
            continue
        if os.path.normcase(os.path.realpath(path)) == current_path:
            continue
        try:
            with open(path, encoding="utf-8-sig") as stream:
                candidate = json.load(stream)
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            _append_diagnostic(
                diagnostics, f"형제 JSON을 읽지 못해 제외했습니다({name}): {exc}")
            continue
        if not isinstance(candidate, dict):
            continue
        task_id = _identifier(candidate.get("task_id"))
        if task_id is None:
            # 같은 폴더의 부수 JSON은 task가 아니므로 진단 소음을 만들지 않는다.
            continue
        # 폴더가 같다는 사실만으로 같은 workflow라고 추정하지 않는다. Creator가
        # 생성한 task에는 activity와 source YAML 해시가 있으므로 현재 task와 비교한다.
        # 단, schema 2.0 형제 task에 해시가 없는 것은 허용한다. 서로 다른 해시가
        # 명시된 경우만 제외하고, 최종 포함 여부는 명시적인 의존 그래프가 결정한다.
        if (current_activity is not None
                and _identifier(candidate.get("activity")) != current_activity):
            continue
        candidate_hash = _identifier(candidate.get("source_yaml_sha256"))
        if (current_hash is not None and candidate_hash is not None
                and candidate_hash != current_hash):
            continue
        if task_id in result:
            _append_diagnostic(
                diagnostics,
                f"task_id가 중복된 형제 JSON을 제외했습니다: {task_id} ({name})")
            continue
        result[task_id] = candidate
    return result


def _yaml_candidates(task: dict, task_path: str) -> list[str]:
    source = task.get("source_yaml")
    if not isinstance(source, str) or not source.strip():
        return []
    source = source.strip()
    if os.path.isabs(source):
        return [os.path.normpath(source)]

    task_folder = os.path.dirname(os.path.abspath(task_path))
    root = workspace.project_root(task_path)
    candidates = [
        os.path.normpath(os.path.join(task_folder, source)),
        os.path.normpath(os.path.join(root, source)),
    ]
    unique: list[str] = []
    seen: set[str] = set()
    for path in candidates:
        key = os.path.normcase(os.path.realpath(path))
        if key not in seen:
            seen.add(key)
            unique.append(path)
    return unique


def _load_matching_yaml(
        task: dict, task_path: str, diagnostics: list[str]) -> Optional[dict]:
    """task에 기록된 해시와 일치하는 source YAML만 파싱한다."""
    source = task.get("source_yaml")
    expected = _identifier(task.get("source_yaml_sha256"))
    if not isinstance(source, str) or not source.strip():
        _append_diagnostic(
            diagnostics,
            "source_yaml이 없어 형제 JSON의 inputs_from 연결만 사용합니다.")
        return None
    if expected is None:
        _append_diagnostic(
            diagnostics,
            "source_yaml_sha256이 없어 source YAML을 신뢰하지 않고 "
            "형제 JSON의 inputs_from 연결만 사용합니다.")
        return None

    existing: list[str] = []
    hash_errors: list[str] = []
    for path in _yaml_candidates(task, task_path):
        if not os.path.isfile(path):
            continue
        existing.append(path)
        try:
            accepted = {value.lower() for value in util.source_yaml_hashes(path)}
        except OSError as exc:
            hash_errors.append(f"{os.path.basename(path)}: {exc}")
            continue
        if expected.lower() not in accepted:
            continue
        try:
            import yaml
        except ImportError:
            _append_diagnostic(
                diagnostics,
                "PyYAML이 없어 source YAML을 읽지 못했습니다. "
                "형제 JSON의 inputs_from 연결만 사용합니다.")
            return None
        try:
            with open(path, encoding="utf-8-sig") as stream:
                document = yaml.safe_load(stream)
        except (OSError, UnicodeError, yaml.YAMLError) as exc:
            _append_diagnostic(
                diagnostics,
                f"source YAML을 읽지 못했습니다({os.path.basename(path)}): {exc}")
            return None
        if not isinstance(document, dict):
            _append_diagnostic(
                diagnostics,
                f"source YAML 최상위가 객체가 아닙니다: {os.path.basename(path)}")
            return None
        return document

    if hash_errors:
        _append_diagnostic(
            diagnostics, "source YAML 해시 계산에 실패했습니다: " + "; ".join(hash_errors))
    if existing:
        _append_diagnostic(
            diagnostics,
            "source YAML의 SHA-256이 task 기록과 달라 사용하지 않았습니다. "
            "형제 JSON의 inputs_from 연결만 사용합니다.")
    else:
        _append_diagnostic(
            diagnostics,
            "source YAML 파일을 찾지 못해 형제 JSON의 inputs_from 연결만 사용합니다.")
    return None


def _workflow_for_task(
        document: dict, task: dict) -> tuple[Optional[dict], Optional[str]]:
    """현재 task가 속한 YAML 워크플로와 YAML 내부 task ID를 찾는다."""
    candidates: list[str] = []
    for key in ("source_task_id", "task_id"):
        task_id = _identifier(task.get(key))
        if task_id and task_id not in candidates:
            candidates.append(task_id)
    if not candidates:
        return None, None

    workflows = document.get("workflows")
    if not isinstance(workflows, list):
        return None, None
    activity = _identifier(task.get("activity"))
    for candidate_id in candidates:
        matches = []
        for workflow_doc in workflows:
            if not isinstance(workflow_doc, dict):
                continue
            yaml_tasks = workflow_doc.get("tasks")
            if not isinstance(yaml_tasks, list):
                continue
            if any(isinstance(item, dict)
                   and _identifier(item.get("id")) == candidate_id
                   for item in yaml_tasks):
                matches.append(workflow_doc)
        if activity is not None:
            activity_matches = [
                workflow_doc for workflow_doc in matches
                if activity in {
                    _identifier(workflow_doc.get("id")),
                    _identifier(workflow_doc.get("name")),
                }
            ]
            if len(activity_matches) == 1:
                return activity_matches[0], candidate_id
            if len(activity_matches) > 1:
                # 같은 activity 표식까지 중복이면 어느 workflow인지 증명할 수 없다.
                continue
        if len(matches) == 1:
            return matches[0], candidate_id
        # 같은 id가 여러 workflow에 있고 activity로 좁힐 수 없으면 fail-closed.
    return None, None


def _yaml_graph(
        workflow_doc: dict,
) -> tuple[dict[str, set[str]], dict[str, dict], list[str]]:
    """YAML의 명시적 task 선행 관계와 선언 순서를 만든다."""
    yaml_tasks = [
        item for item in (workflow_doc.get("tasks") or [])
        if isinstance(item, dict) and _identifier(item.get("id"))
    ]
    by_id = {_identifier(item.get("id")): item for item in yaml_tasks}
    # 위 필터로 None은 들어오지 않는다. 타입 검사기가 이를 좁히지 못하므로 별도 정리.
    by_id = {task_id: item for task_id, item in by_id.items() if task_id is not None}
    known = set(by_id)
    predecessors: dict[str, set[str]] = {task_id: set() for task_id in known}
    order = [
        task_id for item in yaml_tasks
        if (task_id := _identifier(item.get("id"))) is not None
    ]
    order_index = {task_id: index for index, task_id in enumerate(order)}

    for task_id, item in by_id.items():
        depends = item.get("depends_on_task_ids")
        if isinstance(depends, list):
            for value in depends:
                source_id = _identifier(value)
                if (source_id in known and source_id != task_id
                        and order_index[source_id] < order_index[task_id]):
                    predecessors[task_id].add(source_id)
        sources = item.get("task_input_sources")
        if isinstance(sources, list):
            for source in sources:
                if not isinstance(source, dict):
                    continue
                source_id = _identifier(source.get("source_task_id"))
                if (source_id in known and source_id != task_id
                        and order_index[source_id] < order_index[task_id]):
                    predecessors[task_id].add(source_id)
    return predecessors, by_id, order


def _json_graph(documents: dict[str, dict]) -> dict[str, set[str]]:
    """완전한 inputs_from 참조만 JSON fallback 의존 관계로 인정한다."""
    known = set(documents)
    predecessors: dict[str, set[str]] = {task_id: set() for task_id in known}
    for task_id, document in documents.items():
        roots = document.get("inputs_from")
        if not isinstance(roots, list):
            continue
        for root in roots:
            if not isinstance(root, dict):
                continue
            source_id = _identifier(root.get("from_task"))
            source_node = _identifier(root.get("from_node"))
            source_field = _identifier(root.get("from_field"))
            # 부분 참조는 Validator도 실행 가능한 연결로 인정하지 않는다.
            if not (source_id and source_node and source_field):
                continue
            if source_id in known and source_id != task_id:
                predecessors[task_id].add(source_id)
    return predecessors


def _ancestors(predecessors: dict[str, set[str]], task_id: str) -> set[str]:
    """후속 task를 제외하고 현재 task에 도달하는 모든 선행 task ID를 찾는다."""
    result: set[str] = set()
    pending = list(predecessors.get(task_id, ()))
    while pending:
        current = pending.pop()
        if current == task_id or current in result:
            continue
        result.add(current)
        pending.extend(predecessors.get(current, ()))
    return result


def _yaml_nodes_by_id(workflow_doc: Optional[dict]) -> dict[str, dict]:
    if not isinstance(workflow_doc, dict):
        return {}
    result: dict[str, dict] = {}
    nodes = workflow_doc.get("nodes")
    if not isinstance(nodes, list):
        return result
    for node in nodes:
        if not isinstance(node, dict):
            continue
        node_id = _identifier(node.get("id"))
        if node_id and node_id not in result:
            result[node_id] = node
    return result


def _yaml_outputs(node: dict) -> list[dict]:
    schema = node.get("output_schema")
    if not isinstance(schema, dict):
        schema = node.get("resume_payload_schema")
    if not isinstance(schema, dict) or not isinstance(schema.get("fields"), list):
        return []
    return [field for field in schema["fields"] if isinstance(field, dict)]


def _yaml_runtime_node(node: dict) -> bool:
    """raw YAML에서 실제 출력 계약을 갖는 변환 대상 노드 경계.

    raw YAML fallback은 아직 task JSON이 없는 선행 task를 보충한다. 변환기가 제거할
    start/end 이벤트까지 노출하면 Runner가 찾을 수 없는 from_node가 생기므로, 변환
    후 ``outputs``를 가질 수 있는 action/signal 노드만 카탈로그에 포함한다. If branch는
    Runner 노드로 남지만 변환 결과에 outputs가 없으므로 제외한다.
    """
    node_type = node.get("type")
    if node_type == "action":
        return True
    if node_type == "event":
        return node.get("event_type") == "signal"
    return False


def _catalog_task(
        document: dict,
        yaml_task: Optional[dict] = None,
        yaml_nodes: Optional[dict[str, dict]] = None,
        *,
        raw_yaml: bool = False,
) -> Optional[dict]:
    """task JSON과 YAML의 task·node 정의를 같은 카탈로그 형식으로 바꾼다."""
    task_id = _identifier(document.get("id" if raw_yaml else "task_id"))
    if task_id is None:
        return None
    yaml_task = yaml_task or {}
    task_name = _display(
        document.get("name" if raw_yaml else "task_name"),
        _display(yaml_task.get("name"), task_id),
    )
    yaml_nodes = yaml_nodes or {}

    if raw_yaml:
        source_nodes = [
            node for node in yaml_nodes.values()
            if (_identifier(node.get("task_id")) == task_id
                and _yaml_runtime_node(node))
        ]
    else:
        nodes_value = document.get("nodes")
        source_nodes = nodes_value if isinstance(nodes_value, list) else []

    catalog_nodes: list[dict] = []
    for node in source_nodes:
        if not isinstance(node, dict):
            continue
        node_id = _identifier(node.get("id"))
        if node_id is None:
            continue
        yaml_node = yaml_nodes.get(node_id) or {}
        node_name = _display(
            node.get("name"), _display(yaml_node.get("name"), node_id))
        outputs = _yaml_outputs(node) if raw_yaml else node.get("outputs")
        if not isinstance(outputs, list):
            outputs = []

        catalog_outputs: list[dict] = []
        seen_fields: set[str] = set()
        yaml_fields = {
            _identifier(field.get("id")): field
            for field in _yaml_outputs(yaml_node)
            if _identifier(field.get("id"))
        }
        for output in outputs:
            if not isinstance(output, dict):
                continue
            field_id = _identifier(output.get("id"))
            if field_id is None or field_id in seen_fields:
                continue
            seen_fields.add(field_id)
            yaml_field = yaml_fields.get(field_id) or {}
            field_name = _display(
                output.get("name"), _display(yaml_field.get("name"), field_id))
            description = output.get("description")
            if not isinstance(description, str):
                description = yaml_field.get("description")
            if not isinstance(description, str):
                description = ""
            catalog_outputs.append({
                "task_id": task_id,
                "task_name": task_name,
                "node_id": node_id,
                "node_name": node_name,
                "field_id": field_id,
                "field_name": field_name,
                "description": description,
                "from_task": task_id,
                "from_node": node_id,
                "from_field": field_id,
            })
        # 선택할 출력이 없는 제어 노드는 계층 메뉴에 노출하지 않는다.
        if catalog_outputs:
            catalog_nodes.append({
                "node_id": node_id,
                "node_name": node_name,
                "outputs": catalog_outputs,
            })

    return {
        "task_id": task_id,
        "task_name": task_name,
        "nodes": catalog_nodes,
    }


def build_previous_output_catalog(
        task: dict, task_path: Union[os.PathLike, str]) -> dict:
    """현재 task가 참조할 수 있는 선행 task 출력 정의를 반환한다.

    반환 형식은 ``{"tasks": [...], "diagnostics": [...]}``이며 원본 ``task``나
    어떤 JSON/YAML 파일도 수정하지 않는다.
    """
    diagnostics: list[str] = []
    if not isinstance(task, dict):
        return {"tasks": [], "diagnostics": ["task가 JSON 객체가 아닙니다."]}
    try:
        path = os.fspath(task_path)
    except TypeError:
        return {"tasks": [], "diagnostics": ["task_path가 올바른 경로가 아닙니다."]}
    if not isinstance(path, str) or not path:
        return {"tasks": [], "diagnostics": ["task_path가 비어 있습니다."]}

    current_id = _identifier(task.get("task_id"))
    if current_id is None:
        return {"tasks": [], "diagnostics": ["현재 task_id가 없어 선행 task를 판별할 수 없습니다."]}

    siblings = _load_sibling_tasks(task, path, diagnostics)
    graph_documents = dict(siblings)
    # 호출자가 가진 최신 메모리 상태가 디스크의 현재 task보다 우선한다.
    graph_documents[current_id] = task

    yaml_document = _load_matching_yaml(task, path, diagnostics)
    workflow_doc: Optional[dict] = None
    yaml_current_id: Optional[str] = None
    if yaml_document is not None:
        workflow_doc, yaml_current_id = _workflow_for_task(yaml_document, task)
        if workflow_doc is None or yaml_current_id is None:
            _append_diagnostic(
                diagnostics,
                "source YAML에서 현재 task를 찾지 못해 형제 JSON의 inputs_from "
                "연결만 사용합니다.")

    yaml_tasks: dict[str, dict] = {}
    yaml_order: list[str] = []
    if workflow_doc is not None and yaml_current_id is not None:
        predecessors, yaml_tasks, yaml_order = _yaml_graph(workflow_doc)
        allowed_source_ids = _ancestors(predecessors, yaml_current_id)
        order = [task_id for task_id in yaml_order if task_id in allowed_source_ids]
    else:
        predecessors = _json_graph(graph_documents)
        allowed_source_ids = _ancestors(predecessors, current_id)
        order = [
            task_id for task_id in graph_documents
            if task_id in allowed_source_ids
        ]

    yaml_nodes = _yaml_nodes_by_id(workflow_doc)
    siblings_by_source: dict[str, dict] = {}
    for sibling in siblings.values():
        source_id = _identifier(sibling.get("source_task_id"))
        if source_id and source_id not in siblings_by_source:
            siblings_by_source[source_id] = sibling

    tasks: list[dict] = []
    emitted: set[str] = set()
    for source_id in order:
        sibling = siblings.get(source_id) or siblings_by_source.get(source_id)
        if sibling is not None:
            actual_id = _identifier(sibling.get("task_id"))
            if actual_id is None or actual_id == current_id or actual_id in emitted:
                continue
            catalog_task = _catalog_task(
                sibling, yaml_tasks.get(source_id), yaml_nodes)
        elif workflow_doc is not None:
            # JSON이 아직 생성되지 않은 선행 task만, 해시가 검증된 YAML로 보충한다.
            catalog_task = _catalog_task(
                yaml_tasks.get(source_id) or {},
                yaml_tasks.get(source_id),
                yaml_nodes,
                raw_yaml=True,
            )
            actual_id = source_id
        else:
            catalog_task = None
            actual_id = source_id

        if catalog_task is None:
            _append_diagnostic(
                diagnostics, f"선행 task 정의를 찾지 못해 제외했습니다: {source_id}")
            continue
        if not catalog_task.get("nodes"):
            _append_diagnostic(
                diagnostics, f"선택할 출력 계약이 없는 선행 task를 제외했습니다: {source_id}")
            continue
        emitted.add(actual_id)
        tasks.append(catalog_task)

    return {"tasks": tasks, "diagnostics": diagnostics}


def find_output_ref(catalog: dict, ref: dict) -> Optional[dict]:
    """``from_task/from_node/from_field`` 참조와 일치하는 출력 항목을 찾는다.

    호출할 때는 카탈로그 항목의 ``task_id/node_id/field_id`` 키도 참조값으로
    허용한다. 불완전하거나 카탈로그 밖인 참조는 추정하지 않고 ``None``을 반환한다.
    """
    if not isinstance(catalog, dict) or not isinstance(ref, dict):
        return None
    task_id = _identifier(ref.get("from_task")) or _identifier(ref.get("task_id"))
    node_id = _identifier(ref.get("from_node")) or _identifier(ref.get("node_id"))
    field_id = _identifier(ref.get("from_field")) or _identifier(ref.get("field_id"))
    if not (task_id and node_id and field_id):
        return None

    tasks = catalog.get("tasks")
    if not isinstance(tasks, list):
        return None
    for catalog_task in tasks:
        if not isinstance(catalog_task, dict):
            continue
        parent_task_id = (
            _identifier(catalog_task.get("task_id"))
            or _identifier(catalog_task.get("from_task"))
        )
        nodes = catalog_task.get("nodes")
        if not isinstance(nodes, list):
            continue
        for node in nodes:
            if not isinstance(node, dict):
                continue
            parent_node_id = (
                _identifier(node.get("node_id"))
                or _identifier(node.get("from_node"))
            )
            outputs = node.get("outputs")
            if not isinstance(outputs, list):
                continue
            for output in outputs:
                if not isinstance(output, dict):
                    continue
                output_task_id = (
                    _identifier(output.get("from_task"))
                    or _identifier(output.get("task_id"))
                    or parent_task_id
                )
                output_node_id = (
                    _identifier(output.get("from_node"))
                    or _identifier(output.get("node_id"))
                    or parent_node_id
                )
                output_field_id = (
                    _identifier(output.get("from_field"))
                    or _identifier(output.get("field_id"))
                    or _identifier(output.get("output_id"))
                )
                if (output_task_id == task_id
                        and output_node_id == node_id
                        and output_field_id == field_id):
                    return output
    return None
