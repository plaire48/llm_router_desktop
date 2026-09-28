# -*- coding: utf-8 -*-
"""Creator 질문지에서 사용하는 격리된 단일 노드 테스트 실행.

정본 task와 정상 ``.ops/runs``에는 손대지 않는다. 질문지의 저장 전 답변을
candidate task에만 적용하고, 명시적으로 받은 테스트 입력 또는 같은 Creator
세션의 이전 테스트 결과를 seed로 넣어 대상 노드 하나만 실행한다.
"""
from __future__ import annotations

import copy
import datetime
import hashlib
import json
import os
import re
import secrets
import shutil

from . import (
    author_apply, engine, mutation_lock, references, util,
)


_SAFE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,100}$")
_NODE_LABEL_RE = re.compile(r"^\$\.nodes\.([^.]+)\.label$")
_NODE_TEST_SECONDS = 30 * 60
_NODE_TEST_REFERENCE_TEXT_BYTES = 256 * 1024


def _now():
    return datetime.datetime.now().isoformat(timespec="microseconds")


def _json_digest(value):
    raw = json.dumps(
        value, ensure_ascii=False, sort_keys=True,
        separators=(",", ":"), default=str,
    ).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _source_strings(value):
    if isinstance(value, dict):
        for item in value.values():
            yield from _source_strings(item)
    elif isinstance(value, list):
        for item in value:
            yield from _source_strings(item)
    elif isinstance(value, str) and value.startswith("$."):
        yield value


def _execution_sources(node):
    """실행 입력으로 해석되는 source만 반환한다.

    응답 추출식(``$.body...``) 같은 출력 매핑은 임시 입력이 아니므로 제외한다.
    """
    for spec in node.get("inputs") or []:
        if not isinstance(spec, dict):
            continue
        source = spec.get("source")
        if isinstance(source, str) and source.startswith("$."):
            yield source
    configs = [node] + [
        system for system in node.get("systems") or []
        if isinstance(system, dict)
    ]
    for cfg in configs:
        integration = cfg.get("integration") or {}
        yield from _source_strings(integration.get("request") or {})


class NodeTestService:
    """하나의 Creator 실행에 속한 노드 테스트의 상태와 실행 흐름을 관리한다."""

    def __init__(self, controller, launch_id):
        if not isinstance(launch_id, str) or not _SAFE_ID_RE.fullmatch(launch_id):
            raise ValueError("node test launch_id 형식이 잘못되었습니다")
        self.controller = controller
        self.launch_id = launch_id
        self.project_root = controller.project_root
        self.tests_root = os.path.realpath(os.path.join(
            self.project_root, ".ops", "node-tests"))
        self.root = os.path.realpath(os.path.join(
            self.tests_root, launch_id))
        if (
            not controller._inside(self.tests_root, self.project_root)
            or not controller._inside(self.root, self.tests_root)
        ):
            raise ValueError("노드 테스트 상태 경로가 프로젝트 밖입니다")
        os.makedirs(self.root, exist_ok=True)

    # --------------------------------------------------------------- paths/state

    def _test_dir(self, test_id, must_exist=True):
        if not isinstance(test_id, str) or not _SAFE_ID_RE.fullmatch(test_id):
            raise ValueError("node test id 형식이 잘못되었습니다")
        path = os.path.realpath(os.path.join(self.root, test_id))
        if not self.controller._inside(path, self.root):
            raise ValueError("node test 경로가 잘못되었습니다")
        if must_exist and not os.path.isdir(path):
            raise FileNotFoundError(f"노드 테스트를 찾을 수 없습니다: {test_id}")
        return path

    def _state_path(self, test_id, must_exist=True):
        path = os.path.join(self._test_dir(test_id, must_exist=must_exist), "state.json")
        if must_exist and not os.path.isfile(path):
            raise FileNotFoundError(f"노드 테스트 상태를 찾을 수 없습니다: {test_id}")
        return path

    def _candidate_path(self, test_id):
        return os.path.join(self._test_dir(test_id), "candidate.json")

    def _run_path(self, test_id):
        return os.path.join(self._test_dir(test_id), "run.json")

    def _load_state(self, test_id):
        state = util.load_json(self._state_path(test_id))
        if (
            state.get("type") != "ops_node_test"
            or state.get("launch_id") != self.launch_id
            or state.get("test_id") != test_id
        ):
            raise ValueError("노드 테스트 상태가 올바르지 않습니다")
        return state

    def _write_state(self, state):
        state = copy.deepcopy(state)
        state["updated_at"] = _now()
        util.atomic_write_json(self._state_path(
            state["test_id"], must_exist=False), state)
        return state

    def _iter_states(self):
        try:
            names = sorted(os.listdir(self.root))
        except OSError:
            return []
        states = []
        for name in names:
            if not _SAFE_ID_RE.fullmatch(name):
                continue
            try:
                states.append(self._load_state(name))
            except (OSError, ValueError, json.JSONDecodeError):
                continue
        return states

    @staticmethod
    def _busy(exc):
        return {
            "status": "busy",
            "reason_code": "resource_mutation_busy",
            "reason": str(exc),
            "retryable": True,
        }

    def _runtime_ctx(self):
        """정상 Runner와 구분되는 테스트 전용 실행 컨텍스트."""
        ctx = self.controller._runtime_ctx()
        ctx["node_test"] = True
        return ctx

    # --------------------------------------------------------------- public shape

    def _public(self, state, include_agent_job=False):
        allowed = (
            "status", "reason_code", "reason", "test_id", "node_id",
            "node_no", "node_label", "missing_inputs", "system_choices",
            "result", "summary", "preview", "created_at", "updated_at",
            "temporary_input_used", "reused_sources", "instruction",
            "resolved_inputs", "temporary_reference_used",
        )
        out = {key: copy.deepcopy(state[key]) for key in allowed if key in state}
        if state.get("job"):
            job = copy.deepcopy(state["job"])
            if not include_agent_job and job.get("actor") == "agent":
                job = {
                    key: job[key]
                    for key in (
                        "actor", "kind", "node_label", "fields", "slot",
                    )
                    if key in job
                }
            out["job"] = job
        return out

    def _load_stable_task(self, task_path):
        """Parse and fingerprint the same Task bytes, avoiding a check/use gap."""
        with open(task_path, "rb") as handle:
            raw = handle.read()
        task = json.loads(raw.decode("utf-8"))
        return task, hashlib.sha256(raw).hexdigest()[:16]

    def _ensure_canonical_revision(self, state):
        task_path = self.controller._task_path(state["task_ref"])
        task, current = self._load_stable_task(task_path)
        if current != state.get("task_revision"):
            dependency_digest = self._node_dependency_digest(
                task, state["node_id"])
            if dependency_digest == state.get("canonical_dependency_digest"):
                # Unrelated Task edits do not invalidate this node test.
                state["task_revision"] = current
                self._write_state(state)
                return True

            payload = state.get("prepare_payload")
            if isinstance(payload, dict):
                state.update({
                    "status": "superseded",
                    "reason_code": "node_test_refreshed",
                    "reason": "관련 설정이 변경되어 현재 값으로 테스트를 다시 준비했습니다",
                })
                state.pop("job", None)
                self._write_state(state)
                return self._prepare_locked(
                    state["session_id"], state["task_ref"], state["node_id"],
                    copy.deepcopy(payload), current,
                    bool(state.get("revision_questionnaire")))

            state.update({
                "status": "needs_refresh",
                "reason_code": "node_test_dependency_changed",
                "reason": "관련 설정이 변경되어 현재 값으로 다시 준비합니다",
            })
            state.pop("job", None)
            self._write_state(state)
            return self._public(state)
        return True

    def _refresh_current(self, state, reason_code, reason):
        payload = state.get("prepare_payload")
        if not isinstance(payload, dict):
            state.update({
                "status": "needs_refresh",
                "reason_code": reason_code,
                "reason": reason,
            })
            state.pop("job", None)
            self._write_state(state)
            return self._public(state)
        task_path = self.controller._task_path(state["task_ref"])
        current_revision = self.controller._revision(task_path)
        state.update({
            "status": "superseded",
            "reason_code": "node_test_refreshed",
            "reason": reason,
        })
        state.pop("job", None)
        self._write_state(state)
        refreshed = self._prepare_locked(
            state["session_id"], state["task_ref"], state["node_id"],
            copy.deepcopy(payload), current_revision,
            bool(state.get("revision_questionnaire")))
        if (isinstance(refreshed, dict)
                and refreshed.get("status") == "waiting_agent"
                and refreshed.get("test_id")):
            return self._public(
                self._load_state(refreshed["test_id"]),
                include_agent_job=True)
        return refreshed

    def _ensure_candidate_dependencies(self, state):
        """Refresh an active test when its actual file dependencies changed."""
        try:
            candidate = util.load_json(self._candidate_path(state["test_id"]))
            current = self._node_dependency_digest(
                candidate, state["node_id"])
        except (OSError, ValueError, KeyError, json.JSONDecodeError):
            current = None
        if current != state.get("candidate_dependency_digest"):
            return self._refresh_current(
                state, "node_test_dependencies_changed",
                "판단 기준·참고자료·파일 또는 선행 노드 설정이 변경되어 "
                "현재 값으로 테스트를 다시 준비했습니다")
        return True

    def _ensure_runtime_provenance(self, state):
        """대기 중 사용한 선행 실제값·파일이 최신인지 다시 확인한다."""
        try:
            candidate = util.load_json(self._candidate_path(state["test_id"]))
            current = self._provenance_is_current(
                candidate,
                state.get("session_id"),
                state,
                {(state.get("session_id"), state.get("node_id"))},
            )
        except (OSError, ValueError, KeyError, json.JSONDecodeError):
            current = False
        if not current:
            return self._refresh_current(
                state, "node_test_inputs_changed",
                "테스트가 기다리는 동안 선행 노드 결과나 읽을 파일이 "
                "변경되어 현재 값으로 테스트를 다시 준비했습니다")
        return True

    def _supersede_pending(self, session_id, node_id):
        """같은 화면·노드에서 새 테스트를 만들 때 이전 대기 작업을 무효화한다."""
        for state in self._iter_states():
            if (
                state.get("session_id") != session_id
                or state.get("node_id") != node_id
                or state.get("status") not in (
                    "needs_input", "prepared", "waiting_user", "waiting_agent")
            ):
                continue
            state.update({
                "status": "stale",
                "reason_code": "superseded_node_test",
                "reason": "같은 노드에서 새 테스트를 시작해 이전 테스트가 만료되었습니다",
            })
            state.pop("job", None)
            self._write_state(state)

    @staticmethod
    def _lock_identity(state):
        return f'{state.get("session_id") or ""}\0{state.get("node_id") or ""}'

    def _agent_job_is_current(self, state):
        """Check queue freshness without changing node-test state."""
        try:
            task_path = self.controller._task_path(state["task_ref"])
            task, current_revision = self._load_stable_task(task_path)
            if (
                current_revision != state.get("task_revision")
                and self._node_dependency_digest(task, state["node_id"])
                    != state.get("canonical_dependency_digest")
            ):
                return False
            candidate = util.load_json(self._candidate_path(state["test_id"]))
            if self._node_dependency_digest(
                    candidate, state["node_id"]) != state.get(
                        "candidate_dependency_digest"):
                return False
            return self._provenance_is_current(
                candidate,
                state.get("session_id"),
                state,
                {(state.get("session_id"), state.get("node_id"))},
            )
        except (OSError, ValueError, KeyError, json.JSONDecodeError):
            return False

    # --------------------------------------------------------------- candidate

    def prepare(self, session_id, task_ref, node_id, author_payload,
                expected_revision, revision_questionnaire=False):
        """저장 전 질문 답변을 candidate에 적용하고 필요한 실행 입력을 계산한다."""
        try:
            with mutation_lock.resource_mutation_lock(
                    self.project_root, "node-test",
                    f"{session_id}\0{node_id}"):
                return self._prepare_locked(
                    session_id, task_ref, node_id, author_payload,
                    expected_revision, revision_questionnaire)
        except mutation_lock.MutationBusy as exc:
            return self._busy(exc)

    def _prepare_locked(self, session_id, task_ref, node_id, author_payload,
                        expected_revision, revision_questionnaire):
        if not isinstance(session_id, str) or not session_id:
            return {"status": "invalid", "reason": "Creator 화면 세션이 필요합니다"}
        if not isinstance(author_payload, dict):
            return {"status": "invalid", "reason": "질문지 답변이 JSON 객체가 아닙니다"}
        task_path = self.controller._task_path(task_ref)
        task, current_revision = self._load_stable_task(task_path)
        if expected_revision != current_revision:
            return {
                "status": "conflict",
                "reason_code": "stale_revision",
                "reason": "Task가 변경되어 최신 화면에서 다시 테스트해야 합니다",
            }
        canonical_dependency_digest = self._node_dependency_digest(
            task, node_id)
        if author_payload.get("task_id") != task.get("task_id"):
            return {
                "status": "invalid",
                "reason_code": "wrong_task",
                "reason": "현재 질문지와 Task가 일치하지 않습니다",
            }
        target_unanswered = [
            item for item in (author_payload.get("unanswered") or [])
            if isinstance(item, dict) and item.get("node_id") == node_id
        ]
        if target_unanswered:
            return {
                "status": "invalid",
                "reason_code": "node_configuration_incomplete",
                "reason": "이 노드의 설정을 모두 입력한 뒤 테스트해 주세요",
                "unanswered": target_unanswered,
            }

        preview = author_apply.preview_answers(
            task, author_payload, task_path,
            revision=bool(revision_questionnaire))
        if preview.get("status") != "ok":
            result = {
                key: copy.deepcopy(value)
                for key, value in preview.items()
                if key not in ("candidate_task", "staged_prompts")
            }
            result.setdefault("status", "invalid")
            return result
        candidate = preview["candidate_task"]
        target = next(
            (node for node in candidate.get("nodes") or []
             if isinstance(node, dict) and node.get("id") == node_id),
            None,
        )
        if target is None:
            return {
                "status": "invalid",
                "reason_code": "unknown_node",
                "reason": "테스트할 노드를 찾을 수 없습니다",
            }
        if target.get("type") != "if" and not target.get("action_type"):
            return {
                "status": "invalid",
                "reason_code": "node_not_executable",
                "reason": "실행할 수 있는 Action 노드가 아닙니다",
            }
        reference_texts = author_payload.get("node_test_reference_texts") or {}
        if not isinstance(reference_texts, dict):
            return {
                "status": "invalid",
                "reason_code": "invalid_node_test_reference",
                "reason": "테스트 참고자료 묶음이 올바르지 않습니다",
            }
        nodes_by_id = {
            node.get("id"): node
            for node in candidate.get("nodes") or []
            if isinstance(node, dict) and node.get("id")
        }
        normalized_reference_texts = {}
        reference_bytes = 0
        for reference_node_id, reference_text in reference_texts.items():
            reference_node = nodes_by_id.get(reference_node_id)
            if (
                reference_node is None
                or reference_node.get("action_type") != "decision"
            ):
                return {
                    "status": "invalid",
                    "reason_code": "unsupported_node_test_reference",
                    "reason": "붙여넣은 참고자료는 판단 노드에만 연결할 수 있습니다",
                }
            if not isinstance(reference_text, str):
                return {
                    "status": "invalid",
                    "reason_code": "invalid_node_test_reference",
                    "reason": "테스트 참고자료는 직접 붙여넣은 텍스트여야 합니다",
                }
            reference_text = reference_text.strip()
            if not reference_text:
                continue
            reference_bytes += len(reference_text.encode("utf-8"))
            normalized_reference_texts[reference_node_id] = reference_text
        if reference_bytes > _NODE_TEST_REFERENCE_TEXT_BYTES:
            return {
                "status": "invalid",
                "reason_code": "node_test_reference_too_large",
                "reason": "붙여넣은 테스트 참고자료 합계는 256KB 이하여야 합니다",
            }

        self._supersede_pending(session_id, node_id)
        test_id = secrets.token_urlsafe(18).replace("-", "_")
        test_dir = self._test_dir(test_id, must_exist=False)
        os.makedirs(test_dir, exist_ok=False)

        # 저장 전 판단 기준은 정본 prompt_file을 덮어쓰지 않고 candidate 전용
        # override로 싣는다. 대상뿐 아니라 의존 생산자에도 넣어야 생산자 테스트
        # 당시와 후속 노드가 그 결과를 재사용할 때의 fingerprint가 같아진다.
        # handler는 node_test 실행 컨텍스트에서만 이 내부 키를 사용한다.
        staged_prompts = preview.get("staged_prompts") or {}
        staged_by_path = {
            os.path.normcase(os.path.realpath(path)): content
            for path, content in staged_prompts.items()
        }
        for candidate_node in candidate.get("nodes") or []:
            if not isinstance(candidate_node, dict):
                continue
            reference_text = normalized_reference_texts.get(
                candidate_node.get("id"))
            if reference_text:
                candidate_node["_node_test_reference_text"] = reference_text
            stored_prompt = candidate_node.get("prompt_file")
            if not stored_prompt:
                continue
            actual_prompt = os.path.realpath(
                os.path.abspath(os.path.join(
                    self.project_root, stored_prompt.replace("/", os.sep)))
                if not os.path.isabs(stored_prompt) else stored_prompt)
            prompt = staged_by_path.get(os.path.normcase(actual_prompt))
            if prompt is not None:
                candidate_node["_node_test_prompt"] = prompt

        # candidate에서 target 이후로 절대 진행하지 않는다. If는 별도 route-only
        # 처리하므로 cases 원문은 그대로 두고 일반 Action만 next를 끊는다.
        if target.get("type") != "if":
            target["next"] = None
        util.atomic_write_json(os.path.join(test_dir, "candidate.json"), candidate)

        (seed_nodes, seed_inputs, missing, reused_sources,
         reuse_requirements, reuse_conflicts,
         conditional_reuse) = self._resolve_seed(
            candidate, target, session_id)
        system_choices = [
            system.get("name")
            for system in target.get("systems") or []
            if isinstance(system, dict) and system.get("name")
        ]
        node_no = self._display_node_no(candidate, node_id)
        state = {
            "type": "ops_node_test",
            "launch_id": self.launch_id,
            "session_id": session_id,
            "test_id": test_id,
            "task_ref": self.controller._ref(task_path),
            "task_revision": current_revision,
            "canonical_dependency_digest": canonical_dependency_digest,
            "candidate_ref": self.controller._ref(
                os.path.join(test_dir, "candidate.json")),
            "candidate_dependency_digest": self._node_dependency_digest(
                candidate, node_id),
            "node_id": node_id,
            "node_no": node_no,
            "node_label": self._node_label(target, node_no),
            "status": (
                "invalid" if reuse_conflicts
                else "needs_input" if (missing or system_choices)
                else "prepared"
            ),
            "missing_inputs": missing,
            "system_choices": system_choices,
            "seed_nodes": seed_nodes,
            "seed_inputs": seed_inputs,
            "reused_sources": reused_sources,
            "reuse_requirements": reuse_requirements,
            "conditional_reuse": conditional_reuse,
            "temporary_sources": [],
            "temporary_reference_used": bool(normalized_reference_texts),
            "prepare_payload": copy.deepcopy(author_payload),
            "revision_questionnaire": bool(revision_questionnaire),
            "created_at": _now(),
            "expires_at": (
                datetime.datetime.now()
                + datetime.timedelta(seconds=_NODE_TEST_SECONDS)
            ).isoformat(timespec="seconds"),
        }
        if reuse_conflicts:
            state.update({
                "reason_code": "upstream_context_conflict",
                "reason": (
                    "재사용할 선행 노드 결과들이 서로 다른 실행 입력으로 "
                    "만들어졌습니다. 같은 입력으로 해당 선행 노드들을 다시 "
                    "테스트해 주세요: " + ", ".join(sorted(reuse_conflicts))
                ),
            })
        self._write_state(state)
        if state["status"] == "prepared":
            return self._execute_locked(state, values={}, system=None)
        return self._public(state)

    @staticmethod
    def _display_node_no(task, node_id):
        number = 0
        for node in task.get("nodes") or []:
            if not isinstance(node, dict) or node.get("type") == "if":
                continue
            number += 1
            if node.get("id") == node_id:
                return number
        return None

    @staticmethod
    def _node_label(node, node_no=None):
        name = node.get("name") or node.get("id") or "노드"
        return f"{node_no}. {name}" if node_no else str(name)

    def _node_dependency_digest(self, task, node_id):
        """노드 결과에 영향을 주는 설정과 선행 노드 설정만 fingerprint한다."""
        by_id = {
            node.get("id"): node
            for node in task.get("nodes") or []
            if isinstance(node, dict) and node.get("id")
        }
        input_specs = {
            item.get("name"): item
            for item in task.get("inputs_from") or []
            if isinstance(item, dict) and item.get("name")
        }
        memo = {}
        visiting = set()

        def visit(current_id):
            if current_id in memo:
                return memo[current_id]
            if current_id in visiting:
                return {"node_id": current_id, "cycle": True}
            node = by_id.get(current_id)
            if node is None:
                return {"node_id": current_id, "missing": True}
            visiting.add(current_id)
            normalized = copy.deepcopy(node)
            # 후속 연결은 이 노드가 내는 값에 영향을 주지 않는다. 대상 노드는
            # candidate에서 next=None으로 잘리므로 이를 포함하면 같은 설정도
            # 생산자/소비자 테스트 위치에 따라 다른 fingerprint가 된다.
            normalized.pop("next", None)
            dependencies = {}
            external_inputs = {}
            for source in sorted(set(_execution_sources(normalized))):
                resolved = references.resolve_output_source(task, source)
                if (
                    resolved
                    and resolved.get("kind") in ("canonical", "legacy_name")
                    and resolved.get("node_id") != current_id
                ):
                    producer_id = resolved["node_id"]
                    dependencies[producer_id] = visit(producer_id)
                elif source.startswith("$.inputs_from."):
                    name = source[len("$.inputs_from."):]
                    external_inputs[name] = copy.deepcopy(
                        input_specs.get(name) or {"name": name})
                elif source == "$.key":
                    external_inputs["$.key"] = {"name": "$.key"}
            if node.get("type") == "if" and node.get("source_node"):
                producer_id = node["source_node"]
                if producer_id != current_id:
                    dependencies[producer_id] = visit(producer_id)
            visiting.remove(current_id)
            value = {
                "node": normalized,
                "dependencies": dependencies,
                "external_inputs": external_inputs,
                "file_dependencies": self._static_file_dependencies(
                    normalized),
            }
            memo[current_id] = value
            return value

        return _json_digest(visit(node_id))

    def _path_fingerprint(self, stored_path, exclude_paths=None,
                          task_path=False):
        """파일·폴더의 내용 기반 fingerprint."""
        shown = str(stored_path or "")
        excluded = {
            os.path.normcase(os.path.realpath(path))
            for path in (exclude_paths or ())
        }
        try:
            authorize = (
                self.controller.authorize_task_path
                if task_path else self.controller.authorize_path
            )
            path = authorize(shown, "read")
        except (OSError, ValueError, PermissionError) as exc:
            return {"path": shown, "status": "unavailable", "reason": str(exc)}

        def file_hash(file_path):
            digest = hashlib.sha256()
            with open(file_path, "rb") as handle:
                while True:
                    chunk = handle.read(1024 * 1024)
                    if not chunk:
                        break
                    digest.update(chunk)
            return digest.hexdigest()

        if os.path.normcase(os.path.realpath(path)) in excluded:
            return {"path": shown, "status": "excluded"}
        if os.path.isfile(path):
            try:
                return {
                    "path": shown,
                    "kind": "file",
                    "sha256": file_hash(path),
                }
            except OSError as exc:
                return {
                    "path": shown,
                    "status": "unavailable",
                    "reason": str(exc),
                }
        if not os.path.isdir(path):
            return {"path": shown, "status": "unsupported"}
        files = []
        try:
            for root, dirs, names in os.walk(path):
                dirs.sort()
                for name in sorted(names):
                    candidate = os.path.join(root, name)
                    try:
                        candidate = authorize(candidate, "read")
                        if os.path.normcase(
                                os.path.realpath(candidate)) in excluded:
                            continue
                        relative = os.path.relpath(candidate, path).replace(
                            os.sep, "/")
                        files.append({
                            "path": relative,
                            "sha256": file_hash(candidate),
                        })
                    except (OSError, ValueError, PermissionError) as exc:
                        files.append({
                            "path": os.path.relpath(
                                candidate, path).replace(os.sep, "/"),
                            "status": "unavailable",
                            "reason": str(exc),
                        })
        except OSError as exc:
            return {
                "path": shown,
                "status": "unavailable",
                "reason": str(exc),
            }
        return {"path": shown, "kind": "directory", "files": files}

    def _static_file_dependencies(self, node):
        paths = []
        excluded = set()
        if node.get("prompt_file") and "_node_test_prompt" not in node:
            paths.append(node["prompt_file"])
        elif node.get("prompt_file"):
            try:
                excluded.add(self.controller.authorize_task_path(
                    node["prompt_file"], "read"))
            except (OSError, ValueError, PermissionError):
                pass
        paths.extend(
            value for value in node.get("references") or []
            if isinstance(value, str) and value.strip()
        )
        if node.get("action_type") == "file_read":
            configs = [node] + [
                system for system in node.get("systems") or []
                if isinstance(system, dict)
            ]
            for cfg in configs:
                if cfg.get("method") == "manual":
                    continue
                for key in ("path", "directory"):
                    value = cfg.get(key)
                    if isinstance(value, str) and value.strip():
                        paths.append(value)
        return {
            path: self._path_fingerprint(
                path, exclude_paths=excluded, task_path=True)
            for path in sorted(set(paths))
        }

    def _compatible_completed(self, task, session_id, node_id, visiting=None):
        dependency_digest = self._node_dependency_digest(task, node_id)
        visiting = set(visiting or ())
        marker = (session_id, node_id)
        if marker in visiting:
            return []
        visiting.add(marker)
        states = [
            state for state in self._iter_states()
            if (
                state.get("session_id") == session_id
                and state.get("node_id") == node_id
                and state.get("status") == "completed"
                and state.get("candidate_dependency_digest")
                    == dependency_digest
            )
        ]
        states.sort(
            key=lambda item: str(item.get("updated_at") or ""),
            reverse=True)
        return [
            state for state in states
            if self._provenance_is_current(
                task, session_id, state, visiting)
        ]

    def _provenance_is_current(self, task, session_id, state, visiting):
        """재사용 결과가 현재 최신 선행 테스트 값으로 만들어졌는지 확인한다."""
        for source, expected_digest in (
                state.get("runtime_provenance") or {}).items():
            resolved = references.resolve_output_source(task, source)
            if resolved and resolved.get("kind") in ("canonical", "legacy_name"):
                producer_states = self._compatible_completed(
                    task, session_id, resolved["node_id"], visiting)
                if not producer_states:
                    # 선행 노드를 실제 테스트하지 않고 임시값으로 만든 결과도
                    # 같은 세션 안에서는 사용할 수 있다. 이후 실제 결과가 생기면
                    # 아래 비교로 자동 무효화된다.
                    continue
                output = (producer_states[0].get("result") or {}).get(
                    "output") or {}
                if (
                    resolved["output_id"] not in output
                    or _json_digest(output[resolved["output_id"]])
                        != expected_digest
                ):
                    return False
                continue
            label_match = _NODE_LABEL_RE.fullmatch(str(source or ""))
            if label_match:
                producer_states = self._compatible_completed(
                    task, session_id, label_match.group(1), visiting)
                if not producer_states:
                    continue
                result = producer_states[0].get("result") or {}
                if (
                    "label" not in result
                    or _json_digest(result["label"]) != expected_digest
                ):
                    return False
                continue
            if str(source).startswith("@file:"):
                stored_path = str(source)[len("@file:"):]
                if _json_digest(
                        self._path_fingerprint(
                            stored_path, task_path=True)) != expected_digest:
                    return False
        return True

    def _runtime_file_provenance(self, node, cfg, inputs):
        if node.get("action_type") != "file_read" or (cfg or {}).get(
                "method") == "manual":
            return {}
        path = (cfg or {}).get("path")
        path_input = (cfg or {}).get("path_input")
        if not path and path_input:
            path = inputs.get(path_input)
        if not isinstance(path, str) or not path.strip():
            return {}
        path = path.strip()
        return {
            "@file:" + path: _json_digest(
                self._path_fingerprint(path, task_path=True)),
        }

    def _resolve_seed(self, task, target, session_id):
        seed_nodes, seed_inputs, missing, reused_sources = {}, {}, [], []
        reuse_requirements = {}
        reuse_conflicts = set()
        conditional_reuse = []

        def merge_provenance(provenance):
            for source, digest in (provenance or {}).items():
                previous = reuse_requirements.get(source)
                if previous is not None and previous != digest:
                    reuse_conflicts.add(source)
                    continue
                reuse_requirements[source] = digest
        seen_sources = set()
        specs = {}

        def add_spec(source, field, systems=None):
            source = str(source or "")
            if not source:
                return
            names = None if systems is None else set(systems)
            current = specs.get(source)
            if current is None:
                specs[source] = {
                    "field": str(field or source),
                    "systems": names,
                }
                return
            if current["systems"] is None or names is None:
                current["systems"] = None
            else:
                current["systems"].update(names)

        for spec in target.get("inputs") or []:
            if not isinstance(spec, dict):
                continue
            source = str(spec.get("source") or "")
            add_spec(source, spec.get("field") or source)
        systems = [
            system for system in target.get("systems") or []
            if isinstance(system, dict) and system.get("name")
        ]
        if systems:
            for system in systems:
                for source in _source_strings(
                        (system.get("integration") or {}).get("request") or {}):
                    add_spec(source, source, systems=[system["name"]])
        else:
            for source in _source_strings(
                    (target.get("integration") or {}).get("request") or {}):
                add_spec(source, source)

        if target.get("type") == "if" and target.get("source_node"):
            producer_id = target["source_node"]
            value_found, label, provenance = self._previous_label(
                task, session_id, producer_id)
            producer = next(
                (node for node in task.get("nodes") or []
                 if isinstance(node, dict) and node.get("id") == producer_id),
                {},
            )
            if value_found:
                self._seed_node_label(seed_nodes, producer_id, label)
                reused_sources.append({
                    "source": f"$.nodes.{producer_id}.label",
                    "label": f"{producer.get('name') or producer_id} > 판단 라벨",
                })
                merge_provenance(provenance)
                merge_provenance({
                    f"$.nodes.{producer_id}.label": _json_digest(label),
                })
            else:
                missing.append({
                    "key": f"$.nodes.{producer_id}.label",
                    "source": f"$.nodes.{producer_id}.label",
                    "source_kind": "node_label",
                    "producer_node": producer_id,
                    "field": "판단 라벨",
                    "label": f"{producer.get('name') or producer_id} > 판단 라벨",
                    "choices": [
                        label for label in producer.get("labels") or [] if label
                    ],
                })

        for source, meta in specs.items():
            if source in seen_sources:
                continue
            seen_sources.add(source)
            field = meta["field"]
            source_systems = meta["systems"]

            def add_missing(item, systems=source_systems):
                if systems:
                    item["systems"] = sorted(systems)
                missing.append(item)

            resolved = references.resolve_output_source(task, source)
            if resolved and resolved.get("kind") in ("canonical", "legacy_name"):
                producer_id = resolved["node_id"]
                output_id = resolved["output_id"]
                value_found, value, provenance = self._previous_output(
                    task, session_id, producer_id, output_id)
                if value_found:
                    direct_source = resolved.get("canonical") or source
                    requirements = copy.deepcopy(provenance)
                    requirements[direct_source] = _json_digest(value)
                    reused_item = {
                        "source": resolved.get("canonical") or source,
                        "label": (
                            f"{resolved.get('node_name') or producer_id} > "
                            f"{resolved.get('output_name') or output_id}"
                        ),
                    }
                    if source_systems:
                        reused_item["systems"] = sorted(source_systems)
                        conditional_reuse.append({
                            "kind": "node_output",
                            "systems": sorted(source_systems),
                            "producer_node": producer_id,
                            "output_id": output_id,
                            "value": value,
                            "requirements": requirements,
                        })
                    else:
                        self._seed_node_output(
                            seed_nodes, producer_id, output_id, value)
                        merge_provenance(requirements)
                    reused_sources.append(reused_item)
                    continue
                producer = next(
                    (node for node in task.get("nodes") or []
                     if isinstance(node, dict) and node.get("id") == producer_id),
                    {},
                )
                add_missing({
                    "key": resolved.get("canonical") or source,
                    "source": source,
                    "source_kind": "node_output",
                    "producer_node": producer_id,
                    "output_id": output_id,
                    "field": field,
                    "label": (
                        f"{producer.get('name') or producer_id} > "
                        f"{resolved.get('output_name') or output_id}"
                    ),
                })
                continue
            if source.startswith("$.inputs_from."):
                name = source[len("$.inputs_from."):]
                add_missing({
                    "key": source,
                    "source": source,
                    "source_kind": "task_input",
                    "field": field,
                    "input_name": name,
                    "label": f"실행 입력 > {name}",
                })
                continue
            if source == "$.key":
                add_missing({
                    "key": source,
                    "source": source,
                    "source_kind": "run_key",
                    "field": "업무 Key",
                    "label": "업무 Key",
                })
                continue
            add_missing({
                "key": source,
                "source": source,
                "source_kind": "unknown",
                "field": field,
                "label": field,
            })
        return (
            seed_nodes, seed_inputs, missing, reused_sources,
            reuse_requirements, reuse_conflicts, conditional_reuse,
        )

    def _previous_output(self, task, session_id, node_id, output_id):
        for state in self._compatible_completed(task, session_id, node_id):
            output = (state.get("result") or {}).get("output") or {}
            if output_id in output:
                return (
                    True,
                    output[output_id],
                    copy.deepcopy(state.get("runtime_provenance") or {}),
                )
        return False, None, {}

    def _previous_label(self, task, session_id, node_id):
        for state in self._compatible_completed(task, session_id, node_id):
            result = state.get("result") or {}
            if "label" in result:
                return (
                    True,
                    result["label"],
                    copy.deepcopy(state.get("runtime_provenance") or {}),
                )
        return False, None, {}

    @staticmethod
    def _seed_node_output(seed_nodes, node_id, output_id, value):
        node_state = seed_nodes.setdefault(node_id, {"history": [{"output": {}}]})
        node_state["history"][-1].setdefault("output", {})[output_id] = value

    @staticmethod
    def _seed_node_label(seed_nodes, node_id, label):
        node_state = seed_nodes.setdefault(node_id, {"history": [{"output": {}}]})
        node_state["history"][-1]["label"] = label

    # --------------------------------------------------------------- execution

    def start(self, session_id, test_id, values=None, system=None):
        try:
            initial = self._load_state(test_id)
            with mutation_lock.resource_mutation_lock(
                    self.project_root, "node-test",
                    self._lock_identity(initial)):
                state = self._load_state(test_id)
                if state.get("session_id") != session_id:
                    return {"status": "invalid", "reason": "다른 Creator 세션의 테스트입니다"}
                canonical = self._ensure_canonical_revision(state)
                if canonical is not True:
                    return canonical
                dependencies = self._ensure_candidate_dependencies(state)
                if dependencies is not True:
                    return dependencies
                if state.get("status") not in ("needs_input", "prepared"):
                    return self._public(state)
                return self._execute_locked(
                    state, values=values or {}, system=system)
        except mutation_lock.MutationBusy as exc:
            return self._busy(exc)

    def cancel(self, session_id, test_id, deferred=False):
        """화면 설정이 바뀐 테스트를 무효화하고 대기 중 agent job을 제거한다."""
        try:
            initial = self._load_state(test_id)
            with mutation_lock.resource_mutation_lock(
                    self.project_root, "node-test",
                    self._lock_identity(initial)):
                state = self._load_state(test_id)
                if state.get("session_id") != session_id:
                    return {
                        "status": "invalid",
                        "reason": "다른 Creator 세션의 테스트입니다",
                    }
                target_status = "cancelled" if deferred else "stale"
                if state.get("status") != target_status:
                    state.update({
                        "status": target_status,
                        "reason_code": (
                            "user_deferred" if deferred
                            else "questionnaire_changed"
                        ),
                        "reason": "화면 설정이 변경되어 다시 테스트해야 합니다",
                    })
                    if deferred:
                        state["reason"] = (
                            "이번 부분 테스트를 보류했습니다. "
                            "준비되면 다시 테스트해 주세요."
                        )
                    state.pop("job", None)
                    state = self._write_state(state)
                return self._public(state)
        except mutation_lock.MutationBusy as exc:
            return self._busy(exc)

    def _execute_locked(self, state, values, system):
        if not isinstance(values, dict):
            return {"status": "invalid", "reason": "테스트 입력값은 JSON 객체여야 합니다"}
        all_missing = state.get("missing_inputs") or []
        missing_by_key = {
            item["key"]: item
            for item in all_missing
            if not item.get("systems") or system in item.get("systems")
        }
        lacking = [
            item["label"] for key, item in missing_by_key.items()
            if key not in values
            or (isinstance(values.get(key), str) and not values[key].strip())
        ]
        if lacking:
            return {
                **self._public(state),
                "status": "needs_input",
                "reason": "테스트 입력을 모두 채워 주세요: " + ", ".join(lacking),
            }
        choices = state.get("system_choices") or []
        if choices and system not in choices:
            return {
                **self._public(state),
                "status": "needs_input",
                "reason": "테스트할 시스템을 선택해 주세요",
            }
        seed_nodes = copy.deepcopy(state.get("seed_nodes") or {})
        seed_inputs = copy.deepcopy(state.get("seed_inputs") or {})
        temporary_sources = []
        runtime_provenance = copy.deepcopy(
            state.get("reuse_requirements") or {})
        reuse_conflicts = set()
        for item in state.get("conditional_reuse") or []:
            if system not in item.get("systems", []):
                continue
            for source, digest in (item.get("requirements") or {}).items():
                previous = runtime_provenance.get(source)
                if previous is not None and previous != digest:
                    reuse_conflicts.add(source)
                else:
                    runtime_provenance[source] = digest
            if item.get("kind") == "node_output":
                self._seed_node_output(
                    seed_nodes,
                    item["producer_node"],
                    item["output_id"],
                    item.get("value"),
                )
        if reuse_conflicts:
            return {
                **self._public(state),
                "status": "invalid",
                "reason_code": "upstream_context_conflict",
                "reason": (
                    "선택한 시스템에서 재사용할 선행 결과들이 서로 다른 "
                    "실행 입력으로 만들어졌습니다. 같은 입력으로 선행 노드를 "
                    "다시 테스트해 주세요: "
                    + ", ".join(sorted(reuse_conflicts))
                ),
            }
        mismatched_context = [
            source
            for source, digest in runtime_provenance.items()
            if source in values and _json_digest(values[source]) != digest
        ]
        if mismatched_context:
            return {
                **self._public(state),
                "status": "invalid",
                "reason_code": "upstream_context_mismatch",
                "reason": (
                    "현재 테스트 입력이 재사용하려는 선행 노드 테스트의 입력과 "
                    "다릅니다. 해당 선행 노드를 현재 값으로 다시 테스트한 뒤 "
                    "이 노드 테스트를 재시도해 주세요: "
                    + ", ".join(mismatched_context)
                ),
            }
        test_run_key = None
        candidate_path = self._candidate_path(state["test_id"])
        candidate = util.load_json(candidate_path)
        for key, spec in missing_by_key.items():
            value = values[key]
            source = spec.get("source") or key
            if spec.get("source_kind") == "node_label":
                choices = spec.get("choices") or []
                if choices and value not in choices:
                    return {
                        "status": "invalid",
                        "reason": (
                            f"판단 라벨은 다음 중 하나여야 합니다: "
                            f"{', '.join(choices)}"),
                    }
                self._seed_node_label(
                    seed_nodes, spec["producer_node"], value)
            else:
                resolved = references.resolve_output_source(candidate, source)
                if resolved and resolved.get("kind") in ("canonical", "legacy_name"):
                    self._seed_node_output(
                        seed_nodes, resolved["node_id"], resolved["output_id"], value)
                elif source.startswith("$.inputs_from."):
                    seed_inputs[source[len("$.inputs_from."):]] = value
                elif source == "$.key":
                    test_run_key = str(value)
                else:
                    return {
                        "status": "invalid",
                        "reason": f"지원하지 않는 테스트 입력 출처입니다: {source}",
                    }
            temporary_sources.append({
                "source": source,
                "label": spec.get("label"),
            })
            runtime_provenance[source] = _json_digest(value)

        target = next(
            (node for node in candidate.get("nodes") or []
             if isinstance(node, dict) and node.get("id") == state["node_id"]),
            None,
        )
        if target is None:
            state.update({
                "status": "failed",
                "reason": "candidate에서 테스트 노드를 찾을 수 없습니다",
            })
            return self._public(self._write_state(state))

        run = self._new_run(
            candidate_path, candidate, state, seed_nodes, seed_inputs,
            run_key=test_run_key)
        if system:
            run.setdefault("nodes", {}).setdefault(
                state["node_id"], {})["system"] = system
        cfg = engine._effective_cfg(target, run)
        inputs, missing = engine._resolve_inputs(
            candidate, target, copy.deepcopy(run),
            self._test_dir(state["test_id"]))
        blocking = [item for item in missing if not item.get("askable")]
        if blocking:
            state.update({
                "status": "failed",
                "reason_code": blocking[0].get("reason_code"),
                "reason": "테스트 입력을 해석할 수 없습니다",
            })
            return self._public(self._write_state(state))
        runtime_provenance.update(
            self._runtime_file_provenance(target, cfg, inputs))

        dependencies = self._ensure_candidate_dependencies(state)
        if dependencies is not True:
            return dependencies

        state["temporary_sources"] = temporary_sources
        state["temporary_input_used"] = bool(temporary_sources)
        state["runtime_provenance"] = runtime_provenance
        state["resolved_inputs"] = copy.deepcopy(inputs)

        if target.get("type") == "if":
            return self._execute_if(state, candidate, target, run)

        run_path = self._run_path(state["test_id"])
        engine._journal(run, "node_test_start", node=state["node_id"])
        util.atomic_write_json(run_path, run)
        raw = engine._pump(
            candidate, run, run_path, self._runtime_ctx(),
            False, self._test_dir(state["test_id"]))
        return self._consume_runtime_result(state, raw)

    def _execute_if(self, state, task, node, run):
        source_id = node.get("source_node")
        source_entry = util.latest(run, source_id)
        label = source_entry.get("label") if source_entry else None
        if label is None:
            state.update({
                "status": "failed",
                "reason": "분기 테스트에 필요한 판단 라벨이 없습니다",
            })
            return self._public(self._write_state(state))
        case = next(
            (item for item in node.get("cases") or []
             if item.get("value") == label),
            None,
        )
        if case is None:
            state.update({
                "status": "failed",
                "reason": f"라벨 '{label}'에 해당하는 분기가 없습니다",
            })
            return self._public(self._write_state(state))
        state.update({
            "status": "completed",
            "result": {
                "label": label,
                "next_node": case.get("next"),
                "output": {},
            },
            "summary": f"'{label}' 분기로 연결되는 것을 확인했습니다",
        })
        return self._public(self._write_state(state))

    def _new_run(self, candidate_path, candidate, state, seed_nodes, seed_inputs,
                 run_key=None):
        return {
            "task_ref": os.path.abspath(candidate_path),
            "task_fingerprint": self.controller._fingerprint(candidate_path),
            "activity": candidate.get("activity"),
            "task_id": candidate.get("task_id"),
            "key": run_key or f"node-test-{state['test_id']}",
            "status": "running",
            "cursor": state["node_id"],
            "waiting_node": None,
            "waiting_node_label": None,
            "waiting_kind": None,
            "waiting_prompt": None,
            "waiting_fields": [],
            "waiting_slot": None,
            "waiting_targets": [],
            "waiting_open_url": None,
            "waiting_url_opened_at": None,
            "waiting_since": None,
            "nodes": seed_nodes,
            "inputs_from": seed_inputs,
            "manual_inputs": {},
            "started_at": _now(),
            "node_test": True,
            "node_test_target": state["node_id"],
        }

    # --------------------------------------------------------------- pauses/submission

    def _job(self, run_path, run):
        task = util.load_json(run["task_ref"])
        node = next(
            (item for item in task.get("nodes") or []
             if isinstance(item, dict) and item.get("id") == run.get("waiting_node")),
            None,
        )
        if node is None:
            raise ValueError("대기 중인 테스트 노드가 candidate에 없습니다")
        actor = engine.PAUSE_ACTOR.get(run.get("waiting_kind"), "user")
        inputs, _ = engine._resolve_inputs(
            task, node, copy.deepcopy(run), os.path.dirname(run_path))
        reference_manifest = self.controller._reference_manifest(node)
        if "_node_test_prompt" in node:
            prompt_path = None
            try:
                prompt_path = os.path.normcase(os.path.realpath(
                    self.controller.authorize_task_path(
                        node.get("prompt_file"), "read")))
            except (OSError, ValueError, PermissionError):
                pass
            reference_manifest = [
                item for item in reference_manifest
                if (
                    item.get("kind") != "prompt_file"
                    and (
                        prompt_path is None
                        or self._manifest_realpath(item) != prompt_path
                    )
                )
            ]
        return {
            "job_id": self.controller._job_id(run_path, run),
            "revision": self.controller._revision(run_path),
            "actor": actor,
            "kind": run.get("waiting_kind"),
            "node_label": run.get("waiting_node_label") or run.get("waiting_node"),
            "prompt": run.get("waiting_prompt"),
            "inputs": inputs,
            "reference_manifest": reference_manifest,
            "allowed_labels": [x for x in (node.get("labels") or []) if x],
            "result_schema": self.controller._result_schema(run, node),
            "fields": copy.deepcopy(run.get("waiting_fields") or []),
            "slot": run.get("waiting_slot"),
        }

    def _manifest_realpath(self, item):
        try:
            return os.path.normcase(os.path.realpath(
                self.controller.authorize_task_path(
                    item.get("path"), "read")))
        except (OSError, ValueError, PermissionError):
            return None

    def _consume_runtime_result(self, state, raw):
        run_path = self._run_path(state["test_id"])
        if raw.get("status") == "paused":
            run = util.load_json(run_path)
            job = self._job(run_path, run)
            waiting_status = (
                "waiting_agent" if job["actor"] == "agent" else "waiting_user")
            state.update({
                "status": waiting_status,
                "job": job,
                "instruction": (
                    f'Code Assistant 대화로 돌아가 “{state.get("node_no") or ""}번 '
                    '노드 테스트 진행”이라고 입력해 주세요.'
                    if waiting_status == "waiting_agent" else
                    "아래 실행 입력을 채워 테스트를 계속해 주세요."
                ),
            })
            return self._public(self._write_state(state))
        if raw.get("status") == "done":
            run = util.load_json(run_path)
            entry = util.latest(run, state["node_id"]) or {"output": {}}
            candidate = util.load_json(self._candidate_path(state["test_id"]))
            node = next(
                (item for item in candidate.get("nodes") or []
                 if isinstance(item, dict) and item.get("id") == state["node_id"]),
                {},
            )
            outputs = entry.get("output") or {}
            display_outputs = [
                {
                    "id": item.get("id"),
                    "name": item.get("name") or item.get("id"),
                    "value": outputs.get(item.get("id")),
                }
                for item in node.get("outputs") or []
                if item.get("id") in outputs
            ]
            result = {
                "output": outputs,
                "display_outputs": display_outputs,
            }
            for key in ("label", "evidence", "path", "manual_done"):
                if key in entry:
                    result[key] = entry[key]
            if state.get("temporary_sources"):
                result["temporary_sources"] = state["temporary_sources"]
            state.update({
                "status": "completed",
                "result": result,
                "summary": "대상 노드 하나만 실행해 결과를 확인했습니다",
            })
            state.pop("job", None)
            return self._public(self._write_state(state))
        state.update({
            "status": "failed",
            "reason_code": raw.get("reason_code"),
            "reason": raw.get("reason") or "노드 테스트 실행에 실패했습니다",
        })
        return self._public(self._write_state(state))

    def submit_user(self, session_id, test_id, result,
                    expected_revision=None, job_id=None):
        return self._submit(
            test_id, result, expected_actor="user",
            session_id=session_id, expected_revision=expected_revision,
            job_id=job_id)

    def submit_agent(self, test_id, result, expected_revision, job_id,
                     idempotency_key, defer_pump=False):
        request = {
            "launch_id": self.launch_id,
            "test_id": test_id,
            "job_id": job_id,
            "expected_revision": expected_revision,
            "result_digest": _json_digest(result),
        }

        def action():
            return self._submit(
                test_id, result, expected_actor="agent",
                expected_revision=expected_revision, job_id=job_id,
                defer_pump=defer_pump)

        return self.controller._idempotent(
            "node_test_agent_submit", idempotency_key, request, action)

    def _submit(self, test_id, result, expected_actor, session_id=None,
                expected_revision=None, job_id=None, defer_pump=False):
        try:
            initial = self._load_state(test_id)
            with mutation_lock.resource_mutation_lock(
                    self.project_root, "node-test",
                    self._lock_identity(initial)):
                state = self._load_state(test_id)
                if session_id is not None and state.get("session_id") != session_id:
                    return {"status": "invalid", "reason": "다른 Creator 세션의 테스트입니다"}
                expected_status = (
                    "waiting_agent" if expected_actor == "agent" else "waiting_user")
                if state.get("status") != expected_status:
                    return self._public(state, include_agent_job=expected_actor == "agent")
                canonical = self._ensure_canonical_revision(state)
                if canonical is not True:
                    return canonical
                dependencies = self._ensure_candidate_dependencies(state)
                if dependencies is not True:
                    return dependencies
                provenance = self._ensure_runtime_provenance(state)
                if provenance is not True:
                    return provenance
                run_path = self._run_path(test_id)
                run = util.load_json(run_path)
                task = util.load_json(run["task_ref"])
                node = next(
                    (item for item in task.get("nodes") or []
                     if isinstance(item, dict)
                     and item.get("id") == run.get("waiting_node")),
                    None,
                )
                if node is None:
                    return {"status": "failed", "reason": "대기 노드를 찾을 수 없습니다"}
                actor = engine.PAUSE_ACTOR.get(run.get("waiting_kind"), "user")
                if actor != expected_actor:
                    return {
                        "status": "invalid",
                        "reason": f"이 테스트 작업은 {actor} 입력을 기다리고 있습니다",
                    }
                current_revision = self.controller._revision(run_path)
                current_job_id = self.controller._job_id(run_path, run)
                if expected_revision and expected_revision != current_revision:
                    return {
                        "status": "conflict",
                        "reason_code": "stale_revision",
                        "reason": "테스트 작업이 변경되어 최신 상태를 다시 확인해야 합니다",
                    }
                if job_id and job_id != current_job_id:
                    return {
                        "status": "conflict",
                        "reason_code": "stale_job",
                        "reason": "현재 대기 중인 테스트 작업과 일치하지 않습니다",
                    }
                shape_error = self.controller._validate_job_result(run, node, result)
                if shape_error:
                    return {
                        "status": "invalid",
                        "reason_code": "invalid_job_result",
                        "reason": shape_error,
                    }
                raw = engine.resume(
                    run_path, run.get("waiting_node"), result,
                    ctx=self._runtime_ctx(), defer_pump=defer_pump)
                if defer_pump and raw.get("status") == "running":
                    state.update({"status": "processing"})
                    state.pop("job", None)
                    return self._public(self._write_state(state))
                return self._consume_runtime_result(state, raw)
        except mutation_lock.MutationBusy as exc:
            return self._busy(exc)

    def continue_agent(self, test_id):
        try:
            initial = self._load_state(test_id)
            with mutation_lock.resource_mutation_lock(
                    self.project_root, "node-test",
                    self._lock_identity(initial)):
                state = self._load_state(test_id)
                if state.get("status") != "processing":
                    return self._public(state)
                raw = engine.continue_run(
                    self._run_path(test_id), ctx=self._runtime_ctx())
                return self._consume_runtime_result(state, raw)
        except mutation_lock.MutationBusy as exc:
            return self._busy(exc)

    # --------------------------------------------------------------- queries/cleanup

    def list_session(self, session_id, node_id=None, test_id=None):
        if test_id is not None:
            state = self._load_state(test_id)
            if state.get("session_id") != session_id:
                return {
                    "status": "invalid",
                    "reason_code": "wrong_node_test_session",
                    "reason": "다른 Creator 세션의 테스트입니다",
                }
            if node_id is not None and state.get("node_id") != node_id:
                return {
                    "status": "invalid",
                    "reason_code": "wrong_node_test_target",
                    "reason": "요청한 노드와 테스트 대상이 일치하지 않습니다",
                }
            return self._public(state)
        states = [
            state for state in self._iter_states()
            if state.get("session_id") == session_id
            and (node_id is None or state.get("node_id") == node_id)
        ]
        states.sort(key=lambda item: str(item.get("updated_at") or ""), reverse=True)
        if node_id is not None:
            if not states:
                return {
                    "status": "failed",
                    "reason_code": "node_test_not_found",
                    "reason": "이 노드의 테스트 기록이 없습니다",
                }
            return self._public(states[0])
        return {
            "status": "ok",
            "tests": [self._public(state) for state in states],
        }

    def list_agent_jobs(self):
        jobs = []
        for state in self._iter_states():
            if state.get("status") != "waiting_agent":
                continue
            if not self._agent_job_is_current(state):
                continue
            item = self._public(state, include_agent_job=True)
            item["test_id"] = state["test_id"]
            jobs.append(item)
        jobs.sort(key=lambda item: str(item.get("created_at") or ""))
        return {
            "status": "ok",
            "launch_id": self.launch_id,
            "job_count": len(jobs),
            "jobs": jobs,
        }

    def cleanup_session(self, session_id):
        states = [
            state for state in self._iter_states()
            if state.get("session_id") == session_id
        ]
        resources = [
            ("node-test", self._lock_identity(state)) for state in states
        ]
        removed = 0
        with mutation_lock.multi_resource_mutation_lock(
                self.project_root, resources, blocking=True):
            for state in states:
                path = self._test_dir(state["test_id"])
                try:
                    current = self._load_state(state["test_id"])
                except (OSError, ValueError, json.JSONDecodeError):
                    continue
                if (
                    current.get("session_id") == session_id
                    and self.controller._inside(path, self.root)
                    and os.path.isdir(path)
                ):
                    self._remove_snapshot(current["test_id"])
                    shutil.rmtree(path)
                    removed += 1
        return removed

    def _remove_snapshot(self, test_id):
        run_path = self._run_path(test_id)
        try:
            run = util.load_json(run_path)
        except (OSError, ValueError, json.JSONDecodeError):
            return
        if not run.get("snapshot_ref"):
            return
        snapshot_path = engine._snapshot_task_path(run_path)
        try:
            shutil.rmtree(os.path.dirname(snapshot_path))
        except FileNotFoundError:
            pass

    def cleanup(self):
        root = os.path.realpath(self.root)
        states = list(self._iter_states())
        resources = [
            ("node-test", self._lock_identity(state)) for state in states
        ]
        if (
            root != self.tests_root
            and self.controller._inside(root, self.tests_root)
            and os.path.isdir(root)
        ):
            with mutation_lock.multi_resource_mutation_lock(
                    self.project_root, resources, blocking=True):
                if os.path.isdir(root):
                    for state in states:
                        self._remove_snapshot(state["test_id"])
                    shutil.rmtree(root)
