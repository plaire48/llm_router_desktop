# -*- coding: utf-8 -*-
"""YAML → task JSON 초안 변환기.

- task 단위로 변환한다 (운영담당자 산출물 = task JSON).
- Parallel/Memo/Wait/start/end는 버리고 실행 순서를 평탄화한다.
- If의 빈 source_field는 선행 decision 노드에서 추론한다.
- 실행 메타데이터(endpoint, 경로, 프롬프트 등)가 필요한 자리는 전부 "__미정__" 마커로
  남긴다 — 마커가 남은 JSON은 검증기가 거부하므로 반쪽 산출물이 유통될 수 없다.

CLI (AI 에이전트의 /e2e-agent-creator가 실행):
    python ops_runtime/yaml_to_task.py <yaml> --list
    python ops_runtime/yaml_to_task.py <yaml> --task <task_id> [--write] [--out <path>]
"""
import argparse
import copy
import datetime
import json
import os
import re
import sys
import threading

if __package__ in (None, ""):
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from ops_runtime import mutation_lock, util, workspace
else:
    from . import mutation_lock, util, workspace

PENDING = "__미정__"

_SOURCE_RE = re.compile(r"^\$\.actions\.([^.]+)\.latest\.output\.(.+)$")

# 파싱된 YAML 문서 캐시 — 내용 해시가 키다.
# 실측(227KB 형상관리 YAML): 재파싱 0.1967s / 내용 해시 0.00026s / deepcopy 0.0024s.
# 이 파일은 /api/signal 3초 폴링 경로(run_status → _progress → load_effective_task)에서
# 대기 중인 run마다 다시 파싱되고 있었다.
_DOC_CACHE = {}
_DOC_CACHE_MAX = 8
_DOC_CACHE_LOCK = threading.Lock()


def _load(yaml_path):
    """YAML을 파싱한다 — 같은 내용을 반복 파싱하지 않도록 결과를 캐시한다.

    파일은 **한 번만** 읽고, 그 바이트로 해시와 파싱을 모두 한다. 해시용으로 한 번,
    파싱용으로 또 한 번 읽으면 그 사이 파일이 바뀌었을 때 새 내용을 옛 해시 키로
    캐시하게 된다.

    키는 mtime이 아니라 내용 해시다. 해싱은 파싱의 1/750 비용이라 아낄 이유가 없고,
    mtime 해상도·되돌린 편집 같은 함정을 아예 없앤다. 줄바꿈만 다른 파일은 같은
    해시가 되는데, YAML 파싱 결과도 실제로 같으므로 공유해도 맞다.

    호출자에게는 항상 복사본을 준다. 현재 호출자(list_tasks·build_task)는 doc을
    변형하지 않지만, 캐시를 공유하다 오염되면 추적이 매우 어려운 버그가 된다.
    deepcopy를 넣어도 0.1967s → 0.0027s로 여전히 70배 이상 빠르다.
    """
    with open(yaml_path, "rb") as stream:
        raw = stream.read()
    key = util.normalized_bytes_sha256(raw)
    with _DOC_CACHE_LOCK:
        hit = _DOC_CACHE.get(key)
    if hit is not None:
        return copy.deepcopy(hit)
    import yaml
    try:
        doc = yaml.safe_load(raw.decode("utf-8"))
    except yaml.YAMLError as exc:
        raise ValueError(f"YAML 파싱에 실패했습니다: {exc}") from exc
    if not isinstance(doc, dict):
        raise ValueError("YAML 최상위 값은 객체여야 합니다")
    with _DOC_CACHE_LOCK:
        _DOC_CACHE[key] = doc
        while len(_DOC_CACHE) > _DOC_CACHE_MAX:
            _DOC_CACHE.pop(next(iter(_DOC_CACHE)))
    return copy.deepcopy(doc)


def _file_sha256(path):
    return util.normalized_text_sha256(path)


def _find_workflow(doc, task_id=None):
    wfs = doc.get("workflows") or []
    if not wfs:
        raise ValueError("YAML에 workflows가 없습니다")
    if task_id:
        for wf in wfs:
            if any(t.get("id") == task_id for t in wf.get("tasks", [])):
                return wf
        raise ValueError(f"task를 찾을 수 없습니다: {task_id}")
    return wfs[0]


# ------------------------------------------------------------ 분류 (v1 이식, 크롤링 제거)

def _feasibility(node):
    cfg = (node.get("module") or {}).get("config") or {}
    systems = cfg.get("target_systems") or node.get("target_systems") or []
    feas, names, blockers, methods = [], [], {}, {}
    for s in systems:
        if not isinstance(s, dict):
            continue
        if s.get("name"):
            names.append(s.get("name"))
        if s.get("automation_feasibility"):
            feas.append((s.get("name"), s["automation_feasibility"]))
        if s.get("automation_blocker_reason"):
            blockers[s.get("name")] = s["automation_blocker_reason"]
        if s.get("automation_methods"):
            # manual_work_items의 automation_methods는 수집하지 않는다 — 그쪽은 시스템
            # 실행 방식이 아니라 수동 산출물의 AI 보조 가능성 표기라 의미가 다르다
            methods[s.get("name")] = [str(m) for m in s["automation_methods"]]
    node_feas = node.get("automation_feasibility")
    return {
        "names": names,
        "per_system": dict(feas),
        "blockers": blockers,
        "methods": methods,
        "node_feasibility": node_feas,
        "node_methods": [str(m) for m in (node.get("automation_methods") or [])],
        "all_impossible": (bool(feas) and all(f == "impossible" for _, f in feas))
                          or (not feas and node_feas == "impossible"),
    }


def classify(node):
    """action과 event 노드를 v2의 8가지 action_type 중 하나로 분류한다."""
    if node.get("type") == "event":
        return "notify_receive" if node.get("event_type") == "signal" else None
    mod = node.get("module") or {}
    mtype = mod.get("type")
    kind = (mod.get("config") or {}).get("kind")
    if mtype == "guardrail":
        return "decision"
    if mtype == "human_approval":
        return "consult"
    if mtype == "file_search":
        return "file_read"
    if mtype == "api_mcp":
        if kind == "system_read":
            return "system_read"
        if kind == "system_write":
            return "system_write"
        if kind == "file_write":
            return "file_write"
        if kind == "file_read":
            return "file_read"
    return "system_read"  # 미분류 → 조회로 간주(실행 방식은 저작 질답에서 확정)


# ------------------------------------------------------------ 분기 해석 (v1 이식)

def _derive_decided_by(edges, nodes_by_id, branch_id):
    ins = [e for e in edges if e.get("target") == branch_id]
    action_srcs = [e["source"] for e in ins
                   if (nodes_by_id.get(e["source"]) or {}).get("type") == "action"]
    return action_srcs[0] if action_srcs else (ins[0]["source"] if ins else None)


def _raw_cases(node, edges):
    outs = [e for e in edges if e.get("source") == node["id"]]
    result = []
    for i, c in enumerate(node.get("cases") or []):
        target = c.get("target_node_id")
        if not target:
            for e in outs:
                if e.get("source_handle") == f"case_{i}" or e.get("condition") == c.get("value"):
                    target = e.get("target")
                    break
        result.append({"value": c.get("value", ""), "target": target})
    return result


# ------------------------------------------------------------ 노드 변환

def _schema_fields(schema):
    return [{"id": f.get("id"), "name": f.get("name") or f.get("id"),
             "description": f.get("description", "")}
            for f in (schema or {}).get("fields", []) if f.get("id")]


def _field_label(node, field_id):
    for f in (node.get("input_schema") or {}).get("fields", []):
        if f.get("id") == field_id:
            return f.get("name") or field_id
    return field_id


def _convert_action(node, if_labels_by_decision):
    at = classify(node)
    cfg = (node.get("module") or {}).get("config") or {}
    out = {
        "id": node["id"],
        "name": node.get("name") or node["id"],
        "action_type": at,
        "description": node.get("description", ""),
        "inputs": [],  # 뒤에서 채움
        "outputs": _schema_fields(node.get("output_schema")
                                  or node.get("resume_payload_schema")),
        # YAML의 입출력 선언은 신뢰도가 낮다 — 저작 질답에서 사용자에게 목록을 보여주고
        # 확인받은 뒤 true로 바꿔야 검증을 통과한다(마커라 건너뛸 수 없음).
        "io_confirmed": PENDING,
        "custom_logic": None,
    }

    if at == "decision":
        out["prompt"] = PENDING
        out["evidence_required"] = True
        if node["id"] in if_labels_by_decision:
            out["labels"] = if_labels_by_decision[node["id"]]
        # else: 후속 If가 없는 판단 = 산출형 — labels 키 자체를 내지 않는다.
        # 라벨 질문도 없으므로 [PENDING] 마커를 남기면 해소 불가능한 미정 항목이 된다.
    elif at == "consult":
        # 협의 대상(counterpart)은 받지 않는다 — 원본 YAML에 칸이 없고,
        # 대상은 노드 이름("고객 협의")이 이미 담는다 (실사용 피드백)
        out["topic"] = cfg.get("consultation_topic") or PENDING
    elif at == "notify_receive":
        out["guide"] = node.get("name") or PENDING
    elif at == "notify_send":
        out["channel"] = PENDING
        out["recipient"] = PENDING
        out["message"] = PENDING
        out["approval_required"] = True
    elif at == "file_read":
        files = cfg.get("target_files") or ([{"path": cfg.get("target_file")}]
                                            if cfg.get("target_file") else [])
        hint = ", ".join(str(f.get("path", "")) for f in files if isinstance(f, dict))
        if hint:
            out["description"] = (out["description"] + f" [문서: {hint}]").strip()
        out["path"] = PENDING
    elif at == "file_write":
        target = cfg.get("target_file") or ""
        if target:
            out["description"] = (out["description"] + f" [대상: {target}]").strip()
        out["path"] = PENDING
        out["generation_prompt"] = PENDING
    else:  # system_read / system_write
        # YAML의 automation_feasibility는 신뢰도가 낮다 — manual로 자동 확정하지 않고
        # automation_note(참고 표기)만 남긴다. 확정은 저작 질답의 몫이다.
        # 가능/불가 양쪽을 표기한다 — 실사용 요청: 실행 방식을 고를 때 YAML이
        # 원래 뭐라고 했는지(기존 값)를 보여 달라.
        feas = _feasibility(node)
        names = feas["names"]

        def _note(nm):
            val = feas["per_system"].get(nm) or feas["node_feasibility"]
            if val == "impossible":
                reason = feas["blockers"].get(nm)
                return "YAML 표기: 자동화 불가" + (f" — {reason}" if reason else "")
            if val == "possible":
                ms = feas["methods"].get(nm) or feas["node_methods"]
                return "YAML 표기: 자동화 가능" + (f" — 방식: {', '.join(ms)}" if ms else "")
            return None

        if len(names) > 1:
            systems = []
            for nm in names:
                s = {"name": nm, "method": PENDING}
                note = _note(nm)
                if note:
                    s["automation_note"] = note
                systems.append(s)
            out["systems"] = systems
        else:
            out["method"] = PENDING
            if names:
                out["description"] = (out["description"] + f" [시스템: {names[0]}]").strip()
            note = _note(names[0] if names else None)
            if note:
                out["automation_note"] = note
        if at == "system_write":
            out["approval_required"] = True
    return out


# ------------------------------------------------------------ task 빌드

def list_tasks(yaml_path, workflow_id=None):
    doc = _load(yaml_path)
    source_sha256 = _file_sha256(yaml_path)
    wfs = doc.get("workflows") or []
    if workflow_id:
        wfs = [w for w in wfs if w.get("id") == workflow_id]
    result = []
    for wf in wfs:
        counts = {}
        for n in wf.get("nodes", []):
            counts[n.get("task_id")] = counts.get(n.get("task_id"), 0) + 1
        for t in wf.get("tasks", []):
            # 원본 YAML 노드 수가 아니라 변환 후 실행 노드 수를 보여준다 — 변환에서
            # Parallel/Memo 등이 제거되고 합성 decision이 추가돼 수가 달라진다(실측
            # 10→7). 목록의 수와 --write 결과의 nodes가 어긋나면 사용자가 혼란.
            try:
                count = len(build_task(
                    yaml_path,
                    t["id"],
                    _doc=doc,
                    _source_sha256=source_sha256,
                )["nodes"])
            except Exception:
                count = counts.get(t["id"], 0)
            result.append({"display_index": len(result) + 1,
                           "id": t["id"], "name": t.get("name", ""),
                           "activity": wf.get("name", ""),
                           "node_count": count})
    return result


def task_selection(tasks):
    """task 개수에 맞는 상호작용 계약.

    선택 도구의 최대 항목 수는 호스트마다 다르다(Claude 4, Codex 3). 따라서
    5개 이상을 도구에 밀어 넣지 않도록 런타임이 금지하고, 2~4개도 실제 도구가
    지원할 때만 쓰게 한다. 자유 형식 번호 응답은 항상 채팅으로 받는다.
    """
    count = len(tasks)
    if count == 1:
        return {
            "mode": "auto",
            "selected_task_id": tasks[0]["id"],
            "instruction": "task가 하나뿐이므로 추가 질문 없이 이 task를 사용하세요.",
        }
    lines = [f"{item['display_index']}. {item['name'] or item['id']}"
             f" ({item['node_count']}개 노드)" for item in tasks]
    if 2 <= count <= 4:
        return {
            "mode": "choice_tool_if_supported",
            "option_count": count,
            "max_required_options": count,
            "fallback": "chat_numbered",
            "chat_lines": lines,
            "instruction": ("현재 호스트의 선택 도구가 이 개수를 지원할 때만 사용하세요. "
                            "지원 한도를 넘으면 chat_lines를 보여주고 번호를 채팅으로 받으세요."),
        }
    return {
        "mode": "chat_numbered",
        "option_count": count,
        "choice_tool_allowed": False,
        "chat_lines": lines,
        "reply_format": "<번호>",
        "instruction": ("선택 도구를 호출하지 마세요. chat_lines 전체를 채팅에 보여주고 "
                        "사용자가 번호로 답할 때까지 기다리세요."),
    }


def _keep(node):
    """v2가 실행 노드로 유지하는 원본 노드인가."""
    t = node.get("type")
    if t == "action":
        return True
    if t == "event":
        return node.get("event_type") == "signal"   # 알림 수신
    if t == "branch":
        return node.get("logic_type") == "if_else"  # If만 평탄화 대상이다.
    return False


def _contract_targets(target, kept, dropped_end, outs_raw, seen=None):
    """드롭된 노드를 관통해 실제 대상(들)을 반환한다. end는 None이 된다."""
    seen = seen or set()
    if target in seen:
        return []
    seen.add(target)
    if target in kept:
        return [target]
    if target in dropped_end:
        return [None]
    result = []
    for next_target in outs_raw.get(target, []):
        result.extend(
            _contract_targets(next_target, kept, dropped_end, outs_raw, seen)
        )
    return result or [None]


def _reaches(frm, to, edges):
    """방향 그래프에서 frm이 to에 도달하는지 확인한다."""
    adjacency = {}
    for source, target in edges:
        adjacency.setdefault(source, set()).add(target)
    seen, stack = set(), [frm]
    while stack:
        current = stack.pop()
        if current == to:
            return True
        if current in seen:
            continue
        seen.add(current)
        stack.extend(adjacency.get(current, ()))
    return False


def _topological_order(kept, dag, original_order):
    """원본 순서를 안정적인 tie-breaker로 사용하는 Kahn 위상 정렬."""
    indegree = {node_id: 0 for node_id in kept}
    adjacency = {}
    for source, target in set(dag):
        adjacency.setdefault(source, set()).add(target)
    for targets in adjacency.values():
        for target in targets:
            indegree[target] += 1

    ready = sorted(
        [node_id for node_id, degree in indegree.items() if degree == 0],
        key=original_order.__getitem__,
    )
    order = []
    while ready:
        current = ready.pop(0)
        order.append(current)
        for target in sorted(
            adjacency.get(current, ()), key=original_order.__getitem__
        ):
            indegree[target] -= 1
            if indegree[target] == 0:
                ready.append(target)
        ready.sort(key=original_order.__getitem__)

    # 사이클 잔여(비정상 데이터)는 기존과 같이 원본 순서를 보존한다.
    order.extend(
        sorted(kept - set(order), key=original_order.__getitem__)
    )
    return order


def build_task(yaml_path, task_id, _doc=None, _source_sha256=None,
               _schema_version="2.2"):
    doc = _doc if _doc is not None else _load(yaml_path)
    wf = _find_workflow(doc, task_id)
    all_nodes = wf.get("nodes", [])
    nodes_by_id = {n["id"]: n for n in all_nodes}
    task_of = {n["id"]: n.get("task_id") for n in all_nodes}
    in_task = [n for n in all_nodes if n.get("task_id") == task_id]
    order0 = {n["id"]: i for i, n in enumerate(in_task)}
    kept = {n["id"] for n in in_task if _keep(n)}
    dropped_end = {n["id"] for n in in_task
                   if n.get("type") == "event" and n.get("event_type") == "end"}

    in_ids = {n["id"] for n in in_task}
    edges = [e for e in wf.get("edges", [])
             if e.get("source") in in_ids and e.get("target") in in_ids]
    outs_raw = {}
    for e in edges:
        outs_raw.setdefault(e["source"], []).append(e["target"])
    # Parallel 등 드롭되는 branch의 fan-out은 edges가 아니라 cases[].target_node_id에만
    # 기록된다(실측: 형상관리 YAML의 parallel_1_1). 흐름 관통(contract)을 위해 outs_raw에
    # 흡수하고, fork(가지)→join(계속 흐름) 순서 정보를 따로 기억한다.
    forks = []  # (가지 진입 id들, 계속 흐름 진입 id들) — contract 이전 원시 id
    for n in in_task:
        if n.get("type") != "branch" or n.get("logic_type") == "if_else":
            continue
        cont = list(outs_raw.get(n["id"], []))
        heads = [c.get("target_node_id") for c in (n.get("cases") or [])
                 if c.get("target_node_id") in in_ids]
        # A dropped Parallel node represents a fork followed by its outgoing
        # continuation. Contracting the continuation first can turn
        # If -> Parallel -> deciding action into an immediate self-loop,
        # skipping every branch head. Visit the branch heads first.
        ordered_targets = []
        for tgt in heads + cont:
            if tgt not in ordered_targets:
                ordered_targets.append(tgt)
        outs_raw[n["id"]] = ordered_targets
        if heads and (cont or _schema_version == "2.2"):
            forks.append((heads, cont))

    def contract(target, seen=None):
        return _contract_targets(target, kept, dropped_end, outs_raw, seen)

    def contracted_targets(node_id):
        targets = []
        for raw_target in outs_raw.get(node_id, []):
            for target in contract(raw_target):
                if target not in targets:
                    targets.append(target)
        return targets

    # 순서 결정용 DAG (If의 나가는 엣지는 명시 라우팅이므로 제외)
    if_ids = {n["id"] for n in in_task
              if n.get("type") == "branch" and n.get("logic_type") == "if_else"}
    dag = []
    control_dag = []
    for n in in_task:
        if not _keep(n) and n.get("type") != "branch":
            continue
        src = n["id"]
        if src in if_ids or src not in kept:
            continue
        for t in outs_raw.get(src, []):
            for ct in contract(t):
                if ct and ct != src:
                    dag.append((src, ct))
                    control_dag.append((src, ct))
    # 드롭 branch의 fork-join: 가지들은 계속 흐름보다 앞서 실행되어야 한다
    for heads, cont in forks:
        head_set = {h for raw in heads for h in contract(raw) if h}
        for raw in cont:
            for c in contract(raw):
                if c and c not in head_set:
                    for h in head_set:
                        dag.append((h, c))
    # 데이터 의존: input_mapping의 생산 노드는 소비 노드보다 앞서야 한다
    # (실측: Parallel fan-out이 edges에 없어 배열 순서만으로는 소비가 생산을 앞질렀다)
    for n in in_task:
        if n["id"] not in kept or n["id"] in if_ids:
            continue
        for m in (n.get("input_mapping") or []):
            match = _SOURCE_RE.match(m.get("source", ""))
            if match and match.group(1) in kept and match.group(1) != n["id"]:
                dag.append((match.group(1), n["id"]))
    # If의 전방 case 대상은 If보다 뒤에 배치되어야 한다 — 엔진은 배열 순서+점프로
    # 실행하므로, If보다 앞에 놓인 대상은 라우팅 전에 무조건 실행된다
    # (실측: 판단→등록→If 순서로 배치되어 등록 노드가 무한 반복). 단, 대상이 이미
    # If에 도달 가능하면 의도된 루프백(재시도)이므로 엣지를 넣지 않는다.
    for n in in_task:
        if n["id"] not in if_ids:
            continue
        for c in _raw_cases(n, edges):
            if not c["target"]:
                continue
            for ct in contract(c["target"]):
                if ct and ct != n["id"] and not _reaches(ct, n["id"], set(dag)):
                    dag.append((n["id"], ct))
                    control_dag.append((n["id"], ct))

    # 제거되는 Parallel은 기존 변환기와 동일하게 케이스를 배열 순서대로 실행한 뒤
    # continuation으로 이동한다. 케이스 자체에 명시 edge가 없을 때만 이 연결을 쓴다.
    # 실제 tail successor를 topo와 case reachability가 함께 사용해야 배열 배치와
    # 조건부 입력의 분기 소속이 서로 어긋나지 않는다.
    parallel_successor = {}
    for raw_heads, raw_cont in forks:
        heads = []
        for raw_head in raw_heads:
            for target in contract(raw_head):
                if target is not None and target not in heads:
                    heads.append(target)
        conts = []
        for raw_target in raw_cont:
            for target in contract(raw_target):
                if target not in conts:
                    conts.append(target)
        chain = heads + conts[:1]
        boundaries = set(chain)
        for head, successor in zip(chain, chain[1:]):
            seen, pending = set(), [head]
            while pending:
                current = pending.pop()
                if current in seen:
                    continue
                seen.add(current)
                targets = [target for target in contracted_targets(current)
                           if target is not None]
                internal = [target for target in targets
                            if target not in boundaries]
                pending.extend(internal)
                if not targets:
                    parallel_successor[current] = successor
    if _schema_version == "2.2":
        dag.extend(parallel_successor.items())
        control_dag.extend(parallel_successor.items())

    order = _topological_order(kept, dag, order0)
    order_index = {node_id: i for i, node_id in enumerate(order)}

    # If의 직전 노드가 실제 decision이 아니면 변환 결과에 합성 decision이
    # 삽입된다. 이후 출력 경로가 원본 If를 직접 가리키면 합성 decision을
    # 건너뛰므로, 변환 결과에서 사용할 진입점을 미리 확정한다.
    synthetic_if_entry = {}
    for raw_if in (node for node in in_task if node["id"] in if_ids):
        decided = _derive_decided_by(edges, nodes_by_id, raw_if["id"])
        decided_is_decision = (decided in kept
                               and classify(nodes_by_id[decided]) == "decision")
        if not decided_is_decision:
            synthetic_if_entry[raw_if["id"]] = f"decide_for_{raw_if['id']}"

    emission_order = list(order)
    for raw_if in (node for node in in_task if node["id"] in if_ids):
        if _schema_version != "2.2":
            break
        if raw_if["id"] in synthetic_if_entry:
            continue
        decided = _derive_decided_by(edges, nodes_by_id, raw_if["id"])
        if decided not in emission_order or raw_if["id"] not in emission_order:
            continue
        emission_order.remove(raw_if["id"])
        emission_order.insert(emission_order.index(decided) + 1, raw_if["id"])

    execution_order = []
    for node_id in emission_order:
        if node_id in synthetic_if_entry:
            execution_order.append(synthetic_if_entry[node_id])
        execution_order.append(node_id)
    execution_index = {node_id: i for i, node_id in enumerate(execution_order)}

    def emitted_entry(target):
        if _schema_version != "2.2":
            return target
        return synthetic_if_entry.get(target, target)

    intended_successor = {}
    for node_id in order:
        if node_id in if_ids:
            continue
        raw_targets = list(outs_raw.get(node_id, []))
        targets = contracted_targets(node_id)
        if len(raw_targets) > 1:
            if _schema_version == "2.2":
                raise ValueError(
                    f"[{node_id}] 일반 실행 노드의 다음 경로가 여러 개라 자동 변환할 수 없습니다"
                )
            intended_successor[node_id] = None
            continue
        if len(targets) > 1:
            # 단일 edge가 제거된 Parallel을 통과하면 첫 실행 케이스가 진입점이다.
            intended_successor[node_id] = min(
                (target for target in targets if target is not None),
                key=order_index.get,
                default=None,
            )
        elif targets:
            intended_successor[node_id] = targets[0]
        elif node_id in parallel_successor:
            intended_successor[node_id] = parallel_successor[node_id]
        else:
            intended_successor[node_id] = None

    control_adjacency = {}
    for source, target in control_dag:
        control_adjacency.setdefault(source, set()).add(target)

    def reachable_from(start, blocked=()):
        blocked = set(blocked)
        seen, pending = set(), [start]
        while pending:
            current = pending.pop()
            if current is None or current in seen or current in blocked:
                continue
            seen.add(current)
            pending.extend(control_adjacency.get(current, ()))
        return seen

    case_reachability = {}
    for raw_if in (node for node in in_task if node["id"] in if_ids):
        decided = _derive_decided_by(edges, nodes_by_id, raw_if["id"])
        # case 경로가 재작업 루프로 판단/If에 돌아오면 그 이후는 다음 분기
        # 활성화다. 현재 case 영역에 포함하면 분기 전 입력이나 다른 case 노드를
        # 현재 case의 출력으로 잘못 분류한다.
        branch_boundary = {raw_if["id"]}
        if decided:
            branch_boundary.add(decided)
        cases = []
        for case in _raw_cases(raw_if, edges):
            targets = contract(case["target"]) if case["target"] else []
            entry = min(
                (target for target in targets if target in order_index),
                key=order_index.get,
                default=None,
            )
            cases.append((case["value"], reachable_from(
                entry, blocked=branch_boundary)))
        case_reachability[raw_if["id"]] = cases

    def conditional_when(source_id, consumer_id):
        if _schema_version != "2.2":
            return None
        candidates = []
        for if_id, cases in case_reachability.items():
            source_labels = [label for label, reachable in cases
                             if source_id in reachable]
            consumer_labels = [label for label, reachable in cases
                               if consumer_id in reachable]
            if len(source_labels) == 1 and len(consumer_labels) >= 2:
                candidates.append({"if_node": if_id, "value": source_labels[0]})
        if len(candidates) > 1:
            raise ValueError(
                f"[{consumer_id}] [{source_id}] 입력이 어느 분기의 결과인지 하나로 결정할 수 없습니다"
            )
        return candidates[0] if candidates else None

    # If 라벨 사전 채움: decision id → 후속 If의 case 값들
    if_labels = {}
    for n in in_task:
        if n["id"] in if_ids:
            decided = _derive_decided_by(edges, nodes_by_id, n["id"])
            if decided:
                if_labels[decided] = [c["value"] for c in _raw_cases(n, edges) if c["value"]]

    # 노드 변환 + 입력/inputs_from
    inputs_from, from_names = [], {}
    converted = []
    for nid in emission_order:
        raw = nodes_by_id[nid]
        if nid in if_ids:
            decided = _derive_decided_by(edges, nodes_by_id, nid)
            cases = []
            for c in _raw_cases(raw, edges):
                targets = contract(c["target"]) if c["target"] else [None]
                reachable = [target for target in targets if target in order_index]
                next_id = min(reachable, key=order_index.get) if reachable else None
                next_id = emitted_entry(next_id)
                cases.append({"value": c["value"], "next": next_id})
            # If의 근거가 decision 노드가 아니면(조회 노드·start 이벤트 등) 합성 decision을
            # If 바로 앞에 삽입 — 라벨을 내는 판단 주체가 반드시 존재하게 만든다.
            synth_id = synthetic_if_entry.get(nid)
            if synth_id:
                synth_inputs = []
                if decided in kept:
                    for f in _schema_fields((nodes_by_id[decided] or {}).get("output_schema")):
                        synth_inputs.append({"field": f["name"],
                                             "source": f"$.nodes.{decided}.output.{f['id']}"})
                converted.append({
                    "id": synth_id,
                    "name": (raw.get("name") or nid) + " 판단",
                    "action_type": "decision",
                    "description": "If 분기의 근거 라벨을 내기 위해 변환기가 삽입한 판단 노드",
                    "inputs": synth_inputs,
                    "outputs": [],
                    "io_confirmed": PENDING,
                    "custom_logic": None,
                    "prompt": PENDING,
                    "labels": [c["value"] for c in cases if c["value"]],
                })
                decided = synth_id
            converted.append({"id": nid, "type": "if", "name": raw.get("name") or nid,
                              "source_node": decided, "cases": cases})
            continue
        node = _convert_action(raw, if_labels)
        if _schema_version == "2.2":
            successor = emitted_entry(intended_successor[nid])
            emitted_position = execution_index[nid]
            array_next = execution_order[emitted_position + 1] \
                if emitted_position + 1 < len(execution_order) else None
            if successor is None:
                node["next"] = None
            elif successor != array_next:
                node["next"] = successor
        for m in (raw.get("input_mapping") or []):
            match = _SOURCE_RE.match(m.get("source", ""))
            label = _field_label(raw, m.get("target_field", ""))
            if not match:
                continue
            src_id, src_field = match.group(1), match.group(2)
            if src_id in kept:
                binding = {"field": label,
                           "source": f"$.nodes.{src_id}.output.{src_field}"}
                if _schema_version == "2.2":
                    when = conditional_when(src_id, nid)
                    if when is not None:
                        binding["when"] = when
                node["inputs"].append(binding)
            else:
                name = label
                seq = 2
                while name in from_names and from_names[name] != (src_id, src_field):
                    name = f"{label} ({seq})"
                    seq += 1
                if name not in from_names:
                    from_names[name] = (src_id, src_field)
                    inputs_from.append({
                        "from_task": task_of.get(src_id) or PENDING,
                        "from_node": src_id,
                        "from_field": src_field,
                        "name": name,
                        "description": (nodes_by_id.get(src_id) or {}).get("name", ""),
                    })
                node["inputs"].append({"field": label, "source": f"$.inputs_from.{name}"})
        converted.append(node)

    task_meta = next((t for t in wf.get("tasks", []) if t.get("id") == task_id), {})
    return {
        "schema_version": _schema_version,
        "activity": wf.get("name", ""),
        "task_id": task_id,
        "task_name": task_meta.get("name", ""),
        "author": os.getenv("USERNAME") or os.getenv("USER") or PENDING,
        "created_at": datetime.date.today().isoformat(),
        "source_yaml": os.path.basename(yaml_path),
        "source_yaml_sha256": (
            _source_sha256
            if _source_sha256 is not None else _file_sha256(yaml_path)
        ),
        "source_task_id": task_id,
        "max_auto_steps_per_pump": 500,
        # 노드 구성 확인 게이트 — 사용자가 구성(추가·삭제·순서·분기)을 예/아니오로
        # 확정하기 전에는 노드 정보 질답을 시작하지 못하게 도구 수준에서 강제한다.
        # false인 동안 author_questions는 구성 확인만 내보내고, 검증기는 불합격 처리.
        "structure_confirmed": False,
        "inputs_from": inputs_from,
        "nodes": converted,
        "_edges_checked": sorted({(s, t) for s, t in dag}),
    }


def _sanitize(name):
    s = re.sub(r"\s+", "", str(name))
    return re.sub(r'[\\/:*?"<>|]', "-", s)


def default_out_path(task):
    """workflows/<활동>/<task 이름>.json — 파일명은 사람이 읽는 식별자다.

    엔진은 파일명을 파싱하지 않고 JSON 안의 task_id 필드만 쓰므로 이름 기반이
    안전하다. 같은 폴더에 동명이지만 다른 task의 산출물이 이미 있으면(이름 중복)
    task_id를 붙여 구분한다 — 같은 task의 재변환은 같은 경로로 돌아와 덮는다."""
    base = os.path.join("workflows", _sanitize(task["activity"]))
    stem = _sanitize(task.get("task_name") or "") or task["task_id"]
    path = os.path.join(base, f"{stem}.json")
    if os.path.exists(path):
        try:
            existing_id = util.load_json(path).get("task_id")
        except Exception:
            existing_id = None
        if existing_id != task["task_id"]:
            return os.path.join(base, f"{stem}__{task['task_id']}.json")
    return path


@mutation_lock.serialized_path_mutation(path_arg=0, path_kw="out_path")
def write_task_json(out_path, task):
    """직접 CLI와 서비스 계층이 공유하는 직렬화된 task 초안 저장."""
    util.atomic_write_json(out_path, task)
    return {"status": "ok", "written": out_path}


def incomplete_runs(task, runs_dir=workspace.RUNS_DIR):
    """이 task의 미완료 run 파일 목록 — 덮어쓰기 경고에 사용한다."""
    import glob
    dirs = [runs_dir] + (["runs"] if runs_dir == workspace.RUNS_DIR else [])
    found = []
    paths = []
    for folder in dirs:
        pattern = os.path.join(folder, f"{_sanitize(task['activity'])}__{task['task_id']}__*.json")
        paths.extend(glob.glob(pattern))
    for p in paths:
        try:
            if util.load_json(p).get("status") != "done":
                found.append(os.path.basename(p))
        except Exception:
            found.append(os.path.basename(p))
    return found


# ------------------------------------------------------------ CLI

def main(argv=None):
    util.utf8_stdout()
    p = argparse.ArgumentParser(description="YAML → task JSON 초안 (AI 에이전트의 /e2e-agent-creator가 실행)")
    p.add_argument("yaml_path")
    p.add_argument("--list", action="store_true", help="task 목록 출력")
    p.add_argument("--task", help="변환할 task id")
    p.add_argument("--out", help="저장 경로 (기본: workflows/<활동>/<task 이름>.json)")
    p.add_argument("--write", action="store_true", help="파일로 저장")
    p.add_argument("--force", action="store_true",
                   help="기존 산출물 덮어쓰기 허용 (사용자 확인 후에만)")
    args = p.parse_args(argv)

    if args.list or not args.task:
        tasks = list_tasks(args.yaml_path)
        print(json.dumps({"status": "ok", "tasks": tasks,
                          "selection": task_selection(tasks)},
                         ensure_ascii=False, indent=2))
        return 0

    task = build_task(args.yaml_path, args.task)
    task.pop("_edges_checked", None)
    if args.write or args.out:
        out = args.out or default_out_path(task)
        if os.path.exists(out) and not args.force:
            try:
                existing = util.load_json(out)
            except Exception:
                existing = {}
            old_hash = existing.get("source_yaml_sha256")
            new_hash = task.get("source_yaml_sha256")
            accepted_source_hashes = util.source_yaml_hashes(args.yaml_path)
            if (existing.get("task_id") == task.get("task_id") and old_hash
                    and old_hash in accepted_source_hashes):
                print(json.dumps({
                    "status": "exists_same_source",
                    "task_json": out,
                    "source_yaml_sha256": new_hash,
                    "next_action": {
                        "type": "modify_existing_task",
                        "command": f'python ops_runtime/author_questions.py "{out}"',
                    },
                    "instruction": ("동일한 YAML에서 만든 기존 task입니다. 재변환하지 말고 "
                                    "기존 task 수정 모드로 진행하세요."),
                }, ensure_ascii=False, indent=2))
                return 0
            if old_hash and old_hash not in accepted_source_hashes:
                print(json.dumps({
                    "error": f"원본 YAML이 기존 task 생성 이후 변경되었습니다: {out}",
                    "status": "source_changed",
                    "existing_source_yaml_sha256": old_hash,
                    "current_source_yaml_sha256": new_hash,
                    "instruction": ("기존 저작 내용을 유지할지, 변경된 YAML로 명시적으로 "
                                    "재변환할지 사용자에게 확인하세요. 재변환은 --force일 때만 가능합니다."),
                }, ensure_ascii=False, indent=2))
                return 1
            print(json.dumps({
                "error": f"이미 산출물이 있습니다: {out}",
                "incomplete_runs": incomplete_runs(task),
                "instruction": ("덮어쓰면 기존 저작 내용(질답으로 채운 값)이 사라지고, "
                                "진행 중인 건(incomplete_runs)은 재개할 수 없게 된다. "
                                "사용자에게 이 사실을 알리고 덮어쓸지 확인받은 뒤에만 "
                                "--force를 붙여 다시 실행하라."),
            }, ensure_ascii=False, indent=2))
            return 1
        write_result = write_task_json(out, task)
        if write_result.get("status") != "ok":
            print(json.dumps(write_result, ensure_ascii=False, indent=2))
            return 1
        pending = json.dumps(task, ensure_ascii=False).count(PENDING)
        print(json.dumps({"written": out, "nodes": len(task["nodes"]),
                          "pending_markers": pending,
                          "next": "/e2e-agent-creator 질답으로 __미정__ 항목을 채운 뒤 /e2e-agent-validator 실행"},
                         ensure_ascii=False, indent=2))
    else:
        print(json.dumps(task, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
