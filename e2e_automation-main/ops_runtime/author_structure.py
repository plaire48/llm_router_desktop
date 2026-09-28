# -*- coding: utf-8 -*-
"""task 노드 구성과 입출력 연결을 편집하는 정적 HTML 화면을 만든다.

노드 이름·타입·순서와 판단 분기를 편집하며, Connected Creator에서는 입출력과
값 전달 경로도 함께 확정한다. Standalone 모드는 편집 결과를 클립보드로 전달하고,
Connected 모드는 같은 내용을 서버에 직접 제출한다.
"""
import html
import json
import os
import sys

if __package__ in (None, ""):
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from ops_runtime.author_form import CSS_TOKENS
    from ops_runtime.engine import ACTION_TYPE_KO, _task_fingerprint
    from ops_runtime import references, workspace
else:
    from .author_form import CSS_TOKENS
    from .engine import ACTION_TYPE_KO, _task_fingerprint
    from . import references, workspace


def _esc(s):
    return html.escape(str(s), quote=True)


def _editor_state(task):
    """편집기 초기 상태 — If는 행이 아니라 소속 decision의 branches로 접는다."""
    ifs = {n.get("source_node"): n for n in task.get("nodes", [])
           if n.get("type") == "if"}
    when_case_indexes = {
        (if_node.get("id"), case.get("value")): index
        for if_node in ifs.values()
        for index, case in enumerate(if_node.get("cases") or [])
        if isinstance(case, dict)
    }
    roots = {
        item.get("name"): item
        for item in (task.get("inputs_from") or [])
        if isinstance(item, dict) and item.get("name")
    }
    rows = []
    for n in task.get("nodes", []):
        if n.get("type") == "if":
            continue
        row = {"id": n.get("id"), "name": n.get("name") or n.get("id", ""),
               "action_type": n.get("action_type"),
               "orig_type": n.get("action_type"),
               "orig_branches": [],
               "branches": [],
               "if_id": None,
               "branch_enabled": False,
               "next_present": "next" in n,
               "next": n.get("next"),
               "inputs": [],
               "outputs": [
                   {"id": output.get("id"),
                    "name": output.get("name") or output.get("id", "")}
                   for output in (n.get("outputs") or [])
                   if isinstance(output, dict)
               ],
               "type_ko": ACTION_TYPE_KO.get(n.get("action_type"), "?")}
        for spec in n.get("inputs") or []:
            if not isinstance(spec, dict):
                continue
            source = str(spec.get("source") or "")
            source_resolution = references.resolve_output_source(task, source)
            source_ambiguous = bool(
                source_resolution
                and source_resolution.get("kind") in (
                    "ambiguous_output_name", "duplicate_output_id")
            )
            if (source_resolution
                    and source_resolution.get("kind") == "legacy_name"):
                # 화면에서 다시 저장할 때부터는 표시 이름이 아니라 안정적인 출력 ID를
                # 사용한다. 같은 이름의 후보가 여럿이면 추정하지 않고 재선택을 요구한다.
                source = source_resolution["canonical"]
            root = {}
            if source.startswith("$.inputs_from."):
                root = roots.get(source[len("$.inputs_from."):]) or {}
            # 과거 구조 편집기가 만든 깨진 임시 입력은 통합 설계 화면에서
            # 되살리지 않는다. 새 삭제 흐름은 생산자 삭제 시 연결 입력도 지운다.
            if root.get("source_status") == "removed_producer":
                continue
            source_ref = None
            previous_label = None
            if all(root.get(key) for key in
                   ("from_task", "from_node", "from_field")):
                source_ref = {
                    "from_task": root["from_task"],
                    "from_node": root["from_node"],
                    "from_field": root["from_field"],
                }
                previous_label = root.get("description")
            when = (dict(spec.get("when"))
                    if isinstance(spec.get("when"), dict) else None)
            row["inputs"].append({
                "field": spec.get("field") or "",
                "original_field": spec.get("field") or "",
                "source": source,
                "source_ref": source_ref,
                "previous_label": previous_label,
                "source_ambiguous": source_ambiguous,
                "when": when,
                "when_case_index": (
                    when_case_indexes.get((when.get("if_node"), when.get("value")))
                    if when else None
                ),
                "when_case_key": (
                    f"case:{when_case_indexes[(when.get('if_node'), when.get('value'))]}"
                    if when and (when.get("if_node"), when.get("value"))
                    in when_case_indexes else None
                ),
            })
        ifn = ifs.get(n.get("id"))
        if n.get("action_type") == "decision":
            branches = ([{"label": c.get("value", ""), "next": c.get("next"),
                          "orig_index": index, "case_key": f"case:{index}"}
                         for index, c in enumerate(ifn.get("cases", []))]
                        if ifn else [])
            row["branches"] = branches
            row["if_id"] = ifn.get("id") if ifn else None
            row["orig_branches"] = [
                {"label": branch["label"], "next": branch["next"],
                 "orig_index": branch["orig_index"]}
                for branch in branches
            ]
            row["branch_enabled"] = bool(branches)
            if branches:
                # 분기 판단의 후속은 If 하나뿐이다. 과거 일반 next는 편집 상태에도
                # 가져오지 않아 분기를 다시 꺼도 몰래 복원되지 않게 한다.
                row["next_present"] = False
                row["next"] = None
        rows.append(row)
    return rows


_CSS = CSS_TOKENS + """
*{box-sizing:border-box}
body{font-family:'Malgun Gothic','맑은 고딕','Apple SD Gothic Neo','Segoe UI',sans-serif;
  margin:0;background:var(--paper);color:var(--ink);
  line-height:var(--lh);font-size:var(--fs-base)}
#topbar{position:sticky;top:0;z-index:10;background:var(--card);
  border-bottom:1px solid var(--line);padding:8px 20px;display:flex;
  align-items:center;gap:12px;flex-wrap:wrap}
#topbar .eyebrow{font-size:var(--fs-xs);letter-spacing:.18em;color:var(--accent);
  font-weight:bold}
#topbar h1{font-size:1.15em;margin:0;display:inline-block}
#topbar .grow{flex:1}
#confirm{font-size:1em;font-weight:bold;padding:7px 24px;cursor:pointer;
  background:var(--accent);color:#fff;border:0;border-radius:var(--radius)}
#confirm:hover{background:#0f1f7d}
main{max-width:880px;margin:0 auto;padding:var(--sp-4) var(--sp-4) 80px}
.intro{color:var(--muted);font-size:var(--fs-sm);margin-top:0}
#addtop{margin:0 0 var(--sp-2)}
.node-row{background:var(--card);border:1px solid var(--line);
  border-radius:var(--radius);padding:8px 12px;margin:0 0 var(--sp-2)}
.node-row.deleted{opacity:.55;background:var(--paper)}
.node-row.deleted .row-head input[type=text]{text-decoration:line-through}
.row-head{display:flex;gap:8px;align-items:center}
.no{flex:none;width:20px;height:20px;border-radius:50%;background:var(--accent);
  color:#fff;font-size:.72em;display:inline-flex;align-items:center;
  justify-content:center}
.node-row.deleted .no{background:var(--muted)}
.type-badge{flex:none;font-size:var(--fs-xs);font-weight:bold;color:var(--accent);
  background:var(--tint);border:1px solid var(--accent);border-radius:var(--radius);
  padding:1px 7px;white-space:nowrap}
.type-badge.type-changed{color:var(--attn);border-color:var(--attn);
  background:var(--card)}
select.type{flex:none;font:inherit;padding:3px 6px;border:1px solid var(--line);
  border-radius:var(--radius)}
.row-head input[type=text]{flex:1;font:inherit;padding:4px 9px;
  border:1px solid var(--line);border-radius:var(--radius);min-width:0}
.row-head input.bad{border-color:var(--attn);box-shadow:inset 2px 0 0 var(--attn)}
.ops{flex:none;display:flex;gap:4px}
.ops button{font:inherit;font-size:var(--fs-sm);padding:3px 8px;cursor:pointer;
  background:var(--card);border:1px solid var(--line);border-radius:var(--radius)}
.ops button:hover{border-color:var(--accent);color:var(--accent)}
.branches{margin:var(--sp-2) 0 0 28px;border-top:1px dashed var(--line);
  padding-top:var(--sp-2)}
.branch-toggle{display:flex;align-items:center;gap:8px;font-size:var(--fs-sm);
  font-weight:bold;color:var(--ink);cursor:pointer}
.branch-toggle input{width:16px;height:16px;accent-color:var(--accent)}
.branch-list{margin-top:var(--sp-2)}
.branch{display:flex;gap:6px;align-items:center;margin:3px 0}
.branch input{flex:1;font:inherit;padding:3px 8px;border:1px solid var(--line);
  border-radius:var(--radius);min-width:0}
.branch input.bad{border-color:var(--attn)}
.branch .arrow{color:var(--muted);flex:none}
.branch select{flex:1;font:inherit;padding:3px 6px;border:1px solid var(--line);
  border-radius:var(--radius);min-width:0}
.branch button{flex:none;font:inherit;font-size:var(--fs-sm);padding:2px 8px;
  cursor:pointer;background:var(--card);border:1px solid var(--line);
  border-radius:var(--radius)}
.badd{margin-top:var(--sp-1)}
.note{color:var(--muted);font-size:var(--fs-sm)}
.route-editor{margin:var(--sp-2) 0 0 28px;border:1px solid var(--line);
  border-radius:var(--radius);background:var(--paper);overflow:hidden}
.route-summary{position:relative;display:grid;grid-template-columns:minmax(0,1fr) auto;
  gap:10px;align-items:center;padding:8px 10px}
.route-broken{border-color:var(--attn)}
.route-copy{display:flex;align-items:center;gap:7px;min-width:0}
.route-kicker{display:inline-block;flex:none;color:var(--muted);
  font-size:var(--fs-xs);font-weight:bold;line-height:1.25;white-space:nowrap}
.route-kicker::after{content:'|';margin-left:7px;color:var(--line)}
.route-destination{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  display:block;color:var(--accent);font-size:var(--fs-sm);font-weight:bold}
.route-edit{display:inline-flex;align-items:center;color:var(--accent);
  font-size:var(--fs-xs);font-weight:bold;white-space:nowrap;border-radius:var(--radius)}
.route-edit::before{content:'|';margin-right:7px;color:var(--line)}
.route-edit::after{content:'▾';display:inline-block;margin-left:5px;font-size:1.05em}
.route-edit:hover{background:var(--tint)}
.route-edit:focus-within{outline:2px solid var(--accent);outline-offset:2px}
.route-direct-select{position:absolute;inset:0;width:100%;height:100%;
  opacity:0;cursor:pointer;font-size:16px;
  clip-path:inset(0 0 0 calc(100% - 84px))}
@media(pointer:coarse){.route-edit{min-width:64px;min-height:44px;
  justify-content:center}}
.io-section{--io-cols:minmax(140px,.72fr) 20px minmax(230px,1.28fr) 36px;
  margin:var(--sp-2) 0 0 28px;border-top:1px dashed var(--line);
  padding-top:var(--sp-2)}
.io-title{font-size:var(--fs-sm);font-weight:bold;color:var(--muted);
  margin:7px 0 4px}
.input-head,.input-row{display:grid;grid-template-columns:var(--io-cols);
  gap:6px;align-items:center}
.input-head{margin:0 0 3px;font-size:var(--fs-xs);color:var(--muted)}
.input-row{margin:5px 0}
.input-row input,.source-trigger,.output-chip input{font:inherit;min-width:0;
  border:1px solid var(--line);border-radius:var(--radius);background:var(--card)}
.input-row input{padding:6px 9px}
.io-arrow{color:var(--muted);text-align:center}
.source-trigger{display:flex;align-items:center;gap:6px;padding:6px 10px;
  text-align:left;cursor:pointer;min-width:0;overflow:hidden}
.source-trigger:hover,.source-trigger:focus{border-color:var(--accent);color:var(--accent)}
.source-badge{flex:none;padding:1px 6px;border:1px solid var(--accent);
  border-radius:999px;background:var(--tint);color:var(--accent);
  font-size:var(--fs-xs);font-weight:bold}
.source-no{flex:none;width:18px;height:18px;border-radius:50%;background:var(--accent);
  color:#fff;font-size:var(--fs-xs);font-weight:bold;display:inline-flex;
  align-items:center;justify-content:center}
.source-node{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  font-weight:bold}
.source-sep{flex:none;color:var(--muted)}
.source-field{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;
  white-space:nowrap;padding:1px 7px;border-radius:999px;background:var(--tint);
  color:var(--accent);font-size:var(--fs-xs)}
.source-trigger.source-empty{border-style:dashed;border-color:var(--attn);
  color:var(--attn)}
.source-pick{font-size:var(--fs-sm);font-weight:bold}
.io-del{width:36px;height:34px;padding:0;border:1px solid var(--line);
  border-radius:var(--radius);background:var(--card);cursor:pointer;font:inherit}
.io-del:hover{border-color:var(--attn);color:var(--attn)}
.io-add{font:inherit;font-size:var(--fs-sm);color:var(--accent);
  border:1px solid var(--accent);border-radius:var(--radius);background:var(--card);
  padding:4px 10px;cursor:pointer;margin:3px 0}
.output-list{display:flex;flex-wrap:wrap;gap:7px}
.output-chip{display:flex;align-items:center;min-width:180px;max-width:100%;
  border:1px solid var(--line);border-radius:var(--radius);background:var(--paper)}
.output-duplicate{display:inline-flex;align-items:center;justify-content:center;flex:none;
  min-width:21px;height:21px;margin-left:7px;padding:0 5px;border-radius:999px;
  background:var(--tint);color:var(--accent);font-size:var(--fs-xs);font-weight:bold}
.output-chip input{border:0;background:transparent;padding:7px 9px;flex:1}
.output-chip .io-del{border:0;border-left:1px solid var(--line);border-radius:0;
  width:34px}
.modal{max-width:720px;width:calc(100% - 32px);border:1px solid var(--line);
  border-radius:var(--radius);padding:20px;background:var(--card);color:var(--ink);
  box-shadow:0 16px 48px rgba(15,31,125,.22)}
.modal::backdrop{background:rgba(20,24,40,.35)}
.modal h2{font-size:1.05em;margin:0 0 var(--sp-2)}
.picker-specials{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:var(--sp-2)}
.picker-specials button,.picker-tab{font:inherit;padding:6px 10px;cursor:pointer;
  border:1px solid var(--line);border-radius:var(--radius);background:var(--card)}
.picker-specials button:hover,.picker-tab.active{border-color:var(--accent);
  color:var(--accent);background:var(--tint)}
.picker-tabs{display:flex;gap:6px;margin:0 0 var(--sp-2)}
.picker-columns{display:grid;grid-template-columns:minmax(220px,.9fr) minmax(260px,1.1fr);
  gap:10px;min-height:250px}
.picker-pane{border:1px solid var(--line);border-radius:var(--radius);padding:8px;
  overflow:auto;max-height:360px}
.picker-pane h3{font-size:var(--fs-sm);margin:0 0 6px;color:var(--muted)}
.picker-node,.picker-output{display:block;width:100%;font:inherit;text-align:left;
  padding:7px 9px;margin:3px 0;border:1px solid transparent;border-radius:var(--radius);
  background:var(--card);cursor:pointer}
.picker-node:hover,.picker-node:focus,.picker-node.active,
.picker-output:hover,.picker-output:focus{border-color:var(--accent);background:var(--tint)}
.picker-empty{color:var(--muted);font-size:var(--fs-sm);padding:8px}
#delete-summary{margin:0 0 var(--sp-2);color:var(--muted)}
#delete-input-list{display:grid;gap:8px;margin:0 0 var(--sp-3)}
.delete-node-group{border:1px solid var(--line);border-radius:var(--radius);
  padding:9px 11px;background:var(--paper)}
.delete-node-head{display:flex;align-items:center;gap:6px;min-width:0}
.delete-node-no{display:inline-flex;align-items:center;justify-content:center;flex:none;
  width:21px;height:21px;border-radius:50%;background:var(--accent);color:#fff;
  font-size:var(--fs-xs);font-weight:bold}
.delete-node-type{flex:none;padding:1px 6px;border:1px solid var(--accent);
  border-radius:999px;color:var(--accent);font-size:var(--fs-xs);font-weight:bold}
.delete-node-name{font-weight:bold;overflow:hidden;text-overflow:ellipsis;
  white-space:nowrap}
.delete-fields{display:flex;flex-wrap:wrap;gap:5px;margin-top:7px}
.delete-field{padding:2px 7px;border:1px solid var(--line);border-radius:999px;
  background:var(--card);font-size:var(--fs-xs)}
#delete-connected{background:var(--accent);color:#fff;border-color:var(--accent);
  font-weight:bold}
#draft-wait{position:fixed;inset:0;z-index:50;background:var(--paper);
  display:flex;align-items:center;justify-content:center;padding:24px;text-align:center}
#draft-wait[hidden]{display:none}
.wait-card{max-width:560px;background:var(--card);border:1px solid var(--line);
  border-radius:var(--radius);padding:32px;box-shadow:0 14px 40px rgba(15,31,125,.14)}
.wait-status-icon{display:flex;align-items:center;justify-content:center;width:42px;
  height:42px;margin:0 auto 18px;border-radius:50%;background:var(--tint);
  color:var(--accent);font-size:1.45em;font-weight:bold}
.wait-status-icon.loading{background:transparent;border:4px solid var(--tint);
  border-top-color:var(--accent);font-size:0;animation:wait-spin .8s linear infinite}
@keyframes wait-spin{to{transform:rotate(360deg)}}
@media(max-width:700px){
  .route-editor,.io-section{margin-left:0}
  .io-section{--io-cols:1fr 40px}
  .input-head,.io-arrow{display:none}
  .input-row .input-name{grid-column:1/-1}
  .picker-columns{grid-template-columns:1fr}
}
button.add-after{display:block;margin:0 0 var(--sp-2);font:inherit;
  font-size:var(--fs-sm);color:var(--muted);background:none;border:1px dashed
  var(--line);border-radius:var(--radius);width:100%;padding:3px;cursor:pointer}
button.add-after:hover{color:var(--accent);border-color:var(--accent)}
#guide-btn{font-size:var(--fs-sm);padding:7px 16px;cursor:pointer;
  background:var(--card);color:var(--accent);border:1px solid var(--accent);
  border-radius:var(--radius)}
#guide-btn:hover{background:var(--tint)}
#guide-dialog{max-width:620px}
#guide-dialog h3{font-size:var(--fs-sm);margin:var(--sp-3) 0 4px}
#guide-dialog p{font-size:var(--fs-sm);margin:0;line-height:1.55}
.guide-example{display:grid;grid-template-columns:76px 1fr;gap:8px;
  align-items:start;font-size:var(--fs-sm);margin-top:7px}
.guide-example b{color:var(--accent)}
#validation-dialog{max-width:620px;max-height:calc(100vh - 32px);overflow:auto}
#validation-dialog>p{font-size:var(--fs-sm);color:var(--muted);margin:0 0 var(--sp-2)}
#validation-list{display:grid;gap:12px}
.validation-group{border-left:3px solid var(--attn);padding:2px 0 2px 12px}
.validation-group h3{font-size:var(--fs-sm);margin:0 0 5px}
.validation-group ul{font-size:var(--fs-sm);margin:0;padding-left:20px}
.validation-group li{margin:4px 0;line-height:1.5;white-space:normal;
  overflow-wrap:anywhere}
[aria-invalid=true]{border-color:var(--attn)!important;
  box-shadow:inset 2px 0 0 var(--attn)}
#result{background:var(--card);border:1px solid var(--line);
  border-radius:var(--radius);padding:12px 16px;margin-top:var(--sp-3)}
#result textarea{width:100%;min-height:150px;font-family:var(--mono);
  font-size:.92em;border:1px solid var(--line);border-radius:var(--radius)}
#warn{font-weight:bold;margin-top:0;color:var(--attn)}
#copy,#save{padding:5px 16px;border:1px solid var(--accent);color:var(--accent);
  background:var(--card);border-radius:var(--radius);cursor:pointer}
#copy-msg{color:var(--muted);font-size:var(--fs-sm);margin-left:8px}
#change-dialog{max-width:560px}
#change-dialog::backdrop{background:rgba(20,24,40,.35)}
#change-dialog h2{font-size:1.05em;margin:0 0 var(--sp-2)}
#change-list{font-size:var(--fs-sm);margin:0 0 var(--sp-3)}
.change-item{margin:5px 0}
#submission-error-message{margin:0 0 var(--sp-3);white-space:pre-wrap;
  overflow-wrap:anywhere}
.dialog-actions{display:flex;justify-content:flex-end;gap:8px}
.dialog-actions button{font:inherit;padding:7px 16px;border-radius:var(--radius);
  cursor:pointer;border:1px solid var(--line);background:var(--card)}
#change-accept{background:var(--accent);border-color:var(--accent);color:#fff;
  font-weight:bold}
"""

_JS = """
var state = JSON.parse(document.getElementById('state').textContent);
var TYPES = JSON.parse(document.getElementById('types').textContent);
var newSeq = state.reduce(function (max, row) {
  var match = /^new_(\\d+)$/.exec(String(row.id || ''));
  return match ? Math.max(max, Number(match[1])) : max;
}, 0);
var newCaseSeq = 0;

function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function alive() { return state.filter(function (r) { return !r.deleted; }); }

function targetOptions(selfId, cur) {
  var opts = ['<option value=""' + (cur ? '' : ' selected') + '>(종료)</option>'];
  var no = 0;
  var currentAvailable = !cur;
  var unavailableReason = '';
  state.forEach(function (r) {
    if (r.deleted) return;
    no += 1;
    if (r.id === selfId) {
      if (cur === selfId) unavailableReason = '현재 판단 노드를 다시 가리킴';
      return;   // 자기 자신 분기는 즉시 무한 루프 — 정상 선택지에서는 제외
    }
    if (cur === r.id) currentAvailable = true;
    opts.push('<option value="' + esc(r.id) + '"' + (cur === r.id ? ' selected' : '') +
              '>' + no + '. ' + esc(r.name || '(이름 없음)') + '</option>');
  });
  if (cur && !currentAvailable) {
    var unavailable = state.filter(function (r) { return r.id === cur; })[0];
    var reason = unavailableReason || (
      unavailable && unavailable.deleted
        ? '삭제된 노드: ' + (unavailable.name || unavailable.id)
        : '존재하지 않는 대상 노드'
    );
    opts.unshift('<option value="' + esc(cur) + '" selected disabled>'
      + '⚠ 잘못된 연결 — ' + esc(reason) + '</option>');
  }
  return opts.join('');
}

function nextTargetOptions(selfId, cur, present, sequentialTargetId) {
  var selectedTarget = present ? cur : sequentialTargetId;
  var opts = [
    '<option value="mode:end"' + (present && cur === null ? ' selected' : '')
      + '>다음 단계 없음</option>'
  ];
  var no = 0;
  var currentAvailable = selectedTarget === null;
  var unavailableReason = '';
  state.forEach(function (r) {
    if (r.deleted) return;
    no += 1;
    if (r.id === selfId) {
      if (selectedTarget === selfId) unavailableReason = '현재 노드를 다시 가리킴';
      return;
    }
    if (selectedTarget === r.id) currentAvailable = true;
    opts.push('<option value="node:' + encodeURIComponent(r.id) + '"'
              + (selectedTarget === r.id ? ' selected' : '') +
              '>' + no + ') ' + esc(r.name || '(이름 없음)') + '</option>');
  });
  if (selectedTarget !== null && !currentAvailable) {
    var unavailable = state.filter(function (r) { return r.id === selectedTarget; })[0];
    var reason = unavailableReason || (
      unavailable && unavailable.deleted
        ? '삭제된 노드: ' + (unavailable.name || unavailable.id)
        : '존재하지 않는 대상 노드'
    );
    opts.unshift('<option value="node:' + encodeURIComponent(selectedTarget) + '" selected disabled>'
      + '⚠ 잘못된 연결 — ' + esc(reason) + '</option>');
  }
  return opts.join('');
}

function nodeOutputSource(nodeId, outputId) {
  return '$.nodes.' + nodeId + '.output.' + outputId;
}

function visibleNodeNo(nodeId) {
  var no = 0;
  for (var i = 0; i < state.length; i += 1) {
    if (state[i].deleted) continue;
    no += 1;
    if (state[i].id === nodeId) return no;
  }
  return null;
}

function outputNameMatches(row, name) {
  return (row && row.outputs || []).filter(function (output) {
    return String(output.name || '') === String(name || '');
  });
}

function outputDisplayLabel(row, output) {
  var name = output.name || output.id;
  var matches = outputNameMatches(row, name);
  if (matches.length < 2) return name;
  return name + ' · ' + (matches.indexOf(output) + 1) + '번째';
}

function currentSourceResolution(input) {
  var source = String(input.source || '');
  var match = /^\\$\\.nodes\\.([^.]+)\\.output\\.(.+)$/.exec(source);
  if (!match) return null;
  var producer = state.filter(function (row) { return row.id === match[1]; })[0];
  if (!producer) return { kind: 'missing', source: source };
  if (input.source_ambiguous) {
    return {
      kind: 'ambiguous',
      producer: producer,
      field: match[2],
      matches: outputNameMatches(producer, match[2])
    };
  }
  var outputs = producer.outputs || [];
  var idMatches = outputs.filter(function (item) {
    return String(item.id || '') === match[2];
  });
  if (idMatches.length === 1) {
    return { kind: 'resolved', producer: producer, output: idMatches[0] };
  }
  if (idMatches.length > 1) {
    return { kind: 'ambiguous', producer: producer, field: match[2],
      matches: idMatches };
  }
  var nameMatches = outputNameMatches(producer, match[2]);
  if (nameMatches.length === 1) {
    return { kind: 'resolved', producer: producer, output: nameMatches[0],
      legacy: true };
  }
  if (nameMatches.length > 1) {
    return { kind: 'ambiguous', producer: producer, field: match[2],
      matches: nameMatches };
  }
  return { kind: 'missing', producer: producer, field: match[2] };
}

function sourceRecord(input) {
  var source = String(input.source || '');
  if (input.source_ref) {
    var previous = String(input.previous_label || '');
    var marker = previous.lastIndexOf(' · ');
    return {
      kind: 'previous',
      badge: '이전 Task',
      node: marker >= 0 ? previous.slice(0, marker)
        : (previous || input.source_ref.from_node),
      field: marker >= 0 ? previous.slice(marker + 3) : input.source_ref.from_field
    };
  }
  if (source === '__external__' || source.indexOf('$.inputs_from.') === 0) {
    return { kind: 'external', badge: '사용자 입력',
      node: '실행 시작 시 받기', field: '' };
  }
  if (source === '$.key') {
    return { kind: 'key', badge: '건 ID', node: '자동 전달', field: '' };
  }
  var resolution = currentSourceResolution(input);
  if (resolution && resolution.kind === 'ambiguous') {
    return {
      kind: 'ambiguous',
      badge: '연결 확인',
      node: (resolution.producer &&
             (resolution.producer.name || resolution.producer.id)) || '선행 노드',
      field: '동일한 이름의 출력 ' + (resolution.matches || []).length + '개'
    };
  }
  if (resolution && resolution.kind === 'resolved') {
    var producer = resolution.producer;
    var output = resolution.output;
    var no = visibleNodeNo(producer.id);
    return {
      kind: 'current',
      no: no,
      badge: producer.type_ko || typeName(producer.action_type),
      node: producer.name || producer.id,
      field: outputDisplayLabel(producer, output)
    };
  }
  return { kind: 'empty', badge: '', node: '', field: '' };
}

function sourceHtml(input) {
  var record = sourceRecord(input);
  if (record.kind === 'empty') {
    return '<span class="source-pick">＋ 출처 선택하기</span>';
  }
  if (record.kind === 'ambiguous') {
    return '<span class="source-badge">' + esc(record.badge) + '</span>'
      + '<span class="source-node">' + esc(record.node) + '</span>'
      + '<span class="source-sep">›</span><span class="source-pick">'
      + '출처 다시 선택하기</span>';
  }
  var head = record.kind === 'current' && record.no
    ? '<span class="source-no">' + esc(String(record.no)) + '</span>'
    : '<span class="source-badge">' + esc(record.badge) + '</span>';
  var field = record.field
    ? '<span class="source-sep">›</span><span class="source-field">'
      + esc(record.field) + '</span>'
    : '';
  return head + '<span class="source-node">' + esc(record.node) + '</span>' + field;
}

function sourceTitle(input) {
  var record = sourceRecord(input);
  if (record.kind === 'empty') return '값을 가져올 출처를 선택해 주세요';
  if (record.kind === 'ambiguous') {
    return '같은 이름의 출력이 여러 개입니다. 사용할 출처를 다시 선택해 주세요.';
  }
  var head = record.kind === 'current' && record.no
    ? record.no + '번 노드 ‘' + record.node + '’(' + record.badge + ')'
    : record.badge + ' · ' + record.node;
  return record.field ? head + '의 출력 ‘' + record.field + '’' : head;
}

function ioHtml(row, rowIndex) {
  function inputRow(input, inputIndex) {
    var sourceKind = sourceRecord(input).kind;
    var needsSource = sourceKind === 'empty' || sourceKind === 'ambiguous';
    return '<div class="input-row">'
      + '<input class="input-name" data-i="' + rowIndex + '" data-ii="' + inputIndex
      + '" value="' + esc(input.field || '')
      + '" placeholder="입력 필드 이름">'
      + '<span class="io-arrow" aria-hidden="true">←</span>'
      + '<button class="source-trigger' + (needsSource ? ' source-empty' : '')
      + '" type="button" title="' + esc(sourceTitle(input))
      + '" data-act="source" data-i="'
      + rowIndex + '" data-ii="' + inputIndex + '">'
      + sourceHtml(input) + '</button>'
      + '<button class="io-del" type="button" data-act="idel" data-i="' + rowIndex
      + '" data-ii="' + inputIndex + '" aria-label="입력 삭제">−</button></div>';
  }

  var inputs = (row.inputs || []).map(function (input, inputIndex) {
    return inputRow(input, inputIndex);
  }).join('');
  var inputHead = (row.inputs || []).length
    ? '<div class="input-head"><span>입력 이름</span><span></span>'
      + '<span>값을 가져올 출처</span><span></span></div>'
    : '';
  var outputs = (row.outputs || []).map(function (output, outputIndex) {
    var duplicate = outputNameMatches(row, output.name).length > 1
      ? '<span class="output-duplicate" title="같은 이름의 출력 중 '
        + (outputNameMatches(row, output.name).indexOf(output) + 1)
        + '번째">('
        + (outputNameMatches(row, output.name).indexOf(output) + 1)
        + ')</span>'
      : '';
    return '<div class="output-chip">'
      + duplicate
      + '<input class="output-name" data-i="' + rowIndex + '" data-oi="' + outputIndex
      + '" value="' + esc(output.name || '') + '" placeholder="출력 필드 이름">'
      + '<button class="io-del" type="button" data-act="odel" data-i="' + rowIndex
      + '" data-oi="' + outputIndex + '" aria-label="출력 삭제">−</button></div>';
  }).join('');
  return '<div class="io-section">'
    + '<div class="io-title">입력</div>' + inputHead
    + '<div class="input-list">' + inputs + '</div>'
    + '<button class="io-add" type="button" data-act="iadd" data-i="' + rowIndex
    + '">＋ 입력 추가</button>'
    + '<div class="io-title">출력</div><div class="output-list">' + outputs + '</div>'
    + '<button class="io-add" type="button" data-act="oadd" data-i="' + rowIndex
    + '">＋ 출력 추가</button></div>';
}

// 목록 전체를 innerHTML로 다시 그리기 때문에 포커스와 스크롤이 매번 날아갔다.
// 출력 이름을 고치고 Tab을 누르면 포커스가 <body>로 튕기던 원인이다.
function focusDescriptor(element) {
  var host = document.getElementById('rows');
  if (!element || !host || !element.getAttribute || !host.contains(element)) return null;
  var parts = [element.tagName.toLowerCase()];
  var className = (element.getAttribute('class') || '').trim();
  var names = className.split(' ').filter(function (name) { return name; });
  if (names.length) parts.push('.' + names.join('.'));
  ['data-i', 'data-ii', 'data-oi', 'data-bi', 'data-k', 'data-act'].forEach(function (name) {
    var value = element.getAttribute(name);
    if (value !== null) parts.push('[' + name + '="' + value + '"]');
  });
  return parts.join('');
}

function restoreFocus(host, descriptor, selection) {
  if (!descriptor) return;
  // 포커스가 실제로 사라졌을 때만 되돌린다. Tab으로 다음 칸에 이미 옮겨간 뒤라면
  // 여기서 되돌리는 순간 사용자를 원래 칸에 가둬 Tab 이동을 막게 된다.
  var now = document.activeElement;
  if (now && now !== document.body && now !== document.documentElement) return;
  var target = null;
  try { target = host.querySelector(descriptor); } catch (_error) { return; }
  if (!target) return;
  try { target.focus({ preventScroll: true }); } catch (_error) { target.focus(); }
  if (selection && typeof target.setSelectionRange === 'function') {
    try { target.setSelectionRange(selection[0], selection[1]); } catch (_error) {}
  }
}

function captureImplicitRoutes() {
  return state.filter(function (row) {
    return !row.deleted && !row.next_present && !effectiveBranches(row).length;
  }).map(function (row) {
    var successors = controlSuccessors(row);
    return { id: row.id, target: successors.length ? successors[0] : null };
  });
}

function pinImplicitRoutes(routes) {
  routes.forEach(function (route) {
    var row = state.filter(function (candidate) {
      return !candidate.deleted && candidate.id === route.id;
    })[0];
    if (!row || row.next_present || effectiveBranches(row).length) return;
    var successors = controlSuccessors(row);
    var current = successors.length ? successors[0] : null;
    if (current !== route.target) {
      row.next_present = true;
      row.next = route.target;
    }
  });
}

function render() {
  var host = document.getElementById('rows');
  var active = document.activeElement;
  var descriptor = focusDescriptor(active);
  var selection = active && typeof active.selectionStart === 'number'
    ? [active.selectionStart, active.selectionEnd] : null;
  var scrollY = window.pageYOffset || document.documentElement.scrollTop || 0;
  var htmlParts = [];
  var no = 0;
  state.forEach(function (r, i) {
    var del = r.deleted;
    if (!del) no += 1;
    var head = ['<div class="row-head">'];
    head.push('<span class="no">' + (del ? '-' : no) + '</span>');
    var sel = TYPES.map(function (t) {
      return '<option value="' + t[0] + '"' + (r.action_type === t[0] ? ' selected' : '') +
             '>' + esc(t[1]) + '</option>';
    }).join('');
    head.push('<select class="type" data-i="' + i + '"' + (del ? ' disabled' : '') +
              '>' + sel + '</select>');
    if (!r.isnew && r.orig_type && r.action_type !== r.orig_type) {
      var ot = TYPES.filter(function (x) { return x[0] === r.orig_type; })[0];
      head.push('<span class="type-badge type-changed">원래: ' +
                esc(ot ? ot[1] : r.orig_type) + '</span>');
    }
    head.push('<input type="text" data-i="' + i + '" data-k="name" value="' +
              esc(r.name) + '" placeholder="노드 이름(필수)"' + (del ? ' disabled' : '') + '>');
    head.push('<span class="ops">');
    if (del) {
      head.push('<button data-act="restore" data-i="' + i + '">복원</button>');
    } else {
      head.push('<button data-act="up" data-i="' + i + '" title="위로">▲</button>');
      head.push('<button data-act="down" data-i="' + i + '" title="아래로">▼</button>');
      head.push('<button data-act="del" data-i="' + i + '" title="삭제">🗑</button>');
    }
    head.push('</span></div>');
    var box = ['<div class="node-row' + (del ? ' deleted' : '') + '">' + head.join('')];
    if (!del && r.action_type === 'decision') {
      var b = ['<div class="branches"><label class="branch-toggle">'
               + '<input type="checkbox" data-i="' + i + '" data-k="branch_enabled"'
               + (r.branch_enabled ? ' checked' : '') + '>'
               + '<span>판단 결과에 따라 다음 작업 나누기</span></label>'];
      if (r.branch_enabled) {
        b.push('<div class="branch-list">');
        (r.branches || []).forEach(function (br, bi) {
          b.push('<div class="branch">'
            + '<input type="text" data-i="' + i + '" data-bi="' + bi +
              '" data-k="blabel" value="' + esc(br.label)
              + '" placeholder="판단 결과 예: 영향 있음">'
            + '<span class="arrow">→</span>'
            + '<select data-i="' + i + '" data-bi="' + bi + '" data-k="bnext">'
            + targetOptions(r.id, br.next) + '</select>'
            + '<button data-act="bdel" data-i="' + i + '" data-bi="' + bi
            + '">삭제</button>'
            + '</div>');
        });
        b.push('<button class="badd" data-act="badd" data-i="' + i
               + '">+ 판단 결과 추가</button></div>');
      }
      b.push('</div>');
      box.push(b.join(''));
    }
    if (!del && !(r.action_type === 'decision' && r.branch_enabled)) {
      var sequentialTarget = null;
      for (var nextIndex = i + 1; nextIndex < state.length; nextIndex += 1) {
        if (!state[nextIndex].deleted) {
          sequentialTarget = state[nextIndex];
          break;
        }
      }
      var nextTarget = state.filter(function (candidate) {
        return candidate.id === r.next && !candidate.deleted;
      })[0];
      var showRoute = Boolean(sequentialTarget)
        || (r.next_present && r.next !== null);
      if (showRoute) {
        var displayedTarget = !r.next_present ? sequentialTarget : nextTarget;
        var nextLabel = r.next_present && r.next === null
          ? '다음 단계 없음' : visibleNodeLabel(displayedTarget);
        var routeClass = r.next_present && r.next === null
          ? 'route-end' : displayedTarget ? 'route-linked' : 'route-broken';
        box.push('<div class="route-editor ' + routeClass + '">'
          + '<div class="route-summary"><span class="route-copy">'
          + '<span class="route-kicker">다음 단계</span>'
          + '<strong class="route-destination">' + esc(nextLabel) + '</strong>'
          + '</span><span class="route-edit"><span aria-hidden="true">변경</span>'
          + '<select class="route-direct-select" data-i="' + i
          + '" data-k="next" aria-label="다음 단계 변경">'
          + nextTargetOptions(r.id, r.next, r.next_present,
              sequentialTarget ? sequentialTarget.id : null)
          + '</select></span></div></div>');
      }
    }
    if (!del && CONNECTED) box.push(ioHtml(r, i));
    box.push('</div>');
    htmlParts.push(box.join(''));
    htmlParts.push('<button class="add-after" data-act="add" data-i="' + i +
                   '">➕ 여기에 노드 추가</button>');
  });
  host.innerHTML = htmlParts.join('');
  restoreFocus(host, descriptor, selection);
  window.scrollTo(0, scrollY);
}

function newNode() {
  newSeq += 1;
  return { id: 'new_' + newSeq, name: '', action_type: 'system_read',
           orig_type: null, orig_branches: [], branches: [],
           branch_enabled: false, next_present: false, next: null,
           inputs: [], outputs: [],
           type_ko: '시스템 조회', isnew: true };
}

document.getElementById('addtop').addEventListener('click', function () {
  state.unshift(newNode());
  render();
});

var pendingDelete = null;
var pickerTarget = null;
var pickerMode = 'current';
var pickerSelectedNode = null;

function connectedInputs(predicate) {
  var affected = [];
  state.forEach(function (consumer, consumerIndex) {
    if (consumer.deleted) return;
    (consumer.inputs || []).forEach(function (input, inputIndex) {
      if (predicate(String(input.source || ''), input)) {
        affected.push({
          consumerIndex: consumerIndex,
          inputIndex: inputIndex,
          nodeNo: visibleNodeNo(consumer.id),
          nodeType: consumer.type_ko || typeName(consumer.action_type),
          nodeName: consumer.name || consumer.id,
          field: input.field || '(이름 없음)'
        });
      }
    });
  });
  return affected;
}

function nodeConnections(nodeId) {
  var prefix = '$.nodes.' + nodeId + '.output.';
  return connectedInputs(function (source) { return source.indexOf(prefix) === 0; });
}

function conditionalConnections(ifId) {
  if (!ifId) return [];
  return connectedInputs(function (source, input) {
    return Boolean(input.when && input.when.if_node === ifId);
  });
}

function mergeConnections() {
  var merged = [];
  var seen = Object.create(null);
  Array.prototype.slice.call(arguments).forEach(function (items) {
    (items || []).forEach(function (item) {
      var key = item.consumerIndex + ':' + item.inputIndex;
      if (seen[key]) return;
      seen[key] = true;
      merged.push(item);
    });
  });
  return merged;
}

function nodeDeletionConnections(row) {
  return mergeConnections(
    nodeConnections(row.id), conditionalConnections(row.if_id));
}

function removeConditionalInputs(ifId) {
  if (!ifId) return;
  state.forEach(function (consumer) {
    consumer.inputs = (consumer.inputs || []).filter(function (input) {
      return !(input.when && input.when.if_node === ifId);
    });
  });
}

function outputConnections(nodeId, output) {
  var producer = state.filter(function (row) { return row.id === nodeId; })[0];
  var values = [nodeOutputSource(nodeId, output.id)];
  if (outputNameMatches(producer, output.name).length === 1) {
    values.push(nodeOutputSource(nodeId, output.name));
  }
  return connectedInputs(function (source) { return values.indexOf(source) >= 0; });
}

function ambiguousOutputConnections(nodeId, output) {
  var producer = state.filter(function (row) { return row.id === nodeId; })[0];
  if (outputNameMatches(producer, output.name).length < 2) return [];
  var legacySource = nodeOutputSource(nodeId, output.name);
  return connectedInputs(function (source, input) {
    return source === legacySource && Boolean(input.source_ambiguous);
  });
}

function removeAffectedInputs(affected) {
  var grouped = {};
  affected.forEach(function (item) {
    (grouped[item.consumerIndex] = grouped[item.consumerIndex] || [])
      .push(item.inputIndex);
  });
  Object.keys(grouped).forEach(function (key) {
    var row = state[parseInt(key, 10)];
    grouped[key].sort(function (a, b) { return b - a; }).forEach(function (index) {
      row.inputs.splice(index, 1);
    });
  });
}

function completePendingDelete() {
  if (!pendingDelete) return;
  removeAffectedInputs(pendingDelete.affected || []);
  if (pendingDelete.kind === 'node') {
    var row = state[pendingDelete.rowIndex];
    if (row.isnew) state.splice(pendingDelete.rowIndex, 1);
    else row.deleted = true;
  } else if (pendingDelete.kind === 'output') {
    state[pendingDelete.rowIndex].outputs.splice(pendingDelete.outputIndex, 1);
  }
  pendingDelete = null;
  render();
}

function requestConnectedDelete(request) {
  if (!request.affected.length) {
    pendingDelete = request;
    completePendingDelete();
    return;
  }
  pendingDelete = request;
  var target = state[request.rowIndex];
  var targetName = request.kind === 'output'
    ? outputDisplayLabel(
        target, target.outputs[request.outputIndex] || { name: '(이름 없는 출력)' })
    : (target.name || target.id);
  document.getElementById('delete-title').textContent =
    '‘' + targetName + '’ ' + (request.kind === 'output' ? '출력을' : '노드를')
      + ' 삭제할까요?';
  document.getElementById('delete-summary').textContent =
    (request.kind === 'output' ? '이 출력을' : '이 노드의 출력을')
      + ' 사용하는 입력 ' + request.affected.length + '개도 함께 삭제됩니다.';
  var list = document.getElementById('delete-input-list');
  list.textContent = '';
  var groups = [];
  var byConsumer = Object.create(null);
  request.affected.forEach(function (item) {
    var key = String(item.consumerIndex);
    var group = byConsumer[key];
    if (!group) {
      group = { item: item, fields: [] };
      byConsumer[key] = group;
      groups.push(group);
    }
    group.fields.push(item.field);
  });
  groups.forEach(function (group) {
    var section = document.createElement('section');
    section.className = 'delete-node-group';
    var heading = document.createElement('div');
    heading.className = 'delete-node-head';
    var no = document.createElement('span');
    no.className = 'delete-node-no';
    no.textContent = String(group.item.nodeNo || '?');
    var type = document.createElement('span');
    type.className = 'delete-node-type';
    type.textContent = group.item.nodeType;
    var name = document.createElement('span');
    name.className = 'delete-node-name';
    name.textContent = group.item.nodeName;
    heading.appendChild(no);
    heading.appendChild(type);
    heading.appendChild(name);
    var fields = document.createElement('div');
    fields.className = 'delete-fields';
    group.fields.forEach(function (field) {
      var chip = document.createElement('span');
      chip.className = 'delete-field';
      chip.textContent = field;
      fields.appendChild(chip);
    });
    section.appendChild(heading);
    section.appendChild(fields);
    list.appendChild(section);
  });
  document.getElementById('delete-connected').textContent =
    (request.kind === 'output' ? '출력과 ' : '노드와 ')
      + '연결된 입력 ' + request.affected.length + '개 삭제';
  var dialog = document.getElementById('delete-dialog');
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

function nextOutputId(row) {
  var used = {};
  (row.outputs || []).forEach(function (item) { used[item.id] = true; });
  var seq = 1;
  while (used['output_' + seq]) seq += 1;
  return 'output_' + seq;
}

document.getElementById('rows').addEventListener('click', function (e) {
  var actionTarget = e.target.closest('[data-act]');
  if (!actionTarget || !e.currentTarget.contains(actionTarget)) return;
  var act = actionTarget.dataset.act;
  var i = parseInt(actionTarget.dataset.i, 10);
  var r = state[i];
  if (act === 'up' || act === 'down') {
    var routes = captureImplicitRoutes();
    // 삭제된 행을 건너뛰고 살아 있는 이웃과 교환한다
    var j = i + (act === 'up' ? -1 : 1);
    while (j >= 0 && j < state.length && state[j].deleted) j += (act === 'up' ? -1 : 1);
    if (j >= 0 && j < state.length) {
      state[i] = state[j]; state[j] = r;
      pinImplicitRoutes(routes);
    }
  } else if (act === 'del') {
    if (!CONNECTED) {
      if (r.isnew) state.splice(i, 1);
      else r.deleted = true;
    } else {
      requestConnectedDelete({
        kind: 'node', rowIndex: i, affected: nodeDeletionConnections(r)
      });
      return;
    }
  } else if (act === 'restore') {
    r.deleted = false;
  } else if (act === 'add') {
    state.splice(i + 1, 0, newNode());
  } else if (act === 'iadd') {
    (r.inputs = r.inputs || []).push({
      field: '', original_field: '', source: '__external__',
      source_ref: null, previous_label: null, auto_name: true
    });
  } else if (act === 'idel') {
    r.inputs.splice(parseInt(actionTarget.dataset.ii, 10), 1);
  } else if (act === 'oadd') {
    (r.outputs = r.outputs || []).push({
      id: nextOutputId(r), name: ''
    });
  } else if (act === 'odel') {
    var oi = parseInt(actionTarget.dataset.oi, 10);
    var output = r.outputs[oi];
    var ambiguous = ambiguousOutputConnections(r.id, output);
    if (ambiguous.length) {
      var ambiguityProblems = [];
      ambiguous.forEach(function (item) {
        var consumer = state[item.consumerIndex];
        addValidationProblem(
          ambiguityProblems,
          consumer,
          alive().indexOf(consumer),
          '동일한 이름의 출력이 여러 개라 ‘' + item.field
            + '’ 입력의 출처를 먼저 다시 선택해야 합니다.',
          { kind: 'input-source', itemIndex: item.inputIndex });
      });
      openValidationDialog(ambiguityProblems);
      return;
    }
    requestConnectedDelete({
      kind: 'output', rowIndex: i, outputIndex: oi,
      affected: outputConnections(r.id, output)
    });
    return;
  } else if (act === 'source') {
    openSourcePicker(i, parseInt(actionTarget.dataset.ii, 10));
    return;
  } else if (act === 'badd') {
    r.branch_enabled = true;
    r.next_present = false;
    r.next = null;
    newCaseSeq += 1;
    (r.branches = r.branches || []).push({
      label: '', next: null, case_key: 'newcase:' + newCaseSeq
    });
  } else if (act === 'bdel') {
    var removedBranch = r.branches.splice(
      parseInt(actionTarget.dataset.bi, 10), 1)[0];
    state.forEach(function (consumer) {
      consumer.inputs = (consumer.inputs || []).filter(function (input) {
        if (!input.when || input.when.if_node !== r.if_id) return true;
        return input.when_case_key !== removedBranch.case_key;
      });
    });
    if (!r.branches.length) r.branch_enabled = false;
  } else { return; }
  render();
});

document.getElementById('rows').addEventListener('input', function (e) {
  var d = e.target.dataset || {};
  if (d.k === 'name') state[d.i].name = e.target.value;
  if (d.k === 'blabel') {
    var branch = state[d.i].branches[d.bi];
    branch.label = e.target.value;
    state.forEach(function (consumer) {
      (consumer.inputs || []).forEach(function (input) {
        if (input.when && input.when.if_node === state[d.i].if_id
            && input.when_case_key === branch.case_key) {
          input.when.value = e.target.value;
        }
      });
    });
  }
  if (e.target.classList.contains('input-name')) {
    state[d.i].inputs[d.ii].field = e.target.value;
    state[d.i].inputs[d.ii].auto_name = false;
  }
  if (e.target.classList.contains('output-name')) {
    var output = state[d.i].outputs[d.oi];
    var previousName = output.name;
    var previousNameCount = outputNameMatches(state[d.i], previousName).length;
    var previousIdCollision = (state[d.i].outputs || []).some(function (candidate) {
      return candidate !== output && String(candidate.id || '') === String(previousName || '');
    });
    output.name = e.target.value;
    if (CONNECTED && previousName && previousName !== output.name
        && previousNameCount === 1 && !previousIdCollision) {
      var previousSource = nodeOutputSource(state[d.i].id, previousName);
      var stableSource = nodeOutputSource(state[d.i].id, output.id);
      state.forEach(function (consumer) {
        (consumer.inputs || []).forEach(function (input) {
          if (input.source === previousSource) input.source = stableSource;
        });
      });
    }
  }
});
document.getElementById('rows').addEventListener('change', function (e) {
  var d = e.target.dataset || {};
  if (e.target.classList.contains('output-name')) {
    // blur/change 중 rows를 즉시 교체하면 사용자가 다음에 누른 출처 버튼의 click이
    // 사라질 수 있다. 현재 click 처리까지 끝난 뒤 표시만 갱신한다.
    window.setTimeout(render, 0);
    return;
  }
  if (d.k === 'bnext') {
    state[d.i].branches[d.bi].next = e.target.value || null;
    render();
    return;
  }
  if (d.k === 'next') {
    state[d.i].next_present = true;
    state[d.i].next = e.target.value === 'mode:end'
      ? null
      : decodeURIComponent(e.target.value.slice(5));
    render();
  }
  if (d.k === 'branch_enabled') {
    if (!e.target.checked) removeConditionalInputs(state[d.i].if_id);
    state[d.i].branch_enabled = e.target.checked;
    if (e.target.checked) {
      state[d.i].next_present = false;
      state[d.i].next = null;
      if (!state[d.i].branches.length) {
        state[d.i].branches.push({ label: '', next: null });
      }
    }
    render();
    return;
  }
  if (e.target.classList.contains('type')) {
    var r = state[d.i];
    if (r.action_type === 'decision' && e.target.value !== 'decision') {
      removeConditionalInputs(r.if_id);
    }
    r.action_type = e.target.value;
    var t = TYPES.filter(function (x) { return x[0] === r.action_type; })[0];
    r.type_ko = t ? t[1] : '?';
    // 비판단으로 바꿔도 branches는 상태에 남긴다 — decision으로 되돌리면 복원된다
    // (렌더·검증·확정 payload 모두 decision일 때만 branches를 쓰므로 안전)
    if (r.action_type === 'decision') {
      if (!r.branches) r.branches = [];
      if (typeof r.branch_enabled !== 'boolean') {
        r.branch_enabled = Boolean(r.branches.length);
      }
    }
    render();
  }
});

function closeDialog(id) {
  var dialog = document.getElementById(id);
  if (!dialog) return;
  if (typeof dialog.close === 'function' && dialog.open) dialog.close();
  else dialog.removeAttribute('open');
}

function availablePickerNodes() {
  var records = [];
  if (pickerMode === 'current') {
    var consumer = state[pickerTarget.rowIndex];
    state.forEach(function (row, index) {
      if (row.deleted
          || !sourceAllowedForInput(consumer, row)) return;
      var outputs = (row.outputs || []).filter(function (output) {
        return output.id && String(output.name || '').trim();
      }).map(function (output) {
        return {
          label: outputDisplayLabel(row, output),
          suggestedName: output.name || output.id,
          outputId: output.id,
          producerId: row.id,
          source: nodeOutputSource(row.id, output.id)
        };
      });
      if (outputs.length) {
        records.push({
          label: visibleNodeNo(row.id) + ' · '
            + (row.type_ko || typeName(row.action_type)) + ' · '
            + (row.name || row.id),
          outputs: outputs
        });
      }
    });
    return records;
  }
  (PREVIOUS_CATALOG.tasks || []).forEach(function (task) {
    (task.nodes || []).forEach(function (node) {
      var rawOutputs = node.outputs || [];
      var outputs = rawOutputs.map(function (output, outputIndex) {
        var outputName = output.field_name || output.field_id;
        var sameNameCount = rawOutputs.filter(function (candidate) {
          return (candidate.field_name || candidate.field_id) === outputName;
        }).length;
        var sameNameIndex = rawOutputs.slice(0, outputIndex + 1).filter(
          function (candidate) {
            return (candidate.field_name || candidate.field_id) === outputName;
          }).length;
        return {
          label: outputName + (sameNameCount > 1
            ? ' · ' + sameNameIndex + '번째' : ''),
          suggestedName: outputName,
          outputId: output.field_id,
          source: '__previous_task__',
          source_ref: {
            from_task: output.from_task || task.task_id,
            from_node: output.from_node || node.node_id,
            from_field: output.from_field || output.field_id
          },
          previous_label: (task.task_name || task.task_id) + ' · '
            + (node.node_name || node.node_id) + ' · '
            + (output.field_name || output.field_id)
        };
      });
      if (outputs.length) {
        records.push({
          label: (task.task_name || task.task_id) + ' · '
            + (node.node_name || node.node_id),
          outputs: outputs
        });
      }
    });
  });
  return records;
}

var pickerRecords = [];

function renderPickerOutputs(index) {
  pickerSelectedNode = index;
  var pane = document.getElementById('picker-outputs');
  var record = pickerRecords[index];
  document.querySelectorAll('.picker-node').forEach(function (button) {
    button.classList.toggle('active', parseInt(button.dataset.pi, 10) === index);
  });
  if (!record) {
    pane.innerHTML = '<div class="picker-empty">왼쪽에서 노드를 선택하세요.</div>';
    return;
  }
  pane.innerHTML = '<h3>' + esc(record.label) + '의 출력</h3>'
    + record.outputs.map(function (output, outputIndex) {
      return '<button class="picker-output" type="button" data-po="'
        + outputIndex + '">' + esc(output.label) + '</button>';
    }).join('');
}

function renderPickerNodes() {
  pickerRecords = availablePickerNodes();
  var pane = document.getElementById('picker-nodes');
  if (!pickerRecords.length) {
    pane.innerHTML = '<div class="picker-empty">선택할 수 있는 선행 노드가 없습니다.</div>';
    renderPickerOutputs(-1);
    return;
  }
  pane.innerHTML = pickerRecords.map(function (record, index) {
    return '<button class="picker-node" type="button" data-pi="' + index + '">'
      + esc(record.label) + '</button>';
  }).join('');
  renderPickerOutputs(0);
}

function openSourcePicker(rowIndex, inputIndex) {
  pickerTarget = { rowIndex: rowIndex, inputIndex: inputIndex };
  pickerMode = 'current';
  var specials = document.querySelector('.picker-specials');
  if (specials) specials.hidden = false;
  document.querySelectorAll('.picker-tab').forEach(function (button) {
    button.hidden = false;
    button.disabled = false;
    button.classList.toggle('active', button.dataset.mode === pickerMode);
  });
  renderPickerNodes();
  var dialog = document.getElementById('source-dialog');
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

function chooseSource(value, sourceRef, previousLabel, suggestedName, producerId) {
  if (!pickerTarget) return;
  var consumer = state[pickerTarget.rowIndex];
  var input = consumer.inputs[pickerTarget.inputIndex];
  input.source = value;
  input.source_ambiguous = false;
  input.source_ref = sourceRef || null;
  input.previous_label = previousLabel || null;
  var producer = producerId ? state.filter(function (row) {
    return !row.deleted && row.id === producerId;
  })[0] : null;
  var conditional = producer
    ? conditionalBindingForProducer(consumer, producer) : null;
  if (conditional) {
    input.when = conditional.when;
    input.when_case_index = conditional.caseIndex;
    input.when_case_key = conditional.caseKey;
  } else {
    delete input.when;
    delete input.when_case_index;
    delete input.when_case_key;
  }
  if (input.auto_name && suggestedName) {
    input.field = suggestedName;
  }
  pickerTarget = null;
  closeDialog('source-dialog');
  render();
}

document.getElementById('picker-nodes').addEventListener('mouseover', function (e) {
  if (e.target.classList.contains('picker-node')) {
    renderPickerOutputs(parseInt(e.target.dataset.pi, 10));
  }
});
document.getElementById('picker-nodes').addEventListener('focusin', function (e) {
  if (e.target.classList.contains('picker-node')) {
    renderPickerOutputs(parseInt(e.target.dataset.pi, 10));
  }
});
document.getElementById('picker-nodes').addEventListener('click', function (e) {
  if (e.target.classList.contains('picker-node')) {
    renderPickerOutputs(parseInt(e.target.dataset.pi, 10));
  }
});
document.getElementById('picker-outputs').addEventListener('click', function (e) {
  if (!e.target.classList.contains('picker-output')) return;
  var record = pickerRecords[pickerSelectedNode];
  var output = record && record.outputs[parseInt(e.target.dataset.po, 10)];
  if (output) {
    chooseSource(
      output.source, output.source_ref, output.previous_label,
      output.suggestedName || output.label, output.producerId);
  }
});
document.querySelectorAll('.picker-tab').forEach(function (button) {
  button.addEventListener('click', function () {
    pickerMode = button.dataset.mode;
    document.querySelectorAll('.picker-tab').forEach(function (candidate) {
      candidate.classList.toggle('active', candidate === button);
    });
    renderPickerNodes();
  });
});
document.querySelectorAll('[data-special-source]').forEach(function (button) {
  button.addEventListener('click', function () {
    chooseSource(button.dataset.specialSource, null, null, null);
  });
});
document.getElementById('picker-cancel').addEventListener('click', function () {
  pickerTarget = null;
  closeDialog('source-dialog');
});
document.getElementById('delete-cancel').addEventListener('click', function () {
  pendingDelete = null;
  closeDialog('delete-dialog');
});
document.getElementById('delete-connected').addEventListener('click', function () {
  closeDialog('delete-dialog');
  completePendingDelete();
});

function typeName(value) {
  var found = TYPES.filter(function (item) { return item[0] === value; })[0];
  return found ? found[1] : value;
}

function effectiveBranches(row) {
  if (row.action_type !== 'decision' || !row.branch_enabled) return [];
  return row.branches || [];
}

function visibleNodeLabel(row) {
  if (!row) return '연결 확인 필요';
  var no = visibleNodeNo(row.id);
  return (no === null ? '?' : no) + ') ' + (row.name || row.id);
}

function controlSuccessors(row) {
  var branches = effectiveBranches(row);
  if (branches.length) {
    return branches.map(function (branch) { return branch.next; }).filter(Boolean);
  }
  if (row.next_present) return row.next === null ? [] : [row.next];
  var index = state.indexOf(row);
  for (var nextIndex = index + 1; nextIndex < state.length; nextIndex += 1) {
    if (!state[nextIndex].deleted) return [state[nextIndex].id];
  }
  return [];
}

function reachesNode(start, target, blocked) {
  var pending = [start];
  var seen = Object.create(null);
  var blockedSet = Object.create(null);
  (blocked || []).forEach(function (id) { blockedSet[id] = true; });
  while (pending.length) {
    var current = pending.pop();
    if (current === target) return true;
    if (!current || seen[current] || blockedSet[current]) continue;
    seen[current] = true;
    var row = state.filter(function (candidate) {
      return !candidate.deleted && candidate.id === current;
    })[0];
    if (row) pending = pending.concat(controlSuccessors(row));
  }
  return false;
}

function producerPrecedesConsumer(start, producer, consumer, blocked) {
  var pending = [{ id: start, produced: false }];
  var seen = Object.create(null);
  var reachedConsumer = false;
  var blockedSet = Object.create(null);
  (blocked || []).forEach(function (id) { blockedSet[id] = true; });
  while (pending.length) {
    var cursor = pending.pop();
    var current = cursor.id;
    var key = current + '\\n' + (cursor.produced ? '1' : '0');
    if (!current || seen[key] || blockedSet[current]) continue;
    seen[key] = true;
    if (current === consumer) {
      if (!cursor.produced) return false;
      reachedConsumer = true;
      continue;
    }
    var produced = cursor.produced || current === producer;
    var row = state.filter(function (candidate) {
      return !candidate.deleted && candidate.id === current;
    })[0];
    if (row) controlSuccessors(row).forEach(function (successor) {
      pending.push({ id: successor, produced: produced });
    });
  }
  return reachedConsumer;
}

function conditionalBindingForProducer(consumer, producer) {
  var entry = state.filter(function (candidate) { return !candidate.deleted; })[0];
  var matches = [];
  state.forEach(function (decision) {
    if (decision.deleted || !decision.if_id
        || effectiveBranches(decision).length < 2) return;
    if (!entry || !producerPrecedesConsumer(
        entry.id, decision.id, consumer.id, [])) return;
    var reaching = effectiveBranches(decision).filter(function (branch) {
      return branch.next
        && reachesNode(branch.next, consumer.id, [decision.id]);
    });
    if (reaching.length < 2) return;
    var local = reaching.filter(function (branch) {
      return producerPrecedesConsumer(
        branch.next, producer.id, consumer.id, [decision.id]);
    });
    if (local.length === 1) {
      matches.push({ decision: decision, branch: local[0] });
    }
  });
  if (matches.length !== 1) return null;
  return {
    when: {
      if_node: matches[0].decision.if_id,
      value: matches[0].branch.label
    },
    caseIndex: matches[0].branch.orig_index,
    caseKey: matches[0].branch.case_key
  };
}

function sourceAllowedForInput(consumer, producer) {
  if (!consumer || !producer || producer.deleted) return false;
  if (conditionalBindingForProducer(consumer, producer)) return true;
  if (reachesNode(producer.id, consumer.id, [])) return true;
  var entry = state.filter(function (candidate) { return !candidate.deleted; })[0];
  if (entry && typeof initialRouteSignature === 'string'
      && editorRouteSignature() !== initialRouteSignature) {
    return producerPrecedesConsumer(
      entry.id, producer.id, consumer.id, []);
  }
  return state.indexOf(producer) >= 0
    && state.indexOf(producer) < state.indexOf(consumer);
}

function editorRouteSignature() {
  return JSON.stringify(state.filter(function (row) {
    return !row.deleted;
  }).map(function (row) {
    return {
      id: row.id,
      next_present: Boolean(row.next_present),
      next: row.next,
      branches: effectiveBranches(row).map(function (branch) {
        return branch.next || null;
      })
    };
  }));
}

var initialRouteSignature = editorRouteSignature();

function impactChanges() {
  var changes = [];
  state.forEach(function (r) {
    if (r.isnew) return;
    var nodeName = String(r.name || r.id || '').trim();
    if (r.deleted) {
      changes.push('‘' + nodeName + '’ 노드 삭제');
      return;
    }
    if (r.orig_type && r.action_type !== r.orig_type) {
      changes.push('‘' + nodeName + '’ 노드 종류 변경: '
                   + typeName(r.orig_type) + ' → ' + typeName(r.action_type));
    }
    var kept = {};
    effectiveBranches(r).forEach(function (branch) {
      if (Number.isInteger(branch.orig_index)) kept[branch.orig_index] = true;
    });
    (r.orig_branches || []).forEach(function (branch) {
      if (!kept[branch.orig_index]) {
        changes.push('‘' + nodeName + '’의 ‘'
                     + (String(branch.label).trim() || '(이름 없음)')
                     + '’ 분기 삭제');
      }
    });
  });
  return changes;
}

var pendingSubmission = null;

function closeChangeDialog() {
  var dialog = document.getElementById('change-dialog');
  if (!dialog) return;
  if (typeof dialog.close === 'function' && dialog.open) {
    dialog.close();
  } else {
    dialog.removeAttribute('open');
  }
}

function openChangeDialog(changes, text) {
  var dialog = document.getElementById('change-dialog');
  var list = document.getElementById('change-list');
  if (!dialog || !list) {
    finishSubmission(text);
    return;
  }
  pendingSubmission = text;
  list.textContent = '';
  changes.forEach(function (change) {
    var item = document.createElement('div');
    item.className = 'change-item';
    item.textContent = '- ' + change;
    list.appendChild(item);
  });
  if (typeof dialog.showModal === 'function') {
    dialog.showModal();
  } else {
    dialog.setAttribute('open', '');
  }
}

function finishSubmission(text) {
  var warnEl = document.getElementById('warn');
  warnEl.textContent = '';
  var resultJson = document.getElementById('result-json');
  if (resultJson) resultJson.value = text;
  document.getElementById('result').hidden = false;
  submitOrCopy(text);
}

function pollAuthorState() {
  if (!CONNECTED || !CONNECTED.state_url || typeof fetch !== 'function') return;
  fetch(CONNECTED.state_url, { headers: { 'Accept': 'application/json' } })
    .then(function (response) {
      if (!response.ok) throw new Error('상태 확인 실패');
      return response.json();
    })
    .then(function (body) {
      var watch = body.assistant_watch || {};
      var draftState = body.draft_generation_state;
      if (typeof draftState === 'string') {
        if (draftState === 'requested' || draftState === 'processing') {
          if (draftState === 'processing' || watch.connected) {
            showPreparingDetails(body);
          } else if (watch.state === 'disconnected') {
            showAgentConnectionRequired();
          } else {
            showAssistantConnectionChecking();
          }
        } else {
          showPreparingDetailScreen();
        }
      } else if (
        body.processing ||
        (CONNECTED.automatic_agent_processing && watch.connected)
      ) {
        showPreparingDetails(body);
      } else if (
        CONNECTED.automatic_agent_processing
        && watch.state === 'disconnected'
        && draftWaitActive
      ) {
        showAgentConnectionRequired();
      } else if (CONNECTED.automatic_agent_processing && draftWaitActive) {
        showAssistantConnectionChecking();
      }
      if (Number(body.view_generation || 0) > Number(CONNECTED.view_generation || 0)) {
        window.location.reload();
        return;
      }
      window.setTimeout(pollAuthorState, 500);
    })
    .catch(function () {
      window.setTimeout(pollAuthorState, 1200);
    });
}

var draftWaitActive = false;
var preparingDetails = false;

function setWaitLoading(value) {
  var icon = document.getElementById('draft-wait-icon');
  if (!icon) return;
  icon.classList.toggle('loading', Boolean(value));
  icon.textContent = value ? '' : '✓';
}

function showPreparingDetailScreen() {
  if (!draftWaitActive) return;
  preparingDetails = false;
  setWaitLoading(true);
  document.getElementById('draft-wait-title').textContent =
    '상세 설정 화면을 준비하고 있습니다';
  document.getElementById('draft-wait-message').textContent =
    '확정한 설계를 저장했습니다. 다음 화면을 구성하고 있습니다.';
  document.getElementById('draft-wait-note').textContent =
    '준비가 끝나면 상세 설정 화면으로 자동 전환됩니다.';
}

function showPreparingDetails(status) {
  if (!draftWaitActive) return;
  preparingDetails = true;
  setWaitLoading(true);
  document.getElementById('draft-wait-title').textContent =
    'AI 초안을 작성하고 있습니다';
  var progress = (status && status.draft_progress)
    || CONNECTED.draft_progress || {};
  var labels = Array.isArray(progress.labels) ? progress.labels : [];
  var remaining = Number(progress.remaining || 0);
  var total = Number(progress.total || 0);
  var completed = Number(progress.completed || 0);
  if (labels.length) {
    document.getElementById('draft-wait-message').textContent =
      '준비 중인 초안: ' + labels[0]
      + (remaining > 1 ? ' 외 ' + (remaining - 1) + '개' : '');
  } else {
    document.getElementById('draft-wait-message').textContent =
      '확정한 설계를 바탕으로 필요한 AI 초안을 준비하고 있습니다.';
  }
  document.getElementById('draft-wait-note').textContent = total > 0
    ? completed + '/' + total
      + '개 완료 · 모두 준비되면 상세 설정 화면으로 자동 전환됩니다.'
    : '준비가 끝나면 상세 설정 화면으로 자동 전환됩니다.';
}

function showAgentConnectionRequired() {
  if (!draftWaitActive) return;
  preparingDetails = false;
  setWaitLoading(false);
  var icon = document.getElementById('draft-wait-icon');
  if (icon) icon.textContent = '!';
  document.getElementById('draft-wait-title').textContent =
    'Code Assistant 연결이 필요합니다';
  document.getElementById('draft-wait-message').textContent =
    'AI 초안 작성을 계속하려면 Code Assistant 대화로 돌아가 '
      + '“설계 확정 완료”라고 알려 주세요.';
  document.getElementById('draft-wait-note').textContent =
    '연결되면 초안 작성 상태와 진행 상황이 이 화면에 자동으로 표시됩니다.';
}

function showAssistantConnectionChecking() {
  if (!draftWaitActive) return;
  preparingDetails = false;
  setWaitLoading(true);
  document.getElementById('draft-wait-title').textContent =
    'Agent 연결 상태를 확인하고 있습니다';
  document.getElementById('draft-wait-message').textContent =
    '잠시 후 AI 초안 작성 상태를 다시 확인합니다.';
  document.getElementById('draft-wait-note').textContent =
    '확인이 끝날 때까지 이 화면을 그대로 두세요.';
}

function showDraftWait() {
  draftWaitActive = true;
  preparingDetails = false;
  if (CONNECTED.automatic_agent_processing) {
    showPreparingDetailScreen();
  } else {
    setWaitLoading(false);
    document.getElementById('draft-wait-title').textContent = '설계가 확정되었습니다';
    document.getElementById('draft-wait-message').textContent =
      'AI 초안 작성을 계속하려면 Code Assistant 대화로 돌아가 '
        + '“설계 확정 완료”라고 알려 주세요.';
    document.getElementById('draft-wait-note').textContent =
      '입력 후 상세 설정을 준비하는 동안 로딩 상태가 표시되며, 완료되면 이 화면이 자동으로 전환됩니다.';
  }
  document.getElementById('draft-wait-note').hidden = false;
  document.getElementById('draft-wait').hidden = false;
  pollAuthorState();
}

function showDesignComplete(validation) {
  draftWaitActive = false;
  preparingDetails = false;
  setWaitLoading(false);
  var passed = validation && validation.ok;
  document.getElementById('draft-wait-title').textContent = passed
    ? '설계 저장과 검증이 완료되었습니다'
    : '설계는 저장됐지만 검증 오류가 있습니다';
  if (passed && CONNECTED.completion_url) {
    document.getElementById('draft-wait-message').textContent =
      'Creator 대시보드로 돌아갑니다.';
    document.getElementById('draft-wait-note').textContent =
      '잠시 후 Task 목록이 자동으로 새로고침됩니다.';
    window.setTimeout(function () {
      window.location.replace(CONNECTED.completion_url);
    }, 700);
  } else if (passed) {
    document.getElementById('draft-wait-message').textContent =
      '이 창을 닫아도 됩니다.';
    document.getElementById('draft-wait-note').textContent =
      (validation.warnings || []).length
        ? '확인 권장 사항 ' + validation.warnings.length + '개가 있습니다.'
        : 'Task를 실행할 수 있는 상태입니다.';
  } else {
    document.getElementById('draft-wait-message').textContent =
      'Code Assistant에 오류 수정을 요청해 주세요.';
    document.getElementById('draft-wait-note').textContent =
      validation && (validation.errors || []).length
        ? validation.errors.slice(0, 3).join(' · ')
        : '검증 결과를 확인하지 못했습니다.';
  }
  document.getElementById('draft-wait-note').hidden = false;
  document.getElementById('draft-wait').hidden = false;
}

document.getElementById('change-back').addEventListener('click', function () {
  pendingSubmission = null;
  closeChangeDialog();
});

document.getElementById('change-accept').addEventListener('click', function () {
  var text = pendingSubmission;
  pendingSubmission = null;
  closeChangeDialog();
  if (text) finishSubmission(text);
});

var firstValidationProblem = null;

function validationTarget(focus) {
  if (!focus) return null;
  if (focus.kind === 'add-node') return document.getElementById('addtop');
  var row = '[data-i="' + focus.rowIndex + '"]';
  if (focus.kind === 'node-name') {
    return document.querySelector('input' + row + '[data-k="name"]');
  }
  if (focus.kind === 'input-name') {
    return document.querySelector(
      '.input-name' + row + '[data-ii="' + focus.itemIndex + '"]');
  }
  if (focus.kind === 'input-source') {
    return document.querySelector(
      '.source-trigger' + row + '[data-ii="' + focus.itemIndex + '"]');
  }
  if (focus.kind === 'output-name') {
    return document.querySelector(
      '.output-name' + row + '[data-oi="' + focus.itemIndex + '"]');
  }
  if (focus.kind === 'add-output') {
    return document.querySelector('[data-act="oadd"]' + row);
  }
  if (focus.kind === 'branch-label') {
    return document.querySelector(
      'input' + row + '[data-bi="' + focus.itemIndex + '"][data-k="blabel"]');
  }
  if (focus.kind === 'branch-next') {
    return document.querySelector(
      'select' + row + '[data-bi="' + focus.itemIndex + '"][data-k="bnext"]');
  }
  return null;
}

function addValidationProblem(problems, row, displayIndex, message, focus) {
  var rowIndex = row ? state.indexOf(row) : -1;
  if (focus && rowIndex >= 0) focus.rowIndex = rowIndex;
  problems.push({
    group: row ? 'node-' + rowIndex : 'all',
    nodeLabel: row
      ? (displayIndex + 1) + '. ' + (String(row.name || '').trim() || '이름 없는 노드')
      : '전체 설계',
    message: message,
    focus: focus || null
  });
}

function openValidationDialog(problems) {
  var list = document.getElementById('validation-list');
  var dialog = document.getElementById('validation-dialog');
  firstValidationProblem = problems[0] || null;
  document.querySelectorAll('[aria-invalid="true"]').forEach(function (element) {
    element.removeAttribute('aria-invalid');
  });
  problems.forEach(function (problem) {
    var target = validationTarget(problem.focus);
    if (target) target.setAttribute('aria-invalid', 'true');
  });

  list.textContent = '';
  var groups = [];
  var byKey = Object.create(null);
  problems.forEach(function (problem) {
    var group = byKey[problem.group];
    if (!group) {
      group = {
        label: problem.nodeLabel,
        messages: []
      };
      byKey[problem.group] = group;
      groups.push(group);
    }
    group.messages.push(problem.message);
  });
  groups.forEach(function (group) {
    var section = document.createElement('section');
    section.className = 'validation-group';
    var heading = document.createElement('h3');
    heading.textContent = group.label;
    var messages = document.createElement('ul');
    group.messages.forEach(function (message) {
      var item = document.createElement('li');
      item.textContent = message;
      messages.appendChild(item);
    });
    section.appendChild(heading);
    section.appendChild(messages);
    list.appendChild(section);
  });
  document.getElementById('result').hidden = true;
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

function focusFirstValidationProblem() {
  var target = firstValidationProblem
    ? validationTarget(firstValidationProblem.focus)
    : null;
  if (!target) return;
  target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  window.setTimeout(function () { target.focus(); }, 120);
}

function closeValidationDialog() {
  closeDialog('validation-dialog');
  focusFirstValidationProblem();
}

document.getElementById('validation-close').addEventListener(
  'click', closeValidationDialog);
document.getElementById('validation-dialog').addEventListener(
  'cancel', function (event) {
    event.preventDefault();
    closeValidationDialog();
  });

document.getElementById('confirm').addEventListener('click', function () {
  var problems = [];
  var live = alive();
  var warnEl = document.getElementById('warn');
  warnEl.textContent = '';
  if (!live.length) {
    addValidationProblem(
      problems, null, 0, '노드를 하나 이상 추가해 주세요.', { kind: 'add-node' });
  }
  live.forEach(function (r, idx) {
    var rowIndex = state.indexOf(r);
    if (!String(r.name).trim()) {
      addValidationProblem(
        problems, r, idx, '노드 이름을 입력해 주세요.',
        { kind: 'node-name', rowIndex: rowIndex });
    }
    if (CONNECTED) {
      var inputBindings = Object.create(null);
      (r.inputs || []).forEach(function (input, inputIndex) {
        var field = String(input.field || '').trim();
        var source = String(input.source || '').trim();
        var sourceRef = input.source_ref || {};
        var binding = field + '\\n' + source + '\\n'
          + String(sourceRef.from_task || '') + '\\n'
          + String(sourceRef.from_node || '') + '\\n'
          + String(sourceRef.from_field || '') + '\\n'
          + String((input.when || {}).if_node || '') + '\\n'
          + String((input.when || {}).value || '');
        if (!field) {
          addValidationProblem(
            problems, r, idx,
            (inputIndex + 1) + '번째 입력의 이름을 입력해 주세요.',
            { kind: 'input-name', itemIndex: inputIndex });
        }
        else if (inputBindings[binding]) {
          addValidationProblem(
            problems, r, idx,
            '입력 ‘' + field + '’의 같은 출처 연결이 중복됩니다.',
            { kind: 'input-name', itemIndex: inputIndex });
        }
        inputBindings[binding] = true;
        if (!source) {
          addValidationProblem(
            problems, r, idx,
            (field ? '‘' + field + '’ 입력' : (inputIndex + 1) + '번째 입력')
              + '의 출처를 선택해 주세요.',
            { kind: 'input-source', itemIndex: inputIndex });
        }
        var resolution = currentSourceResolution(input);
        if (resolution && resolution.kind === 'ambiguous') {
          addValidationProblem(
            problems, r, idx,
            (field ? '‘' + field + '’ 입력' : (inputIndex + 1) + '번째 입력')
              + '은 이름이 같은 출력이 여러 개라 출처를 다시 선택해야 합니다.',
            { kind: 'input-source', itemIndex: inputIndex });
        } else if (resolution && resolution.kind === 'missing') {
          addValidationProblem(
            problems, r, idx,
            (field ? '‘' + field + '’ 입력' : (inputIndex + 1) + '번째 입력')
              + '이 가리키던 선행 출력이 없습니다. 출처를 다시 선택해 주세요.',
            { kind: 'input-source', itemIndex: inputIndex });
        } else if (resolution && resolution.kind === 'resolved') {
          if (!sourceAllowedForInput(r, resolution.producer)) {
            addValidationProblem(
              problems, r, idx,
              (field ? '‘' + field + '’ 입력' : (inputIndex + 1) + '번째 입력')
                + '은 앞선 노드의 출력에만 연결할 수 있습니다.',
              { kind: 'input-source', itemIndex: inputIndex });
          } else if (resolution.legacy) {
            input.source = nodeOutputSource(
              resolution.producer.id, resolution.output.id);
          }
        }
      });
      var outputIds = Object.create(null);
      (r.outputs || []).forEach(function (output, outputIndex) {
        var name = String(output.name || '').trim();
        if (!name) {
          addValidationProblem(
            problems, r, idx,
            (outputIndex + 1) + '번째 출력의 이름을 입력해 주세요.',
            { kind: 'output-name', itemIndex: outputIndex });
        }
        if (!output.id || outputIds[output.id]) {
          addValidationProblem(
            problems, r, idx,
            (outputIndex + 1) + '번째 출력을 삭제한 뒤 다시 추가해 주세요.',
            { kind: 'output-name', itemIndex: outputIndex });
        }
        outputIds[output.id] = true;
      });
      if ((r.action_type === 'system_read' || r.action_type === 'file_read')
          && !(r.outputs || []).length) {
        addValidationProblem(
          problems, r, idx, '조회 결과를 받을 출력을 하나 이상 추가해 주세요.',
          { kind: 'add-output', rowIndex: rowIndex });
      }
    }
    var branches = effectiveBranches(r);
    if (branches.length) {
      var seen = Object.create(null);
      branches.forEach(function (br, branchIndex) {
        var lb = String(br.label).trim();
        if (!lb) {
          addValidationProblem(
            problems, r, idx,
            (branchIndex + 1) + '번째 판단 결과의 이름을 입력해 주세요.',
            { kind: 'branch-label', itemIndex: branchIndex });
        } else if (seen[lb]) {
          addValidationProblem(
            problems, r, idx,
            '판단 결과 이름 ‘' + lb + '’이 중복됩니다.',
            { kind: 'branch-label', itemIndex: branchIndex });
        }
        seen[lb] = true;
        if (br.next) {
          if (br.next === r.id) {
            addValidationProblem(
              problems, r, idx,
              '‘' + (lb || (branchIndex + 1) + '번째 판단 결과')
                + '’가 현재 판단 노드를 다시 가리킵니다. '
                + '다음 작업을 다시 선택해 주세요.',
              { kind: 'branch-next', itemIndex: branchIndex });
          } else {
            var ok = live.some(function (x) { return x.id === br.next; });
            if (!ok) {
              addValidationProblem(
                problems, r, idx,
                '‘' + (lb || (branchIndex + 1) + '번째 판단 결과')
                  + '’의 다음 작업이 삭제되었습니다.',
                { kind: 'branch-next', itemIndex: branchIndex });
            }
          }
        }
      });
    }
  });
  if (problems.length) {
    var invalidResult = document.getElementById('result-json');
    if (invalidResult) invalidResult.value = '';
    openValidationDialog(problems);
    return;
  }
  var nodes = live.map(function (r) {
    var o = { id: r.id, name: String(r.name).trim(), action_type: r.action_type };
    if (r.isnew) o.new = true;
    if (r.action_type === 'decision') {
      o.branches = effectiveBranches(r).map(function (br) {
        var branch = { label: String(br.label).trim(), next: br.next || null };
        if (Number.isInteger(br.orig_index)) branch.orig_index = br.orig_index;
        return branch;
      });
    }
    if (CONNECTED) {
      o.inputs = (r.inputs || []).map(function (input) {
        var resolution = currentSourceResolution(input);
        var source = (resolution && resolution.kind === 'resolved')
          ? nodeOutputSource(resolution.producer.id, resolution.output.id)
          : input.source;
        var value = {
          field: String(input.field || '').trim(),
          source: source,
          original_field: input.original_field || ''
        };
        if (input.source_ref) value.source_ref = input.source_ref;
        if (input.when) value.when = input.when;
        return value;
      });
      o.outputs = (r.outputs || []).map(function (output) {
        return { id: output.id, name: String(output.name || '').trim() };
      });
    }
    if (effectiveBranches(r).length) {
      o.next_present = false;
    } else if (r.next_present) {
      o.next_present = true;
      o.next = r.next;
    } else {
      o.next_present = false;
    }
    return o;
  });
  var payload = { type: CONNECTED ? 'ops_design_commit' : 'ops_structure_edit',
                  task_id: TASK_ID,
                  task_fingerprint: FINGERPRINT, base_nodes: BASE_NODES, nodes: nodes };
  var text = JSON.stringify(payload, null, 2);
  var changes = impactChanges();
  if (changes.length) {
    openChangeDialog(changes, text);
  } else {
    finishSubmission(text);
  }
});

function submitOrCopy(text) {
  if (!CONNECTED) {
    copyResult();
    return;
  }
  var message = document.getElementById('submit-msg');
  var button = document.getElementById('confirm');
  if (!CONNECTED.submit_url || typeof fetch !== 'function') {
    var unavailableMessage =
      '서버에 연결하지 못했습니다. 창을 닫지 말고 잠시 후 다시 시도해 주세요.';
    if (message) {
      message.textContent = unavailableMessage;
    }
    openSubmissionError(unavailableMessage);
    return;
  }
  if (button) button.disabled = true;
  if (message) message.textContent = '구성을 확정하는 중입니다...';
  fetch(CONNECTED.submit_url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Ops-CSRF': CONNECTED.csrf_token
    },
    body: text
  }).then(function (response) {
    return response.json().catch(function () { return {}; }).then(function (body) {
      if (!response.ok) {
        throw new Error(body.reason || '서버가 요청을 처리하지 못했습니다.');
      }
      return body;
    });
  }).then(function (body) {
    if (message) {
      message.textContent = '설계가 확정되었습니다.';
    }
    if (body.next_stage === 'ready_to_validate') {
      showDesignComplete(body.validation);
    }
    else showDraftWait();
  }).catch(function (error) {
    if (button) button.disabled = false;
    var failureMessage =
      '저장하지 못했습니다: ' + error.message + ' 내용을 확인한 뒤 다시 시도해 주세요.';
    if (message) {
      message.textContent = failureMessage;
    }
    openSubmissionError(failureMessage);
  });
}

function openSubmissionError(message) {
  var dialog = document.getElementById('submission-error-dialog');
  var text = document.getElementById('submission-error-message');
  if (!dialog || !text) return;
  text.textContent = message;
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

function closeSubmissionError() {
  closeDialog('submission-error-dialog');
  var button = document.getElementById('confirm');
  if (button) button.focus();
}

function copyResult() {
  var ta = document.getElementById('result-json');
  if (!ta) return;
  var done = function () {
    document.getElementById('copy-msg').textContent = '복사되었습니다 — 채팅에 붙여넣어 주세요.';
  };
  var fallback = function () {
    ta.focus(); ta.select();
    try { if (document.execCommand('copy')) { done(); return; } } catch (err) {}
    document.getElementById('copy-msg').textContent =
      '자동 복사에 실패했습니다 — 위 텍스트를 클릭해 Ctrl+A, Ctrl+C로 복사해 주세요.';
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(ta.value).then(done, fallback);
  } else { fallback(); }
}
var copyButton = document.getElementById('copy');
if (copyButton) copyButton.addEventListener('click', copyResult);
document.getElementById('guide-btn').addEventListener('click', function () {
  var dialog = document.getElementById('guide-dialog');
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
});
document.getElementById('guide-close').addEventListener('click', function () {
  closeDialog('guide-dialog');
  document.getElementById('guide-btn').focus();
});
document.getElementById('submission-error-close').addEventListener(
  'click', closeSubmissionError);
document.getElementById('submission-error-dialog').addEventListener(
  'cancel', function (event) {
    event.preventDefault();
    closeSubmissionError();
  });

var activityLastSentAt = 0;
var activitySendTimer = null;
function sendCreatorActivity() {
  activitySendTimer = null;
  if (!CONNECTED || !CONNECTED.activity_url || typeof fetch !== 'function') return;
  activityLastSentAt = Date.now();
  fetch(CONNECTED.activity_url, {
    method: 'POST',
    headers: { 'X-Ops-CSRF': CONNECTED.csrf_token },
    credentials: 'same-origin',
    keepalive: true
  }).catch(function () {
    // Submission reports connection failures. Activity updates are best effort.
  });
}
function noteCreatorUserActivity(event) {
  if (!CONNECTED || !CONNECTED.activity_url) return;
  if (event && event.isTrusted === false) return;
  var wait = Math.max(0, 1000 - (Date.now() - activityLastSentAt));
  if (wait === 0) {
    sendCreatorActivity();
  } else if (activitySendTimer === null) {
    activitySendTimer = window.setTimeout(sendCreatorActivity, wait);
  }
}
['input', 'change', 'keydown', 'pointerdown', 'touchstart', 'wheel'].forEach(
  function (eventName) {
    document.addEventListener(eventName, noteCreatorUserActivity, true);
  });
render();
"""


def build_editor_html(task, fingerprint, connected=None,
                      previous_task_catalog=None):
    tname = task.get("task_name") or task.get("task_id", "")
    state = _editor_state(task)
    base_nodes = [n.get("id") for n in task.get("nodes", [])]
    types = [[k, v] for k, v in ACTION_TYPE_KO.items()]
    embed = json.dumps(state, ensure_ascii=False).replace("</", "<\\/")
    types_embed = json.dumps(types, ensure_ascii=False).replace("</", "<\\/")
    task_id_meta = json.dumps(
        task.get("task_id", ""), ensure_ascii=False).replace("</", "<\\/")
    fingerprint_meta = json.dumps(fingerprint).replace("</", "<\\/")
    base_nodes_meta = json.dumps(
        base_nodes, ensure_ascii=False).replace("</", "<\\/")
    previous_catalog_meta = json.dumps(
        previous_task_catalog or {"tasks": [], "diagnostics": []},
        ensure_ascii=False,
    ).replace("</", "<\\/")
    connected_value = None
    if connected is not None:
        connected_value = {
            "submit_url": connected["submit_url"],
            "csrf_token": connected["csrf_token"],
        }
        if connected.get("activity_url"):
            connected_value["activity_url"] = connected["activity_url"]
        if connected.get("state_url"):
            connected_value["state_url"] = connected["state_url"]
            connected_value["view_generation"] = connected.get(
                "view_generation", 0)
        if connected.get("completion_url"):
            connected_value["completion_url"] = connected["completion_url"]
        if connected.get("automatic_agent_processing"):
            connected_value["automatic_agent_processing"] = True
            connected_value["assistant_watch"] = connected.get(
                "assistant_watch") or {
                    "connected": False,
                    "state": "disconnected",
                    "domain": None,
                }
            if connected.get("draft_progress"):
                connected_value["draft_progress"] = connected["draft_progress"]
    connected_meta = json.dumps(
        connected_value,
        ensure_ascii=False,
    ).replace("</", "<\\/")
    consts = (f"var TASK_ID = {task_id_meta};\n"
              f"var FINGERPRINT = {fingerprint_meta};\n"
              f"var BASE_NODES = {base_nodes_meta};\n"
              f"var PREVIOUS_CATALOG = {previous_catalog_meta};\n"
              f"var CONNECTED = {connected_meta};\n")
    if connected is None:
        guide_io = (
            '<p>입력은 이 단계에 필요한 값, 출력은 다음 단계에 넘길 값입니다. '
            '입력·출력 연결은 구성 복사 후 이어지는 화면에서 확인합니다.</p>\n')
        result = (
            '<section id="result" hidden>\n<p id="warn"></p>\n'
            '<textarea id="result-json" readonly></textarea>\n'
            '<button id="copy" type="button" aria-label="클립보드 복사">복사</button> '
            '<span id="copy-msg"></span>\n'
            "</section>\n")
        eyebrow = "노드 구성 편집"
        confirm_label = "확정"
        dialog_confirm_label = "확정하고 복사"
        intro = (
            "노드 이름·종류·순서와 필요한 분기를 확인해 주세요. "
            "확정을 누르면 현재 편집 내용이 복사됩니다.")
    else:
        guide_io = (
            '<p>입력은 이 단계에 필요한 값, 출력은 다음 단계에 넘길 값입니다. '
            '선행 출력을 선택하면 새 입력 이름도 같은 이름으로 채워집니다.</p>\n')
        result = (
            '<section id="result" hidden aria-live="polite">\n'
            '<p id="warn"></p><p id="submit-msg"></p>\n'
            "</section>\n")
        eyebrow = "설계 확정"
        confirm_label = "설계 확정"
        dialog_confirm_label = "설계 확정"
        intro = (
            "노드 이름·종류·순서·분기와 각 노드의 입력·출력을 한 화면에서 확인해 주세요.")
    return (
        '<!doctype html>\n<html lang="ko">\n<head>\n<meta charset="utf-8">\n'
        # 모바일 브라우저에서도 CSS 픽셀 기준 반응형 레이아웃을 사용한다.
        '<meta name="viewport" content="width=device-width,initial-scale=1">\n'
        f"<title>【{_esc(eyebrow)}】 {_esc(tname)}</title>\n"
        f"<style>{_CSS}</style>\n</head>\n<body>\n"
        '<header id="topbar">\n'
        f'<div><span class="eyebrow">{_esc(eyebrow)}</span><h1>{_esc(tname)}</h1></div>\n'
        '<div class="grow"></div>\n'
        '<button id="guide-btn" type="button" aria-haspopup="dialog">'
        '가이드 보기</button>\n'
        f'<button id="confirm" type="button">{_esc(confirm_label)}</button>\n'
        "</header>\n<main>\n"
        f'<p class="intro">{_esc(intro)}</p>\n'
        '<button id="addtop" class="add-after" type="button">➕ 맨 앞에 노드 추가</button>\n'
        '<div id="rows"></div>\n'
        + result +
        '<dialog id="guide-dialog" class="modal" aria-labelledby="guide-title">\n'
        '<h2 id="guide-title">설계 가이드</h2>\n'
        '<h3>노드</h3>\n'
        '<p>업무를 실행 순서대로 배치하고, 각 단계가 하는 일을 이름으로 적어 주세요.</p>\n'
        '<h3>입력과 출력</h3>\n'
        + guide_io +
        '<h3>판단과 분기</h3>\n'
        '<p>AI(LLM)의 판단 결과에 따라 다음에 실행할 작업(Action)이 달라질 때만 '
        '분기를 사용해 주세요.</p>\n'
        '<div class="guide-example"><b>분기 없음</b>'
        '<span>조회 → 문서 작성 → 파일 저장</span></div>\n'
        '<div class="guide-example"><b>분기 사용</b>'
        '<span>조회 → 영향 여부 판단 → 협의 또는 종료</span></div>\n'
        '<div class="dialog-actions">\n'
        '<button id="guide-close" type="button">확인</button>\n'
        '</div>\n</dialog>\n'
        '<dialog id="change-dialog" class="modal" aria-labelledby="change-title">\n'
        '<h2 id="change-title">변경 내용을 확인해 주세요</h2>\n'
        '<div id="change-list"></div>\n'
        '<div class="dialog-actions">\n'
        '<button id="change-back" type="button">돌아가기</button>\n'
        f'<button id="change-accept" type="button">'
        f'{_esc(dialog_confirm_label)}</button>\n'
        '</div>\n</dialog>\n'
        '<dialog id="delete-dialog" class="modal" aria-labelledby="delete-title">\n'
        '<h2 id="delete-title">연결된 입력을 확인해 주세요</h2>\n'
        '<p id="delete-summary"></p><div id="delete-input-list"></div>\n'
        '<div class="dialog-actions">\n'
        '<button id="delete-cancel" type="button">취소</button>\n'
        '<button id="delete-connected" type="button">함께 삭제</button>\n'
        '</div>\n</dialog>\n'
        '<dialog id="validation-dialog" class="modal" '
        'aria-labelledby="validation-title" aria-describedby="validation-intro">\n'
        '<h2 id="validation-title">설계를 확정할 수 없습니다</h2>\n'
        '<p id="validation-intro">아래 항목을 수정한 뒤 다시 확정해 주세요.</p>\n'
        '<div id="validation-list"></div>\n'
        '<div class="dialog-actions">\n'
        '<button id="validation-close" type="button">확인하고 수정</button>\n'
        '</div>\n</dialog>\n'
        '<dialog id="submission-error-dialog" class="modal" '
        'aria-labelledby="submission-error-title" '
        'aria-describedby="submission-error-message">\n'
        '<h2 id="submission-error-title">설계를 저장하지 못했습니다</h2>\n'
        '<p id="submission-error-message"></p>\n'
        '<div class="dialog-actions">\n'
        '<button id="submission-error-close" type="button">확인하고 수정</button>\n'
        '</div>\n</dialog>\n'
        '<dialog id="source-dialog" class="modal" aria-labelledby="source-title">\n'
        '<h2 id="source-title">입력 출처 선택</h2>\n'
        '<div class="picker-specials">\n'
        '<button type="button" data-special-source="__external__">'
        '실행 시작 시 사용자 입력</button>\n'
        '<button type="button" data-special-source="$.key">건 ID</button>\n'
        '</div>\n'
        '<div class="picker-tabs">\n'
        '<button type="button" class="picker-tab active" data-mode="current">'
        '현재 Task</button>\n'
        '<button type="button" class="picker-tab" data-mode="previous">'
        '이전 Task</button>\n'
        '</div>\n'
        '<div class="picker-columns">\n'
        '<section class="picker-pane"><h3>선행 노드</h3>'
        '<div id="picker-nodes"></div></section>\n'
        '<section class="picker-pane"><div id="picker-outputs">'
        '<div class="picker-empty">왼쪽에서 노드를 선택하세요.</div>'
        '</div></section>\n'
        '</div>\n'
        '<div class="dialog-actions"><button id="picker-cancel" type="button">'
        '취소</button></div>\n'
        '</dialog>\n'
        '<section id="draft-wait" hidden aria-live="polite">\n'
        '<div class="wait-card"><div id="draft-wait-icon" class="wait-status-icon" '
        'aria-hidden="true">✓</div>\n'
        '<h2 id="draft-wait-title">설계가 확정되었습니다</h2>\n'
        '<p id="draft-wait-message">Code Assistant 대화로 돌아가 '
        '“설계 확정 완료”라고 알려 주세요.</p>\n'
        '<p id="draft-wait-note" class="note">Code Assistant가 AI 초안을 준비하면 이 화면은 '
        '상세 설정으로 자동 전환됩니다.</p></div>\n'
        '</section>\n'
        "</main>\n"
        f'<script type="application/json" id="state">{embed}</script>\n'
        f'<script type="application/json" id="types">{types_embed}</script>\n'
        f"<script>\n{consts}{_JS}</script>\n</body>\n</html>\n")


def editor_path(task_json_path, task=None):
    return workspace.ui_path(task_json_path, task or {}, "structure")


def write_editor(task, task_json_path):
    """편집기 HTML을 .ops/ui에 저장 — 파생 일회용 파일이라 무경고 덮어쓰기."""
    path = editor_path(task_json_path, task)
    fp = _task_fingerprint(task_json_path)
    with open(path, "w", encoding="utf-8") as f:
        f.write(build_editor_html(task, fp))
    return path
