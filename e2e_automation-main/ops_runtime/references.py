# -*- coding: utf-8 -*-
"""task JSON의 실행 참조 검색·재배선.

Creator와 Validator가 같은 규칙을 사용해 구조 변경 뒤 옛 노드/출력 참조가
task 안에 남는 문제를 방지한다.
"""
import re

PENDING = "__미정__"
NODE_OUTPUT_RE = re.compile(r"^\$\.nodes\.([^.]+)\.output\.(.+)$")


def _configs(node):
    yield node, f"nodes.{node.get('id')}"
    for i, system in enumerate(node.get("systems") or []):
        if isinstance(system, dict):
            yield system, f"nodes.{node.get('id')}.systems[{i}]"


def _walk_strings(obj, path):
    if isinstance(obj, dict):
        for key, value in obj.items():
            yield from _walk_strings(value, f"{path}.{key}")
    elif isinstance(obj, list):
        for i, value in enumerate(obj):
            yield from _walk_strings(value, f"{path}[{i}]")
    elif isinstance(obj, str):
        yield path, obj


def resolve_output_source(task, source, by_id=None):
    """출력 source를 안정적인 output id 기준으로 해석한다.

    반환 ``kind``:
    - canonical: 이미 output id 참조
    - legacy_name: 유일하게 해석되는 과거 출력 이름 참조
    - missing_node / missing_output: 존재하지 않는 참조
    - duplicate_output_id / ambiguous_output_name: 추정하면 안 되는 참조

    출력 이름은 표시값이라 중복될 수 있다. 따라서 id를 먼저 대조하고, id가 아닌
    과거 이름 참조는 같은 생산 노드에서 정확히 하나일 때만 호환한다.
    """
    match = NODE_OUTPUT_RE.match(str(source or ""))
    if not match:
        return None
    node_id, field = match.groups()
    if by_id is None:
        by_id = {
            node.get("id"): node
            for node in task.get("nodes") or []
            if isinstance(node, dict) and node.get("id")
        }
    producer = by_id.get(node_id)
    if producer is None:
        return {
            "kind": "missing_node",
            "source": source,
            "node_id": node_id,
            "field": field,
        }
    outputs = [
        output for output in producer.get("outputs") or []
        if isinstance(output, dict)
    ]
    id_hits = [output for output in outputs if str(output.get("id") or "") == field]
    if len(id_hits) == 1:
        return {
            "kind": "canonical",
            "source": source,
            "canonical": source,
            "node_id": node_id,
            "field": field,
            "output_id": id_hits[0].get("id"),
            "output_name": id_hits[0].get("name") or id_hits[0].get("id"),
        }
    if len(id_hits) > 1:
        return {
            "kind": "duplicate_output_id",
            "source": source,
            "node_id": node_id,
            "field": field,
            "candidates": [
                {"id": output.get("id"), "name": output.get("name")}
                for output in id_hits
            ],
        }
    name_hits = [
        output for output in outputs
        if str(output.get("name") or "") == field
    ]
    if len(name_hits) == 1:
        output_id = name_hits[0].get("id")
        return {
            "kind": "legacy_name",
            "source": source,
            "canonical": f"$.nodes.{node_id}.output.{output_id}",
            "node_id": node_id,
            "field": field,
            "output_id": output_id,
            "output_name": name_hits[0].get("name") or output_id,
        }
    if len(name_hits) > 1:
        return {
            "kind": "ambiguous_output_name",
            "source": source,
            "node_id": node_id,
            "field": field,
            "candidates": [
                {"id": output.get("id"), "name": output.get("name")}
                for output in name_hits
            ],
        }
    return {
        "kind": "missing_output",
        "source": source,
        "node_id": node_id,
        "field": field,
    }


def _output_source_occurrences(task):
    """입력과 실행 요청에 쓰인 출력 source의 (path, source) 목록."""
    for i, node in enumerate(task.get("nodes") or []):
        if not isinstance(node, dict) or node.get("type") == "if":
            continue
        for si, spec in enumerate(node.get("inputs") or []):
            if isinstance(spec, dict):
                source = spec.get("source")
                if NODE_OUTPUT_RE.match(str(source or "")):
                    yield f"nodes[{i}].inputs[{si}].source", source
        for cfg, base in _configs(node):
            request = (cfg.get("integration") or {}).get("request") or {}
            for path, value in _walk_strings(request, base + ".integration.request"):
                if NODE_OUTPUT_RE.match(str(value or "")):
                    yield path, value


def ambiguous_output_sources(task):
    """같은 생산 노드의 동명 출력 때문에 해석할 수 없는 과거 source 인덱스."""
    by_id = {
        node.get("id"): node
        for node in task.get("nodes") or []
        if isinstance(node, dict) and node.get("id")
    }
    result = {}
    for _, source in _output_source_occurrences(task):
        resolved = resolve_output_source(task, source, by_id)
        if resolved and resolved.get("kind") in (
                "ambiguous_output_name", "duplicate_output_id"):
            result[str(source)] = resolved
    return result


def canonicalize_output_sources(task, blocked_sources=None):
    """유일한 과거 출력 이름 참조를 output id 참조로 바꾼다.

    ``blocked_sources``는 편집 전부터 모호했던 source 인덱스다. 출력 삭제·이름
    변경으로 우연히 후보가 하나가 되어도 사용자의 선택 없이 의미를 추정하지 않는다.
    해당 문자열이 편집 결과에 남아 있으면 unresolved로 반환한다.
    """
    blocked_sources = blocked_sources or {}
    by_id = {
        node.get("id"): node
        for node in task.get("nodes") or []
        if isinstance(node, dict) and node.get("id")
    }
    rewrites = {}
    unresolved = []
    reported = set()
    for path, source in _output_source_occurrences(task):
        source = str(source)
        if source in blocked_sources:
            resolved = blocked_sources[source]
            issue = {
                "path": path,
                "source": source,
                "reason": resolved.get("kind", "ambiguous_output_name"),
                "node_id": resolved.get("node_id"),
                "field": resolved.get("field"),
                "candidates": resolved.get("candidates") or [],
            }
        else:
            resolved = resolve_output_source(task, source, by_id)
            if resolved and resolved.get("kind") == "legacy_name":
                rewrites[source] = resolved["canonical"]
                continue
            if resolved and resolved.get("kind") == "canonical":
                continue
            issue = {
                "path": path,
                "source": source,
                "reason": (resolved or {}).get("kind", "missing_output"),
                "node_id": (resolved or {}).get("node_id"),
                "field": (resolved or {}).get("field"),
                "candidates": (resolved or {}).get("candidates") or [],
            }
        key = (issue["path"], issue["source"], issue["reason"])
        if key not in reported:
            unresolved.append(issue)
            reported.add(key)
    changed = rewrite_exact_sources(task, rewrites)
    return {
        "changed": changed,
        "rewrites": rewrites,
        "unresolved": unresolved,
    }


def _rewrite_exact(obj, rewrites):
    """dict/list 안 문자열이 정확히 source인 경우만 안전하게 치환."""
    changed = 0
    if isinstance(obj, dict):
        for key, value in list(obj.items()):
            if isinstance(value, str) and value in rewrites:
                obj[key] = rewrites[value]
                changed += 1
            else:
                changed += _rewrite_exact(value, rewrites)
    elif isinstance(obj, list):
        for i, value in enumerate(list(obj)):
            if isinstance(value, str) and value in rewrites:
                obj[i] = rewrites[value]
                changed += 1
            else:
                changed += _rewrite_exact(value, rewrites)
    return changed


def rewrite_exact_sources(task, rewrites):
    """노드 입력과 실행 요청에 있는 정확한 source 문자열을 함께 치환한다.

    출력 이름은 사용자가 바꿀 수 있으므로 이름 기반 참조를 안정적인 출력 ID
    참조로 옮길 때 사용한다. 문장 일부나 템플릿 문자열은 추정해서 바꾸지 않는다.
    """
    rewrites = {
        str(source): str(replacement)
        for source, replacement in (rewrites or {}).items()
        if source and replacement and source != replacement
    }
    if not rewrites:
        return 0

    changed = 0
    for node in task.get("nodes") or []:
        if node.get("type") == "if":
            continue
        for spec in node.get("inputs") or []:
            source = spec.get("source")
            if source in rewrites:
                spec["source"] = rewrites[source]
                changed += 1
        for cfg, _ in _configs(node):
            request = (cfg.get("integration") or {}).get("request") or {}
            changed += _rewrite_exact(request, rewrites)
    return changed


def _remove_matching_strings(obj, predicate):
    """dict/list 안에서 predicate에 맞는 문자열 값을 키/항목째 제거한다."""
    removed = 0
    if isinstance(obj, dict):
        for key, value in list(obj.items()):
            if isinstance(value, str) and predicate(value):
                obj.pop(key, None)
                removed += 1
            else:
                removed += _remove_matching_strings(value, predicate)
    elif isinstance(obj, list):
        kept = []
        for value in obj:
            if isinstance(value, str) and predicate(value):
                removed += 1
                continue
            removed += _remove_matching_strings(value, predicate)
            kept.append(value)
        obj[:] = kept
    return removed


def _external_name(task, preferred):
    roots = task.setdefault("inputs_from", [])
    preferred = str(preferred or "입력값").strip() or "입력값"
    for item in roots:
        if isinstance(item, dict) and item.get("name") == preferred and not item.get("from_task"):
            return preferred
    existing = {x.get("name") for x in roots if isinstance(x, dict)}
    name, seq = preferred, 2
    while name in existing:
        name = f"{preferred} ({seq})"
        seq += 1
    roots.append({"name": name})
    return name


def _mark_removed_external(task, name, previous_source):
    """구조 편집으로 생산자가 사라져 임시 외부 입력이 된 사실을 질문지까지 보존."""
    for item in task.get("inputs_from") or []:
        if isinstance(item, dict) and item.get("name") == name:
            item["source_status"] = "removed_producer"
            item["previous_source"] = previous_source
            item["description"] = "삭제된 노드에서 전달받던 입력 — 수정 필요"
            return


def reconcile_removed(task, removed_nodes=None, removed_outputs=None,
                      drop_connected_inputs=False):
    """삭제된 생산자 참조를 명시적 외부 입력으로 전환한다.

    반환: {notes, rewrites, unresolved}. integration.request의 동일 source도 함께
    치환한다. ``drop_connected_inputs``가 참이면 통합 설계 화면에서 사용자가 확인한
    삭제이므로 연결 입력과 정확히 같은 실행 요청 참조를 함께 제거한다. 입력 필드와
    연결되지 않은 그 밖의 중첩 참조는 추정하지 않고 unresolved로 둔다.
    """
    removed_nodes = set(removed_nodes or ())
    removed_outputs = {nid: set(fields) for nid, fields in (removed_outputs or {}).items()}
    notes, rewrites = [], {}

    def removed(source):
        match = NODE_OUTPUT_RE.match(str(source or ""))
        if not match:
            return False
        nid, field = match.groups()
        return nid in removed_nodes or field in removed_outputs.get(nid, set())

    for node in task.get("nodes") or []:
        if node.get("type") == "if":
            continue
        touched = False
        local_rewrites = {}
        kept_inputs = []
        for spec in node.get("inputs") or []:
            source = spec.get("source")
            if not removed(source):
                kept_inputs.append(spec)
                continue
            if drop_connected_inputs:
                touched = True
                notes.append(
                    f"[{node.get('name') or '노드'}] 삭제된 출력에 연결된 입력 "
                    f"'{spec.get('field') or '입력'}'을 함께 삭제했습니다"
                )
                continue
            name = _external_name(task, spec.get("field"))
            _mark_removed_external(task, name, source)
            replacement = f"$.inputs_from.{name}"
            spec["source"] = replacement
            rewrites[source] = replacement
            local_rewrites[source] = replacement
            kept_inputs.append(spec)
            touched = True
            notes.append(
                f"삭제된 노드에서 전달받던 입력 '{name}'을 임시 외부 입력으로 "
                "보존했습니다 — 다음 질문지에서 삭제하거나 출처를 다시 연결해 주세요"
            )
        if drop_connected_inputs:
            node["inputs"] = kept_inputs
        if touched:
            node["io_confirmed"] = PENDING
        for cfg, _ in _configs(node):
            integration = cfg.get("integration") or {}
            request = integration.get("request") or {}
            if drop_connected_inputs:
                removed_count = _remove_matching_strings(request, removed)
                if removed_count:
                    notes.append(
                        f"[{node.get('name') or '노드'}] 삭제된 입력을 사용하던 실행 요청 "
                        f"연결 {removed_count}개를 함께 삭제했습니다")
            else:
                _rewrite_exact(request, local_rewrites)

    # 생산 노드의 출력 필드가 삭제되면 단일/복수 시스템의 API 응답 추출 매핑도
    # 같은 reference index에서 정리한다. 남겨 두면 Validator가 옛 출력 필드를
    # 가리키는 것으로 판단해 부분 수정 직후 실패한다.
    for node in task.get("nodes") or []:
        nid = node.get("id")
        removed_fields = removed_outputs.get(nid, set())
        if not removed_fields:
            continue
        for cfg, base in _configs(node):
            response_fields = (cfg.get("integration") or {}).get("response_fields")
            if not isinstance(response_fields, dict):
                continue
            for field in [key for key in response_fields if key in removed_fields]:
                response_fields.pop(field)
                notes.append(
                    f"[{node.get('name') or '노드'}] 삭제된 출력 '{field}'의 응답 추출 "
                    "매핑을 제거했습니다")

    unresolved = []
    for node in task.get("nodes") or []:
        if node.get("type") == "if":
            continue
        for cfg, base in _configs(node):
            request = (cfg.get("integration") or {}).get("request") or {}
            for path, value in _walk_strings(request, base + ".integration.request"):
                if removed(value):
                    unresolved.append({"path": path, "source": value})
    return {"notes": notes, "rewrites": rewrites, "unresolved": unresolved}


def dangling_references(task):
    """현재 task 기준으로 해석 불가능한 구조·데이터 참조 목록."""
    nodes = task.get("nodes") or []
    by_id = {n.get("id"): n for n in nodes if n.get("id")}
    issues = []

    def check_source(path, source):
        resolved = resolve_output_source(task, source, by_id)
        if resolved is None or resolved.get("kind") in ("canonical", "legacy_name"):
            return
        issues.append({
            "path": path,
            "source": source,
            "reason": resolved.get("kind"),
            "node_id": resolved.get("node_id"),
            "field": resolved.get("field"),
            "candidates": resolved.get("candidates") or [],
        })

    for i, node in enumerate(nodes):
        if node.get("type") == "if":
            src = node.get("source_node")
            if src not in by_id:
                issues.append({"path": f"nodes[{i}].source_node", "source": src,
                               "reason": "missing_node"})
            for ci, case in enumerate(node.get("cases") or []):
                nxt = case.get("next")
                if nxt is not None and nxt not in by_id:
                    issues.append({"path": f"nodes[{i}].cases[{ci}].next", "source": nxt,
                                   "reason": "missing_node"})
            continue
        for si, spec in enumerate(node.get("inputs") or []):
            check_source(f"nodes[{i}].inputs[{si}].source", spec.get("source"))
            when = spec.get("when")
            if when is not None:
                path = f"nodes[{i}].inputs[{si}].when"
                if not isinstance(when, dict):
                    issues.append({"path": path, "source": when,
                                   "reason": "invalid_when"})
                else:
                    if_id = when.get("if_node")
                    if_node = by_id.get(if_id)
                    if not if_node or if_node.get("type") != "if":
                        issues.append({"path": path + ".if_node", "source": if_id,
                                       "reason": "missing_if_node"})
                    else:
                        values = [case.get("value") for case in if_node.get("cases") or []]
                        if when.get("value") not in values:
                            issues.append({"path": path + ".value",
                                           "source": when.get("value"),
                                           "reason": "missing_case_value"})
        nxt = node.get("next")
        if ("next" in node and nxt is not None
                and isinstance(nxt, str) and nxt.strip() and nxt not in by_id):
            issues.append({"path": f"nodes[{i}].next", "source": nxt,
                           "reason": "missing_node"})
        for cfg, base in _configs(node):
            integration = cfg.get("integration") or {}
            for path, value in _walk_strings(integration.get("request") or {},
                                             base + ".integration.request"):
                check_source(path, value)
            known_outputs = {x.get("id") for x in node.get("outputs") or []}
            for key in (integration.get("response_fields") or {}):
                if key not in known_outputs:
                    issues.append({"path": base + f".integration.response_fields.{key}",
                                   "source": key, "reason": "missing_output"})
    return issues
