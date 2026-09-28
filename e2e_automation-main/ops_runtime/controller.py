# -*- coding: utf-8 -*-
"""Creator와 Runner가 공유하는 프로젝트 단위 서비스 계층.

CLI와 HTTP 구현에서 공통으로 사용하는 저작·검증·실행 기능을 제공한다. 경로와
revision, 작업 주체, 중복 실행 방지 조건도 이 계층에서 함께 확인한다.
"""
from copy import deepcopy
import datetime
import hashlib
import json
import os
import re
import shutil
import threading

from . import author_apply, author_questions, engine, mutation_lock, references
from . import task_compat, task_reset, util, validate, workspace, yaml_to_task


_IDEMPOTENCY_KEY_RE = re.compile(r"^[^\x00-\x1f]{8,200}$")
_RUN_DIRS = (os.path.join(".ops", "runs"), "runs")
_FILE_PREVIEW_MAX_BYTES = 10 * 1024 * 1024
_DROP_TRANSPORT_KEYS = {
    "payload_file", "resume_command", "open_command", "start_command",
}


class Controller:
    """전송 방식과 무관하게 하나의 프로젝트 루트에서 동작하는 서비스 계층."""

    def __init__(self, project_root, trusted_roots=None, create_state=True):
        root = os.path.realpath(os.path.abspath(project_root))
        if not os.path.isdir(root):
            raise ValueError(f"프로젝트 루트가 존재하지 않습니다: {project_root}")
        if not os.path.isdir(os.path.join(root, "ops_runtime")):
            raise ValueError(f"ops_runtime 폴더가 없는 프로젝트입니다: {project_root}")
        self.project_root = root
        state_root = os.path.realpath(os.path.join(root, ".ops"))
        if not self._inside(state_root, root):
            raise ValueError(".ops 상태 경로가 프로젝트 루트 밖을 가리킵니다")
        configured = self._configured_trusted_roots()
        requested = list(trusted_roots or [])
        self.trusted_roots = tuple(self._canonical_root(p) for p in configured + requested)
        self.runs_dir = os.path.join(root, ".ops", "runs")
        self.controller_dir = os.path.join(root, ".ops", "controller")
        self.idempotency_dir = os.path.join(self.controller_dir, "idempotency")
        for label, path in (
                ("run", self.runs_dir),
                ("controller", self.controller_dir),
                ("idempotency", self.idempotency_dir)):
            if not self._inside(os.path.realpath(path), root):
                raise ValueError(
                    f"{label} 상태 경로가 프로젝트 루트 밖을 가리킵니다")
        if create_state:
            os.makedirs(self.runs_dir, exist_ok=True)
            os.makedirs(self.idempotency_dir, exist_ok=True)
        self._serial = threading.RLock()
        self._workflow_task_cache = {}
        self._validation_cache = {}
        self._ui = None

    def attach_ui(self, ui_bridge):
        self._ui = ui_bridge

    # ------------------------------------------------------------------ workflow/author

    def workflow_list_tasks(self, yaml_ref, workflow_id=None):
        try:
            path = self._resolve_project_ref(yaml_ref, must_exist=True,
                                             suffixes=(".yaml", ".yml"))
            fingerprint = self._fingerprint(path, length=None)
            cache_key = (path, workflow_id)
            with self._serial:
                cached = self._workflow_task_cache.get(cache_key)
                if cached and cached["fingerprint"] == fingerprint:
                    return deepcopy(cached["result"])
                tasks = yaml_to_task.list_tasks(
                    path, workflow_id=workflow_id)
                result = {
                    "status": "ok",
                    "yaml_ref": self._ref(path),
                    "yaml_fingerprint": fingerprint,
                    "tasks": tasks,
                    "selection": yaml_to_task.task_selection(tasks),
                }
                self._workflow_task_cache[cache_key] = {
                    "fingerprint": fingerprint,
                    "result": deepcopy(result),
                }
                return result
        except (OSError, ValueError, KeyError) as exc:
            return self._failure("invalid_workflow", exc)

    def project_catalog(self):
        """프로젝트의 YAML 정의와 기존 task JSON을 변경하지 않고 한 목록으로 만든다."""
        try:
            yaml_paths = self._project_files((".yaml", ".yml"))
            task_paths = self._project_files(
                (".json",), roots=(os.path.join(self.project_root, "workflows"),))
            run_index = self._run_index()
            task_records = []
            for path in task_paths:
                try:
                    task = self._load_json(path)
                except (OSError, ValueError, json.JSONDecodeError):
                    continue
                if not isinstance(task, dict) or not isinstance(
                        task.get("task_id"), str):
                    continue
                task_records.append({
                    "path": path,
                    "ref": self._ref(path),
                    "task": task,
                    "matched": False,
                })

            workflows = []
            for yaml_path in yaml_paths:
                listed = self.workflow_list_tasks(self._ref(yaml_path))
                # 프로젝트 전체에는 CI·배포 설정 등 일반 YAML도 섞여 있다.
                # yaml_to_task가 실제 task를 하나 이상 찾은 workflow만 대시보드에 노출한다.
                if (
                    listed.get("status") != "ok"
                    or not (listed.get("tasks") or [])
                ):
                    continue
                yaml_ref = listed["yaml_ref"]
                yaml_sha = listed["yaml_fingerprint"]
                accepted_source_hashes = {
                    value.lower() for value in util.source_yaml_hashes(yaml_path)
                }
                yaml_name = os.path.basename(yaml_path).casefold()
                items = []
                for yaml_task in listed.get("tasks") or []:
                    task_id = yaml_task.get("id")
                    candidates = []
                    for record in task_records:
                        task = record["task"]
                        source_id = task.get("source_task_id") or task.get("task_id")
                        source = str(task.get("source_yaml") or "").replace("\\", "/")
                        source_name = os.path.basename(source).casefold()
                        if source_id == task_id and source_name == yaml_name:
                            candidates.append(record)
                    current = next((
                        record for record in candidates
                        if str(record["task"].get("source_yaml_sha256") or "").lower()
                        in accepted_source_hashes
                    ), None)
                    record = current or (candidates[0] if candidates else None)
                    if record is None:
                        items.append({
                            **yaml_task,
                            "author_state": "not_created",
                            "author_label": "Agent 미생성",
                            "validation_state": "not_created",
                            "run_state": "none",
                            "run_label": "실행 이력 없음",
                        })
                        continue
                    record["matched"] = True
                    item = self._task_catalog_item(
                        record["path"], record["task"], run_index=run_index)
                    source_changed = (
                        str(record["task"].get("source_yaml_sha256") or "").lower()
                        not in accepted_source_hashes
                    )
                    if source_changed:
                        item.update({
                            "author_state": "source_changed",
                            "author_label": "원본 YAML 변경",
                            "source_changed": True,
                        })
                    items.append({**yaml_task, **item})
                workflows.append({
                    "status": "ok",
                    "yaml_ref": yaml_ref,
                    "yaml_fingerprint": yaml_sha,
                    "tasks": items,
                })

            standalone = [
                self._task_catalog_item(
                    record["path"], record["task"], run_index=run_index)
                for record in task_records if not record["matched"]
            ]
            return {
                "status": "ok",
                "workflows": workflows,
                "standalone_tasks": standalone,
                "summary": {
                    "workflow_count": len(workflows),
                    "yaml_task_count": sum(
                        len(item.get("tasks") or []) for item in workflows),
                    "standalone_task_count": len(standalone),
                },
            }
        except (OSError, ValueError, KeyError, json.JSONDecodeError) as exc:
            return self._failure("project_catalog_failed", exc)

    def _task_catalog_item(self, task_path, task=None, run_index=None):
        task = task or self._load_json(task_path)
        task_fingerprint = self._fingerprint(task_path)
        stage = self._author_stage(task, task_path)
        state_map = {
            "structure_gate": ("design_required", "노드 구성 필요"),
            "io_gate": ("design_required", "입출력 구성 필요"),
            "questionnaire": ("details_required", "상세 설정 필요"),
            "ready_to_validate": ("ready_to_validate", "검증 필요"),
        }
        author_state, author_label = state_map.get(
            stage, ("ready_to_validate", "검증 필요"))
        validation_state = "pending"
        validation = {"ok": None, "error_count": 0, "warning_count": 0}
        if stage == "ready_to_validate":
            dependency_signature = self._validation_dependency_signature(
                task, task_path)
            validation_key = (
                task_path, task_fingerprint, dependency_signature)
            with self._serial:
                checked = self._validation_cache.get(validation_key)
                if checked is None:
                    raw = validate.validate(task, task_path)
                    checked = {
                        "ok": bool(raw.get("ok")),
                        "error_count": len(raw.get("errors") or []),
                        "warning_count": len(raw.get("warnings") or []),
                    }
                    for old_key in list(self._validation_cache):
                        if old_key[0] == task_path and old_key != validation_key:
                            self._validation_cache.pop(old_key, None)
                    self._validation_cache[validation_key] = checked
                validation.update(checked)
            validation_state = "valid" if checked.get("ok") else "invalid"
            author_state = validation_state
            author_label = "사용 가능" if checked.get("ok") else "검증 오류"

        runs = []
        indexed_runs = (
            run_index.get((task.get("activity"), task.get("task_id")), [])
            if run_index is not None else self._iter_task_runs(task)
        )
        for run_path, run in indexed_runs:
            runs.append({
                "run_ref": self._ref(run_path),
                "key": run.get("key"),
                "status": run.get("status"),
                "waiting_actor": (
                    engine.PAUSE_ACTOR.get(run.get("waiting_kind"), "user")
                    if run.get("status") == "waiting" else None
                ),
                "updated_at": (
                    ((run.get("journal") or [{}])[-1].get("at"))
                    or run.get("waiting_since")
                    or run.get("started_at")
                ),
                "progress": engine._progress(run),
            })
        runs.sort(key=lambda item: str(item.get("updated_at") or ""), reverse=True)
        active = [item for item in runs if item.get("status") != "done"]
        if any(item.get("status") == "waiting"
               and item.get("waiting_actor") == "agent" for item in active):
            run_state, run_label = "waiting_agent", "AI 처리 대기"
        elif any(item.get("status") == "waiting" for item in active):
            run_state, run_label = "waiting_user", "사용자 입력 대기"
        elif any(item.get("status") == "error" for item in active):
            run_state, run_label = "error", "실행 오류"
        elif active:
            run_state, run_label = "running", "진행 중"
        elif runs:
            run_state, run_label = "done", "완료"
        else:
            run_state, run_label = "none", "실행 이력 없음"
        return {
            "task_ref": self._ref(task_path),
            "task_fingerprint": task_fingerprint,
            "revision": task_fingerprint,
            "task_id": task.get("task_id"),
            "task_name": task.get("task_name") or task.get("task_id"),
            "activity": task.get("activity"),
            "schema_version": task.get("schema_version"),
            "author_stage": stage,
            "author_state": author_state,
            "author_label": author_label,
            "validation_state": validation_state,
            "validation": validation,
            "run_state": run_state,
            "run_label": run_label,
            "active_run_count": len(active),
            "completed_run_count": len(runs) - len(active),
            "recent_runs": runs[:10],
        }

    def _validation_dependency_signature(self, task, task_path):
        """검증 결과에 영향을 주는 로컬 파일의 존재 여부와 내용을 추적한다."""
        values = []

        def add(stored, resolve_from_project=False):
            if not isinstance(stored, str) or not stored.strip():
                return
            actual = (
                workspace.resolve_project_path(stored, task_path)
                if resolve_from_project else os.path.abspath(stored)
            )
            actual = os.path.realpath(actual)
            try:
                stat = os.stat(actual)
            except OSError:
                values.append((actual, "missing"))
                return
            if os.path.isdir(actual):
                try:
                    names = sorted(os.listdir(actual))
                except OSError:
                    names = ["<unreadable>"]
                entries = []
                for name in names:
                    child = os.path.join(actual, name)
                    try:
                        child_stat = os.stat(child)
                        entries.append((
                            name,
                            child_stat.st_mtime_ns,
                            child_stat.st_size,
                            os.path.isdir(child),
                        ))
                    except OSError:
                        entries.append((name, "missing"))
                values.append((
                    actual, "directory", stat.st_mtime_ns, tuple(entries)))
            else:
                values.append((
                    actual, "file", stat.st_mtime_ns, stat.st_size))

        for node in task.get("nodes") or []:
            if not isinstance(node, dict):
                continue
            add(node.get("prompt_file"), resolve_from_project=True)
            add(node.get("custom_logic"))
            references = node.get("references")
            references = references if isinstance(references, list) else []
            for reference in references:
                add(reference, resolve_from_project=True)
            systems = node.get("systems")
            systems = systems if isinstance(systems, list) else []
            for config in [node] + systems:
                if not isinstance(config, dict):
                    continue
                integration = config.get("integration") or {}
                if isinstance(integration, dict):
                    add(integration.get("ca_bundle"))
        return tuple(values)

    def _run_index(self):
        """각 run 파일을 한 번씩 읽어 카탈로그 표시 단위로 묶는다."""
        index = {}
        seen = set()
        for relative in _RUN_DIRS:
            folder = os.path.join(self.project_root, relative)
            canonical_folder = os.path.realpath(folder)
            if not self._inside(canonical_folder, self.project_root):
                continue
            try:
                names = sorted(os.listdir(folder))
            except OSError:
                continue
            for name in names:
                if not name.endswith(".json"):
                    continue
                path = os.path.join(folder, name)
                canonical = os.path.normcase(os.path.realpath(path))
                if (
                    not self._inside(canonical, canonical_folder)
                    or canonical in seen
                ):
                    continue
                try:
                    run = self._load_json(path)
                except (OSError, ValueError, json.JSONDecodeError):
                    continue
                activity = run.get("activity")
                task_id = run.get("task_id")
                if not isinstance(activity, str) or not isinstance(task_id, str):
                    continue
                seen.add(canonical)
                index.setdefault((activity, task_id), []).append((path, run))
        return index

    def _project_files(self, suffixes, roots=None):
        excluded = {
            ".git", ".ops", ".pytest_cache", "__pycache__",
            "node_modules", ".venv", "venv",
        }
        result = []
        for root in roots or (self.project_root,):
            root = os.path.realpath(root)
            if not os.path.isdir(root) or not self._inside(root, self.project_root):
                continue
            for folder, dirs, files in os.walk(root):
                dirs[:] = [
                    name for name in dirs
                    if name not in excluded and not name.startswith(".")
                ]
                for name in files:
                    if name.lower().endswith(tuple(
                            suffix.lower() for suffix in suffixes)):
                        result.append(os.path.join(folder, name))
        return sorted(
            {os.path.realpath(path) for path in result},
            key=lambda path: self._ref(path).casefold(),
        )

    def task_create_draft(self, yaml_ref, task_id, out_ref=None,
                          expected_yaml_fingerprint=None, idempotency_key=None,
                          overwrite=False, expected_task_fingerprint=None):
        request = {
            "yaml_ref": yaml_ref, "task_id": task_id, "out_ref": out_ref,
            "expected_yaml_fingerprint": expected_yaml_fingerprint,
            "overwrite": bool(overwrite),
            "expected_task_fingerprint": expected_task_fingerprint,
        }

        def action():
            yaml_path = self._resolve_project_ref(
                yaml_ref, must_exist=True, suffixes=(".yaml", ".yml"))
            current_yaml = self._fingerprint(yaml_path, length=None)
            if not expected_yaml_fingerprint:
                return self._invalid("expected_yaml_fingerprint가 필요합니다")
            if current_yaml != expected_yaml_fingerprint:
                return self._conflict(
                    "stale_yaml_fingerprint",
                    "목록을 조회한 뒤 YAML이 변경되었습니다",
                    current_yaml_fingerprint=current_yaml,
                )
            task = yaml_to_task.build_task(yaml_path, task_id)
            task.pop("_edges_checked", None)
            out_path = (
                self._resolve_project_ref(out_ref, must_exist=False, suffixes=(".json",))
                if out_ref else self._default_task_path(task)
            )
            if os.path.exists(out_path) and overwrite:
                current_task = self._fingerprint(out_path)
                if not expected_task_fingerprint:
                    return self._invalid(
                        "기존 Task를 덮어쓰려면 expected_task_fingerprint가 필요합니다",
                        reason_code="missing_task_fingerprint",
                        current_task_fingerprint=current_task,
                    )
                if expected_task_fingerprint != current_task:
                    return self._conflict(
                        "stale_task_fingerprint",
                        "덮어쓰기 확인 뒤 기존 Task가 변경되었습니다",
                        current_task_fingerprint=current_task,
                    )
            if os.path.exists(out_path) and not overwrite:
                existing = self._load_json(out_path)
                old_hash = existing.get("source_yaml_sha256")
                accepted_source_hashes = util.source_yaml_hashes(yaml_path)
                if (existing.get("task_id") == task.get("task_id")
                        and old_hash in accepted_source_hashes):
                    return {
                        "status": "exists_same_source",
                        "task_ref": self._ref(out_path),
                        "task_fingerprint": self._fingerprint(out_path),
                        "revision": self._revision(out_path),
                        "next_action": "author_open",
                    }
                code = (
                    "source_changed"
                    if old_hash and old_hash not in accepted_source_hashes
                    else "task_exists"
                )
                return self._conflict(
                    code,
                    "기존 task를 보호하기 위해 덮어쓰지 않았습니다",
                    task_ref=self._ref(out_path),
                    incomplete_runs=yaml_to_task.incomplete_runs(
                        task, runs_dir=self.runs_dir),
                )
            write_result = yaml_to_task.write_task_json(out_path, task)
            if write_result.get("status") != "ok":
                return write_result
            return {
                "status": "ok",
                "task_ref": self._ref(out_path),
                "task_fingerprint": self._fingerprint(out_path),
                "revision": self._revision(out_path),
                "nodes": len(task.get("nodes") or []),
                "pending_markers": json.dumps(task, ensure_ascii=False).count(
                    author_questions.PENDING),
                "next_action": "author_open",
            }

        return self._idempotent("task_create_draft", idempotency_key, request, action)

    def task_delete_preview(self, task_ref):
        """Dashboard 확인창에 표시할 YAML Task 완전 삭제 범위를 계산한다."""
        try:
            manifest = task_reset.build_manifest(self, task_ref)
            return task_reset.public_preview(self, manifest)
        except ValueError as exc:
            if str(exc) == "yaml_task_required":
                return self._invalid(
                    "YAML에서 만든 Task만 처음부터 다시 만들 수 있습니다",
                    reason_code="yaml_task_required",
                )
            return self._failure("task_delete_preview_failed", exc)
        except (OSError, KeyError, json.JSONDecodeError) as exc:
            return self._failure("task_delete_preview_failed", exc)

    def task_delete(self, task_ref, expected_task_fingerprint=None,
                    confirmation_task_name=None, idempotency_key=None):
        """YAML Task와 전용 산출물·실행 상태를 영구 삭제한다."""
        request = {
            "task_ref": task_ref,
            "expected_task_fingerprint": expected_task_fingerprint,
            "confirmation_task_name": confirmation_task_name,
        }

        def action():
            manifest = task_reset.build_manifest(self, task_ref)
            current = manifest["task_fingerprint"]
            if not expected_task_fingerprint:
                return self._invalid(
                    "expected_task_fingerprint가 필요합니다",
                    reason_code="missing_task_fingerprint",
                    current_task_fingerprint=current,
                )
            if expected_task_fingerprint != current:
                return self._conflict(
                    "stale_task_fingerprint",
                    "삭제 확인 뒤 Task가 변경되었습니다",
                    current_task_fingerprint=current,
                )
            if confirmation_task_name != manifest["task_name"]:
                return self._invalid(
                    "Task 이름을 정확히 입력해 주세요",
                    reason_code="task_delete_confirmation_mismatch",
                )
            preview = task_reset.public_preview(self, manifest)
            removed_files, removed_directories = task_reset.delete_manifest(
                self, manifest)
            with self._serial:
                self._validation_cache = {
                    key: value for key, value in self._validation_cache.items()
                    if key[0] != manifest["task_path"]
                }
                self._workflow_task_cache.clear()
            return {
                "status": "ok",
                "deleted": True,
                "recoverable": False,
                "task_ref": manifest["task_ref"],
                "task_name": manifest["task_name"],
                "removed_files": removed_files,
                "removed_directories": removed_directories,
                "delete_counts": preview["delete_counts"],
            }

        return self._idempotent(
            "task_delete", idempotency_key, request, action)

    def author_open(self, task_ref, stage="auto"):
        try:
            task_path = self._task_path(task_ref)
            if self._ui is None:
                task = self._load_json(task_path)
                state = author_questions.build_output(
                    task, os.path.dirname(task_path), task_path=task_path)
                return {
                    "status": "fallback",
                    "stage": state.get("stage"),
                    "task_ref": self._ref(task_path),
                    "task_fingerprint": self._fingerprint(task_path),
                    "revision": self._revision(task_path),
                    "fallback": "clipboard",
                    "form_path": state.get("form_path") or state.get("structure_form_path"),
                }
            result = self._ui.create_author_session(task_path, requested_stage=stage)
            result.update({
                "status": "ok",
                "task_ref": self._ref(task_path),
                "task_fingerprint": self._fingerprint(task_path),
                "revision": self._revision(task_path),
                "fallback": "clipboard",
            })
            return result
        except (OSError, ValueError, KeyError) as exc:
            return self._failure("author_open_failed", exc)

    def author_status(self, task_ref, session_id=None):
        try:
            task_path = self._task_path(task_ref)
            if self._ui and session_id:
                ui_status = self._ui.session_status(session_id, task_path)
            else:
                ui_status = {}
            task = self._load_json(task_path)
            stage = self._author_stage(task, task_path)
            result = {
                "status": ui_status.get("status", "ready"),
                "stage": stage,
                "task_ref": self._ref(task_path),
                "task_fingerprint": self._fingerprint(task_path),
                "revision": self._revision(task_path),
            }
            for key in ("session_id", "submitted_at", "last_submission"):
                if key in ui_status:
                    result[key] = ui_status[key]
            return result
        except (OSError, ValueError, KeyError) as exc:
            return self._failure("author_status_failed", exc)

    def apply_author_submission(self, task_ref, submission, expected_revision,
                                idempotency_key, author_intent="author",
                                author_phase=None):
        """HTTP UI가 호출하는 결정적 저작 결과 적용 경계."""
        if author_intent not in ("author", "revise"):
            return self._invalid(
                f"지원하지 않는 저작 intent입니다: {author_intent}")
        if author_phase not in (None, "canonical", "design",
                                "revision_questionnaire"):
            return self._invalid(
                f"지원하지 않는 저작 phase입니다: {author_phase}")
        request = {
            "task_ref": task_ref,
            "expected_revision": expected_revision,
            "submission_digest": self._digest(submission),
        }
        # 기존 기본 저작 요청의 idempotency digest는 업그레이드 전 receipt와
        # 호환한다. 새 보안 경계가 실제로 필요한 수정 세션만 intent/phase를 넣는다.
        if author_intent != "author":
            request["author_intent"] = author_intent
        if author_phase not in (None, "canonical"):
            request["author_phase"] = author_phase

        def action():
            task_path = self._task_path(task_ref)
            stale = self._check_revision(task_path, expected_revision)
            if stale:
                return stale
            task = self._load_json(task_path)
            kind = submission.get("type") if isinstance(submission, dict) else None
            stage = self._author_stage(task, task_path)
            if kind == "ops_author_io_answers":
                if stage != "io_gate":
                    return self._conflict(
                        "stale_author_stage",
                        f"입출력 확인 제출을 적용할 단계가 아닙니다: {stage}",
                        current_stage=stage,
                    )
                io_questions = [
                    question
                    for question in author_questions.collect_questions(
                        task, os.path.dirname(task_path))
                    if question.get("qtype") == "io_confirm"
                ]
                if submission.get("question_count") != len(io_questions):
                    return self._conflict(
                        "stale_question_count",
                        "입출력 질문 수가 화면을 연 뒤 변경되었습니다",
                        current_question_count=len(io_questions),
                    )
                raw = author_apply.apply_io_answers(
                    task, submission, task_path)
            elif kind == "ops_author_answers":
                revision_answers = (
                    author_intent == "revise"
                    and author_phase == "revision_questionnaire"
                    and stage in ("questionnaire", "ready_to_validate")
                )
                if stage != "questionnaire" and not revision_answers:
                    return self._conflict(
                        "stale_author_stage",
                        f"상세 질문 제출을 적용할 단계가 아닙니다: {stage}",
                        current_stage=stage,
                    )
                raw = author_apply.apply_answers(
                    task, submission, task_path,
                    revision=revision_answers,
                    detail_editor=(author_phase == "revision_questionnaire"))
            elif kind == "ops_design_commit":
                revision_design = (
                    author_intent == "revise"
                    and stage == "ready_to_validate"
                )
                if (stage not in ("structure_gate", "io_gate")
                        and not revision_design):
                    return self._conflict(
                        "stale_author_stage",
                        f"설계 확정을 적용할 단계가 아닙니다: {stage}",
                        current_stage=stage,
                    )
                original_task = deepcopy(task)
                original_effective = task_compat.effective_task(
                    original_task, task_path)[0]
                raw = author_apply.commit_design(
                    task, submission, task_path,
                    before_write=lambda: self._pin_active_legacy_runs(
                        original_task, task_path, original_effective))
            elif kind == "ops_structure_edit":
                if stage != "structure_gate":
                    return self._conflict(
                        "stale_author_stage",
                        f"노드 구성 제출을 적용할 단계가 아닙니다: {stage}",
                        current_stage=stage,
                    )
                raw = author_apply.apply_structure(task, submission, task_path)
            elif kind == "ops_structure_commit":
                if stage != "structure_gate":
                    return self._conflict(
                        "stale_author_stage",
                        f"노드 구성 확정을 적용할 단계가 아닙니다: {stage}",
                        current_stage=stage,
                    )
                raw = author_apply.commit_structure(
                    task, submission, task_path)
            elif kind == "ops_structure_confirm":
                if stage != "structure_gate":
                    return self._conflict(
                        "stale_author_stage",
                        f"노드 구성 확정을 적용할 단계가 아닙니다: {stage}",
                        current_stage=stage,
                    )
                raw = author_apply.confirm_structure(
                    task, task_path, submission.get("task_fingerprint"))
            else:
                return self._invalid(f"지원하지 않는 저작 제출 type입니다: {kind}")
            result = self._strip_legacy(raw)
            legacy_status = result.get("status")
            if legacy_status in ("stale", "needs_rewire"):
                result["status"] = "conflict"
                result.setdefault("reason_code", legacy_status)
            if os.path.isfile(task_path):
                result["task_ref"] = self._ref(task_path)
                result["task_fingerprint"] = self._fingerprint(task_path)
                result["revision"] = self._revision(task_path)
                result["next_stage"] = self._author_stage(
                    self._load_json(task_path), task_path)
            return result

        return self._idempotent(
            "author_submit", idempotency_key, request, action)

    def task_validate(self, task_ref, rehearsal=False):
        try:
            task_path = self._task_path(task_ref)
            task = self._load_json(task_path)
            result = validate.validate(task, task_path)
            result["status"] = "ok" if result.get("ok") else "invalid"
            result["task_ref"] = self._ref(task_path)
            result["task_fingerprint"] = self._fingerprint(task_path)
            result["revision"] = self._revision(task_path)
            if rehearsal:
                result["rehearsal"] = validate.rehearse(task, task_path)
            return result
        except (OSError, ValueError, KeyError) as exc:
            return self._failure("task_validate_failed", exc)

    # ------------------------------------------------------------------ runs

    @staticmethod
    def _required_previous_inputs(task):
        """실행 전 점검에서 실제 사용하는 완전한 이전 Task 입력을 반환한다.

        사용하지 않는 루트 선언은 실행 가능한 Key를 숨기지 않는다. 조건부 입력은
        어느 분기로 진행해도 준비 상태가 거짓이 되지 않도록 모두 포함한다.
        """
        declared = {
            item.get("name"): item
            for item in task.get("inputs_from") or []
            if isinstance(item, dict) and isinstance(item.get("name"), str)
        }
        required = []
        seen = set()
        for node in task.get("nodes") or []:
            if not isinstance(node, dict) or node.get("type") == "if":
                continue
            for binding in node.get("inputs") or []:
                if not isinstance(binding, dict):
                    continue
                source = str(binding.get("source") or "")
                prefix = "$.inputs_from."
                if not source.startswith(prefix):
                    continue
                item = declared.get(source[len(prefix):])
                if not isinstance(item, dict):
                    return None
                identity = tuple(item.get(key) for key in (
                    "from_task", "from_node", "from_field"))
                if not all(isinstance(value, str) and value for value in identity):
                    return None
                if identity not in seen:
                    seen.add(identity)
                    required.append(item)
        return required

    @staticmethod
    def _run_completed_at(run):
        """구형 run의 시간을 추측하지 않고 기록된 완료 시각만 반환한다."""
        for entry in reversed(run.get("journal") or []):
            if (isinstance(entry, dict) and entry.get("event") == "done"
                    and isinstance(entry.get("at"), str) and entry.get("at")):
                return entry["at"]
        return None

    @staticmethod
    def _selectable_run_key(key):
        return (
            isinstance(key, str)
            and bool(key.strip())
            and key == key.strip()
            and len(key) <= 100
            and re.search(r"[\\/\r\n\x00-\x1f]", key) is None
        )

    def _ready_run_keys(self, task, current_runs, run_index):
        required = self._required_previous_inputs(task)
        if not required:
            return []

        activity = task.get("activity")
        source_task_ids = list(dict.fromkeys(
            item["from_task"] for item in required))
        producer_runs = {}
        key_sets = []
        canonical_runs_dir = os.path.realpath(self.runs_dir)

        for source_task_id in source_task_ids:
            keys = set()
            for path, indexed_run in run_index.get(
                    (activity, source_task_id), []):
                if not self._inside(os.path.realpath(path), canonical_runs_dir):
                    continue
                key = indexed_run.get("key")
                if not self._selectable_run_key(key) or key in keys:
                    continue
                # 폴더에서 찾은 모든 JSON을 신뢰하지 않고 엔진과 같은 파일명·식별자
                # 우선순위로 실제 읽을 run을 다시 확인한다.
                actual_path = engine.find_existing_run_path(
                    self.runs_dir, activity, source_task_id, key)
                if actual_path is None:
                    continue
                try:
                    run = self._load_json(actual_path)
                except (OSError, ValueError, json.JSONDecodeError):
                    continue
                if run.get("status") != "done":
                    continue
                producer_runs[(source_task_id, key)] = run
                keys.add(key)
            key_sets.append(keys)

        if not key_sets:
            return []
        candidate_keys = set.intersection(*key_sets)
        current_keys = {
            run.get("key") for _path, run in current_runs
            if isinstance(run.get("key"), str)
        }
        candidate_keys.difference_update(current_keys)

        ready = []
        for key in candidate_keys:
            usable = True
            completion_times = {}
            for item in required:
                source_task_id = item["from_task"]
                run = producer_runs.get((source_task_id, key))
                entry = util.latest(run, item["from_node"]) if run else None
                output = entry.get("output") if isinstance(entry, dict) else None
                if (not isinstance(output, dict)
                        or item["from_field"] not in output):
                    usable = False
                    break
                completion_times.setdefault(
                    source_task_id, self._run_completed_at(run))
            if not usable:
                continue
            recorded_times = list(completion_times.values())
            ready.append({
                "key": key,
                "ready_at": (
                    max(recorded_times)
                    if recorded_times and all(recorded_times) else None
                ),
                "prerequisite_count": len(source_task_ids),
            })

        ready.sort(key=lambda item: item["key"].casefold())
        ready.sort(key=lambda item: str(item.get("ready_at") or ""), reverse=True)
        return ready

    def run_list(self, task_ref):
        try:
            task_path = self._task_path(task_ref)
            task = self._load_json(task_path)
            run_index = self._run_index()
            indexed_runs = run_index.get(
                (task.get("activity"), task.get("task_id")), [])
            runs = []
            for run_path, run in indexed_runs:
                item = {
                    "run_ref": self._ref(run_path),
                    "revision": self._revision(run_path),
                    "key": run.get("key"),
                    "status": run.get("status"),
                    "started_at": run.get("started_at"),
                    "updated_at": ((run.get("journal") or [{}])[-1].get("at")
                                   or run.get("waiting_since")
                                   or run.get("started_at")),
                    "waiting_node_label": run.get("waiting_node_label"),
                    "progress": engine._progress(run),
                    "navigation": self._run_navigation(task, run),
                    "dependency_dummy": self._dependency_dummy_summary(run),
                }
                runs.append(item)
            runs.sort(key=lambda item: str(item.get("updated_at") or ""), reverse=True)
            active = [item for item in runs if item.get("status") != "done"]
            completed = [item for item in runs if item.get("status") == "done"]
            next_key = self._next_key({str(item.get("key")) for item in runs})
            choices = []
            for number, item in enumerate(active, 1):
                progress = item.get("progress") or {}
                current = item.get("waiting_node_label") or item.get("status")
                choices.append({
                    "number": number,
                    "action": "resume",
                    "run_ref": item["run_ref"],
                    "revision": item["revision"],
                    "key": item.get("key"),
                    "display": (
                        f"{number}. {item.get('key')} — "
                        f"{progress.get('completed', 0)}/"
                        f"{progress.get('total', 0)} 완료 · {current}"
                    ),
                })
            new_number = len(choices) + 1
            choices.append({
                "number": new_number, "action": "new",
                "recommended_key": next_key,
                "display": (
                    f"{new_number}. 신규 작업 — `{new_number}. <새 Key>` "
                    f"형식으로 입력 (추천 Key: {next_key})"
                ),
            })
            return {
                "status": "ok",
                "task_ref": self._ref(task_path),
                "task_fingerprint": self._fingerprint(task_path),
                "revision": self._revision(task_path),
                "task_id": task.get("task_id"),
                "task_name": task.get("task_name") or task.get("task_id"),
                "runs": runs,
                "active_runs": active,
                "completed_runs": completed,
                "ready_keys": self._ready_run_keys(
                    task, indexed_runs, run_index),
                "next_key": next_key,
                "selection": {
                    "mode": "chat_numbered",
                    "choice_tool_allowed": False,
                    "choices": choices,
                    "new_item_number": new_number,
                    "reply_format": (
                        f"기존 건: <번호> / 신규 건: "
                        f"{new_number}. <새 Key>"
                    ),
                    "instruction": (
                        "choices의 display를 채팅에 모두 보여주고 답을 받으세요. "
                        "내부 run_ref나 revision은 사용자에게 보여주지 마세요."
                    ),
                },
            }
        except (OSError, ValueError, KeyError) as exc:
            return self._failure("run_list_failed", exc)

    def run_start(self, task_ref, key, expected_task_fingerprint=None,
                  idempotency_key=None):
        """검증된 task를 시작하거나 같은 식별자의 기존 실행을 재개한다."""
        return self._run_start(
            task_ref,
            key,
            expected_task_fingerprint=expected_task_fingerprint,
            idempotency_key=idempotency_key,
            require_validation=True,
            require_setup=False,
            new_only=False,
            idempotency_tool="run_start",
        )

    def dashboard_run_start(self, task_ref, key,
                            expected_task_fingerprint=None,
                            idempotency_key=None):
        """Dashboard에서 설정을 마친 task의 신규 실행만 시작한다.

        검증은 사용자가 원할 때 실행하는 진단 기능이므로 시작 조건으로 삼지 않는다.
        반면 Creator 설정이 끝나지 않았거나 이미 사용한 식별자는 실행 전에 차단한다.
        """
        return self._run_start(
            task_ref,
            key,
            expected_task_fingerprint=expected_task_fingerprint,
            idempotency_key=idempotency_key,
            require_validation=False,
            require_setup=True,
            new_only=True,
            idempotency_tool="dashboard_run_start",
        )

    def _run_start(self, task_ref, key, expected_task_fingerprint=None,
                   idempotency_key=None, *, require_validation,
                   require_setup, new_only, idempotency_tool):
        request = {
            "task_ref": task_ref, "key": key,
            "expected_task_fingerprint": expected_task_fingerprint,
        }
        if idempotency_tool != "run_start":
            request.update({
                "require_validation": bool(require_validation),
                "require_setup": bool(require_setup),
                "new_only": bool(new_only),
            })

        def action():
            task_path = self._task_path(task_ref)
            current = self._fingerprint(task_path)
            if (expected_task_fingerprint
                    and current != expected_task_fingerprint):
                return self._conflict(
                    "stale_task_fingerprint",
                    "검증 또는 선택 이후 task가 변경되었습니다",
                    current_task_fingerprint=current,
                )
            if not isinstance(key, str) or not key.strip() or len(key) > 100:
                return self._invalid("Key는 1~100자 문자열이어야 합니다")
            if re.search(r"[\\/\r\n\x00-\x1f]", key):
                return self._invalid("Key에는 경로 문자나 제어 문자를 사용할 수 없습니다")
            task = self._load_json(task_path)
            if require_setup:
                author_stage = self._author_stage(task, task_path)
                if author_stage != "ready_to_validate":
                    return self._invalid(
                        "Creator 설정을 완료한 뒤 실행해 주세요",
                        reason_code="task_setup_incomplete",
                        author_stage=author_stage,
                    )
            if new_only and any(
                run.get("key") == key for _path, run in self._iter_task_runs(task)
            ):
                return self._invalid(
                    "이미 사용 중인 업무 식별자입니다. 다른 값을 입력해 주세요",
                    reason_code="duplicate_run_key",
                )
            if require_validation:
                checked = validate.validate(task, task_path)
                if not checked.get("ok"):
                    return {
                        "status": "invalid",
                        "reason_code": "task_validation_failed",
                        "errors": checked.get("errors") or [],
                        "warnings": checked.get("warnings") or [],
                    }
            runs_dir = self._runs_dir_for_existing(task, key)
            raw = engine.start(
                task_path, key=key, runs_dir=runs_dir, ctx=self._runtime_ctx())
            return self._normalize_run_result(raw)

        return self._idempotent(
            idempotency_tool, idempotency_key, request, action)

    def run_status(self, run_ref):
        try:
            run_path = self._run_path(run_ref)
            run = self._load_json(run_path)
            if run.get("status") == "waiting":
                return self._boundary(run_path, run)
            result = self._strip_legacy(engine.status(run_path))
            result["run_ref"] = self._ref(run_path)
            result["revision"] = self._revision(run_path)
            task = engine.load_run_task(run_path, run)
            result["navigation"] = self._run_navigation(task, run)
            result["presentation"] = self._run_presentation(task, run)
            if run.get("status") == "done":
                result["result_summary"] = engine._result_summary(run)
            result["dependency_dummy"] = self._dependency_dummy_summary(run)
            result.pop("run", None)
            result.pop("task_ref", None)
            result.pop("journal_tail", None)
            return result
        except (OSError, ValueError, KeyError) as exc:
            return self._failure("run_status_failed", exc)

    def run_file_preview(self, run_ref, file_id):
        """실행 기록이 가리키는 현재 텍스트 파일을 Dashboard에 제공한다."""
        try:
            run_path = self._run_path(run_ref)
            run = self._load_json(run_path)
            task = engine.load_run_task(run_path, run)
            presentation = self._run_presentation(task, run)
            matches = []
            for step in presentation.get("steps") or []:
                written = step.get("written_file") or {}
                if isinstance(written.get("file_preview"), dict):
                    matches.append(written["file_preview"])
                for collection in (step.get("inputs"), step.get("outputs")):
                    for item in collection or []:
                        preview = item.get("file_preview")
                        if isinstance(preview, dict):
                            matches.append(preview)
            candidates = {
                item.get("path") for item in matches
                if item.get("id") == file_id and isinstance(item.get("path"), str)
            }
            if len(candidates) != 1:
                return {
                    "status": "error",
                    "reason_code": "file_preview_not_found",
                    "reason": "실행 기록에서 파일을 찾을 수 없습니다.",
                }
            path = self.authorize_task_path(candidates.pop(), "read")
            if not os.path.isfile(path):
                raise ValueError("파일이 존재하지 않습니다")
            with open(path, "rb") as handle:
                raw = handle.read(_FILE_PREVIEW_MAX_BYTES + 1)
            if len(raw) > _FILE_PREVIEW_MAX_BYTES:
                return {
                    "status": "error",
                    "reason_code": "file_preview_too_large",
                    "reason": "10MiB를 넘는 파일은 대시보드에서 열 수 없습니다.",
                }
            try:
                text = raw.decode("utf-8").replace("\r\n", "\n").replace("\r", "\n")
            except UnicodeDecodeError:
                return {
                    "status": "error",
                    "reason_code": "file_preview_not_text",
                    "reason": "UTF-8 텍스트 파일만 대시보드에서 열 수 있습니다.",
                }
            return {
                "status": "ok",
                "path": path,
                "name": os.path.basename(path),
                "text": text,
                "markdown": os.path.splitext(path)[1].lower() in (".md", ".markdown"),
            }
        except (OSError, ValueError, KeyError, PermissionError):
            return {
                "status": "error",
                "reason_code": "file_preview_not_found",
                "reason": "파일을 찾거나 읽을 수 없습니다.",
            }

    def run_next(self, run_ref, expected_revision=None, idempotency_key=None):
        request = {
            "run_ref": run_ref, "expected_revision": expected_revision,
        }

        def action():
            run_path = self._run_path(run_ref)
            stale = self._check_revision(run_path, expected_revision)
            if stale:
                return stale
            run = self._load_json(run_path)
            if run.get("status") == "waiting":
                return self._boundary(run_path, run)
            if run.get("status") == "done":
                return self._normalize_run_result({
                    "status": "done", "run": run_path,
                    "progress": engine._progress(run),
                    "result_summary": engine._result_summary(run),
                })
            raw = engine.continue_run(
                run_path, ctx=self._runtime_ctx())
            return self._normalize_run_result(raw)

        return self._idempotent("run_next", idempotency_key, request, action)

    def run_delete(self, run_ref, expected_revision=None, idempotency_key=None):
        request = {
            "run_ref": run_ref,
            "expected_revision": expected_revision,
        }

        def action():
            run_path = self._run_path(run_ref)
            stale = self._check_revision(run_path, expected_revision)
            if stale:
                return stale
            run = self._load_json(run_path)
            task_ref = run.get("task_ref")
            task_path = (
                self._task_path(task_ref)
                if not run.get("snapshot_ref") or os.path.isfile(task_ref)
                else None
            )
            key = run.get("key")
            snapshot_ref = run.get("snapshot_ref")
            snapshot_path = (
                engine._snapshot_task_path(run_path) if snapshot_ref else None)
            os.remove(run_path)
            if snapshot_path:
                try:
                    shutil.rmtree(os.path.dirname(snapshot_path))
                except FileNotFoundError:
                    pass
            return {
                "status": "ok",
                "deleted": True,
                "recoverable": False,
                "run_ref": self._ref(run_path),
                "task_ref": (
                    self._ref(task_path) if task_path else str(task_ref)),
                "key": key,
            }

        return self._idempotent(
            "run_delete", idempotency_key, request, action)

    def run_complete_agent_job(self, run_ref, job_id, revision,
                               idempotency_key, result, defer_pump=False):
        return self._complete_job(
            "agent", run_ref, job_id, revision, idempotency_key, result,
            defer_pump=defer_pump)

    def run_complete_human_job(self, run_ref, job_id, revision,
                               idempotency_key, result, defer_pump=False):
        return self._complete_job(
            "user", run_ref, job_id, revision, idempotency_key, result,
            defer_pump=defer_pump)

    def run_open_url(self, run_ref, job_id, revision, idempotency_key, delay=2):
        """현재 waiting job의 수동 작업 URL을 검증한 뒤 한 번만 연다."""
        try:
            normalized_delay = max(0, min(int(delay), 10))
        except (TypeError, ValueError):
            return self._invalid(
                "delay는 0~10 사이의 정수여야 합니다",
                reason_code="invalid_open_delay",
            )
        request = {
            "run_ref": run_ref,
            "job_id": job_id,
            "revision": revision,
            # 기존 idempotency receipt의 request digest와 호환되도록 원래 값을 보존한다.
            "delay": delay,
        }

        # _idempotent()는 pending 영수증 기록부터 실제 mutation 완료까지 프로젝트
        # 전역 락을 보유한다. 사용자 안내용 sleep은 그 경계에 들어가기 전에 끝낸다.
        # 이 검사는 대기 여부만 정하는 힌트이며, 모든 사전조건은 action에서 다시
        # 검증하므로 대기 중 상태가 바뀌어도 잘못된 URL을 열지 않는다.
        if normalized_delay:
            try:
                preflight_path = self._run_path(run_ref)
                preflight_run = self._load_json(preflight_path)
                preflight_matches = (
                    preflight_run.get("status") == "waiting"
                    and self._revision(preflight_path) == revision
                    and self._job_id(preflight_path, preflight_run) == job_id
                )
                if preflight_matches:
                    engine._wait_before_open_waiting_url(
                        preflight_path,
                        preflight_run.get("waiting_node"),
                        normalized_delay,
                    )
            except (OSError, ValueError, KeyError, TypeError):
                pass

        def action():
            run_path = self._run_path(run_ref)
            run = self._load_json(run_path)
            current_job = self._job_id(run_path, run)
            # A whole-file revision may change because presentation/journal
            # metadata was refreshed.  The pause identity is the meaningful
            # submission contract; only reject when the actual job changed.
            if revision and revision != self._revision(run_path) and (
                    job_id != current_job):
                return self._conflict(
                    "stale_job", "현재 대기 중인 job이 변경되었습니다",
                    current_job_id=current_job,
                    current_revision=self._revision(run_path))
            if run.get("status") != "waiting":
                return self._conflict(
                    "run_not_waiting",
                    "현재 run에는 열 수동 작업 화면이 없습니다",
                    current_revision=self._revision(run_path),
                )
            boundary = self._boundary(run_path)
            if boundary.get("status") != "paused":
                return boundary
            current_job = boundary.get("job") or {}
            if job_id != current_job.get("job_id"):
                return self._conflict(
                    "stale_job",
                    "현재 대기 중인 job과 job_id가 다릅니다",
                    current_job_id=current_job.get("job_id"),
                    current_revision=boundary.get("revision"),
                )
            if not boundary.get("handoff"):
                return self._invalid(
                    "이 job에는 열 수동 작업 URL이 없습니다",
                    reason_code="missing_handoff_url",
                )
            raw = engine.open_waiting_url(
                run_path,
                run.get("waiting_node"),
                delay=0,
                ctx=self._runtime_ctx(),
            )
            opened = self._strip_legacy(raw)
            if opened.get("status") != "ok":
                opened["run_ref"] = self._ref(run_path)
                opened["revision"] = self._revision(run_path)
                opened["job_id"] = job_id
                return opened
            # URL을 열었다는 표시도 run 파일에 기록되므로 revision이 달라진다.
            # 이후 제출이 stale이 되지 않도록 새 boundary와 resume 계약을 돌려준다.
            refreshed = self._boundary(run_path)
            refreshed["open_result"] = opened
            refreshed["opened"] = bool(opened.get("opened"))
            refreshed["already_opened"] = bool(opened.get("already_opened"))
            return refreshed

        return self._idempotent(
            "run_open_url", idempotency_key, request, action)

    # ------------------------------------------------------------------ run internals

    def _complete_job(self, expected_actor, run_ref, job_id, revision,
                      idempotency_key, result, defer_pump=False):
        request = {
            "run_ref": run_ref, "job_id": job_id, "revision": revision,
            "result_digest": self._digest(result),
        }
        if defer_pump:
            request["defer_pump"] = True

        def action():
            run_path = self._run_path(run_ref)
            run = self._load_json(run_path)
            current_job = self._job_id(run_path, run)
            if revision and revision != self._revision(run_path) and (
                    job_id != current_job):
                return self._conflict(
                    "stale_job", "현재 대기 중인 job이 변경되었습니다",
                    current_job_id=current_job,
                    current_revision=self._revision(run_path))
            if run.get("status") != "waiting":
                return self._conflict(
                    "run_not_waiting", "현재 run에는 완료할 job이 없습니다",
                    current_revision=self._revision(run_path))
            if job_id != current_job:
                return self._conflict(
                    "stale_job", "현재 대기 중인 job과 job_id가 다릅니다",
                    current_job_id=current_job,
                    current_revision=self._revision(run_path),
                )
            actor = engine.PAUSE_ACTOR.get(run.get("waiting_kind"), "user")
            if actor != expected_actor:
                return self._conflict(
                    "actor_mismatch",
                    f"이 job의 수행 주체는 {actor}입니다",
                    expected_actor=actor,
                )
            if run.get("snapshot_ref"):
                task = engine.load_run_task(run_path, run)
            else:
                task_path = self._task_path(run.get("task_ref"))
                current_task_fingerprint = self._fingerprint(task_path)
                if (run.get("task_fingerprint")
                        and run.get("task_fingerprint")
                            != current_task_fingerprint):
                    return self._conflict(
                        "task_fingerprint_mismatch",
                        "run 시작 뒤 Task가 변경되어 job 결과를 적용할 수 없습니다",
                        current_task_fingerprint=current_task_fingerprint,
                    )
                task = self._load_json(task_path)
            node = next((n for n in task.get("nodes") or []
                         if n.get("id") == run.get("waiting_node")), None)
            if node is None:
                return self._conflict(
                    "task_run_mismatch",
                    "대기 중이던 노드가 현재 Task에 없습니다")
            shape_error = self._validate_job_result(run, node, result)
            if shape_error:
                return self._invalid(shape_error, reason_code="invalid_job_result")
            raw = engine.resume(
                run_path, run.get("waiting_node"), result,
                ctx=self._runtime_ctx(), defer_pump=defer_pump)
            return self._normalize_run_result(raw)

        return self._idempotent(
            f"run_complete_{expected_actor}_job",
            idempotency_key, request, action)

    def _boundary(self, run_path, run=None):
        run = run or self._load_json(run_path)
        task_path = run.get("task_ref")
        if run.get("snapshot_ref"):
            task = engine.load_run_task(run_path, run)
        else:
            task_path = self._task_path(run.get("task_ref"))
            current_task_fingerprint = self._fingerprint(task_path)
            if (run.get("task_fingerprint")
                    and run.get("task_fingerprint")
                        != current_task_fingerprint):
                return self._conflict(
                    "task_fingerprint_mismatch",
                    "run 시작 뒤 Task가 변경되어 현재 job을 안전하게 표시하거나 재개할 수 없습니다",
                    run_ref=self._ref(run_path),
                    revision=self._revision(run_path),
                    current_task_fingerprint=current_task_fingerprint,
                )
            task = self._load_json(task_path)
        node = next((n for n in task.get("nodes") or []
                     if n.get("id") == run.get("waiting_node")), None)
        if node is None:
            return self._conflict(
                "task_run_mismatch",
                "대기 중이던 노드가 현재 Task에 없습니다",
                run_ref=self._ref(run_path),
                revision=self._revision(run_path),
            )
        revision = self._revision(run_path)
        actor = engine.PAUSE_ACTOR.get(run.get("waiting_kind"), "user")
        inputs, _missing = engine._resolve_inputs(
            task, node, deepcopy(run), os.path.dirname(run_path))
        fields = deepcopy(run.get("waiting_fields") or [])
        if run.get("waiting_kind") == "ask_dependency_dummy":
            fields = self._dependency_dummy_display_fields(
                task, task_path, fields)
        job = {
            "job_id": self._job_id(run_path, run),
            "revision": revision,
            "actor": actor,
            "kind": run.get("waiting_kind"),
            "slot": run.get("waiting_slot"),
            "fields": fields,
            "node_label": run.get("waiting_node_label") or run.get("waiting_node"),
            "prompt": run.get("waiting_prompt"),
            "inputs": inputs,
            "reference_manifest": self._reference_manifest(node),
            "allowed_labels": [x for x in (node.get("labels") or []) if x],
            "result_schema": self._result_schema(run, node),
        }
        result = {
            "status": "paused",
            "run_ref": self._ref(run_path),
            "revision": revision,
            "job": job,
            "requires_user_input": actor == "user",
            "progress": engine._progress(run),
            "navigation": self._run_navigation(task, run),
            "presentation": self._run_presentation(task, run),
            "dependency_dummy": self._dependency_dummy_summary(run),
        }
        if run.get("waiting_open_url"):
            result["handoff"] = {
                "url": run.get("waiting_open_url"),
                "opened": bool(run.get("waiting_url_opened_at")),
            }
        return result

    def _dependency_dummy_display_fields(self, task, task_path, fields):
        """Add user-facing labels without changing the persisted run contract.

        Dependency IDs remain available to the submit/API path, but the Runner UI
        receives separate labels resolved from the referenced Task definition.
        Missing or legacy Task definitions deliberately fall back to neutral Korean
        labels instead of exposing an internal identifier.
        """
        wanted = {
            field.get("from_task")
            for field in fields
            if isinstance(field, dict) and field.get("from_task")
        }
        candidates = {task_id: [] for task_id in wanted}
        workflow_root = os.path.join(self.project_root, "workflows")
        current_dir = os.path.normcase(os.path.dirname(task_path))
        current_activity = task.get("activity")
        current_hash = str(task.get("source_yaml_sha256") or "").lower()
        current_yaml = os.path.basename(
            str(task.get("source_yaml") or "")).casefold()

        for path in self._project_files((".json",), roots=(workflow_root,)):
            try:
                source_task = self._load_json(path)
            except (OSError, ValueError, json.JSONDecodeError):
                continue
            task_id = source_task.get("task_id") if isinstance(source_task, dict) else None
            if task_id not in candidates:
                continue
            score = 0
            if source_task.get("activity") == current_activity:
                score += 8
            source_hash = str(source_task.get("source_yaml_sha256") or "").lower()
            if current_hash and source_hash == current_hash:
                score += 4
            source_yaml = os.path.basename(
                str(source_task.get("source_yaml") or "")).casefold()
            if current_yaml and source_yaml == current_yaml:
                score += 2
            if os.path.normcase(os.path.dirname(path)) == current_dir:
                score += 1
            candidates[task_id].append((score, self._ref(path), source_task))

        resolved = {}
        for task_id, items in candidates.items():
            if items:
                items.sort(key=lambda item: (-item[0], item[1].casefold()))
                resolved[task_id] = items[0][2]

        def visible(value, internal_values, fallback):
            label = str(value or "").strip()
            hidden = {
                str(item).strip() for item in internal_values if item is not None
            }
            return label if label and label not in hidden else fallback

        result = []
        for raw_field in fields:
            field = deepcopy(raw_field)
            internal = {
                field.get("id"), field.get("name"), field.get("from_task"),
                field.get("from_node"), field.get("from_field"),
            }
            source_task = resolved.get(field.get("from_task")) or {}
            source_node = next((
                node for node in source_task.get("nodes") or []
                if isinstance(node, dict)
                and node.get("id") == field.get("from_node")
            ), {})
            source_output = next((
                output for output in source_node.get("outputs") or []
                if isinstance(output, dict)
                and output.get("id") == field.get("from_field")
            ), {})

            field["source_task_name"] = visible(
                source_task.get("task_name"),
                {source_task.get("task_id")}, "이전 Task")
            field["source_node_name"] = visible(
                source_node.get("name"),
                {source_node.get("id")}, "선행 단계")
            field["source_field_name"] = visible(
                source_output.get("name"),
                {source_output.get("id")}, "선행 결과")

            consumer_node_names = []
            for consumer in field.get("consumers") or []:
                if not isinstance(consumer, dict):
                    continue
                consumer_node = next((
                    node for node in task.get("nodes") or []
                    if isinstance(node, dict)
                    and node.get("id") == consumer.get("node_id")
                ), {})
                consumer_name = visible(
                    consumer_node.get("name"),
                    internal | {consumer_node.get("id")}, "")
                if consumer_name and consumer_name not in consumer_node_names:
                    consumer_node_names.append(consumer_name)
            if not consumer_node_names:
                current_node = next((
                    node for node in task.get("nodes") or []
                    if isinstance(node, dict)
                    and node.get("id") == field.get("consumer_node")
                ), {})
                consumer_name = visible(
                    current_node.get("name"),
                    internal | {current_node.get("id")}, "")
                if consumer_name:
                    consumer_node_names.append(consumer_name)
            field["consumer_node_names"] = consumer_node_names

            display_name = visible(
                field.get("consumer_field"), internal, "")
            if not display_name:
                display_name = visible(
                    field.get("consumer_input"), internal, "")
            field["display_name"] = (
                display_name or field["source_field_name"]
                or "필요한 선행 출력")
            result.append(field)
        return result

    def _normalize_run_result(self, raw):
        if not isinstance(raw, dict):
            return self._failure("runtime_protocol_error", "런타임 응답이 객체가 아닙니다")
        run_value = raw.get("run")
        if raw.get("status") == "paused" and run_value:
            return self._boundary(self._run_path(run_value))
        result = self._strip_legacy(raw)
        if run_value:
            run_path = self._run_path(run_value)
            result["run_ref"] = self._ref(run_path)
            if os.path.isfile(run_path):
                result["revision"] = self._revision(run_path)
                run = self._load_json(run_path)
                task = engine.load_run_task(run_path, run)
                result["navigation"] = self._run_navigation(task, run)
                result["presentation"] = self._run_presentation(task, run)
                result["dependency_dummy"] = self._dependency_dummy_summary(run)
        result.pop("run", None)
        result.pop("task_ref", None)
        return result

    def _run_navigation(self, task, run):
        action_nodes = [
            node for node in task.get("nodes") or []
            if isinstance(node, dict) and node.get("type") != "if"
        ]
        positions = {
            node.get("id"): number
            for number, node in enumerate(action_nodes, 1)
        }
        by_id = {
            node.get("id"): node
            for node in task.get("nodes") or []
            if isinstance(node, dict) and node.get("id")
        }

        def card(node_id, state):
            node = by_id.get(node_id)
            if node is None:
                return None
            return {
                "node_id": node_id,
                "label": engine._node_label(node),
                "position": positions.get(node_id),
                "state": state,
            }

        completed = []
        for node in action_nodes:
            latest = util.latest(run, node.get("id"))
            if latest is not None:
                completed.append((
                    str(latest.get("at") or ""),
                    positions.get(node.get("id"), 0),
                    node.get("id"),
                ))
        completed.sort()

        current_id = run.get("waiting_node") or run.get("cursor")
        current = card(current_id, "current") if current_id else None
        if run.get("status") == "done":
            current = {
                "node_id": None,
                "label": "업무 실행 완료",
                "position": len(action_nodes),
                "state": "done",
            }
        elif run.get("status") == "error" and current is not None:
            current["state"] = "error"

        previous_id = next((
            item[2] for item in reversed(completed)
            if item[2] != current_id
        ), None)
        previous = card(previous_id, "completed")
        if previous is None:
            previous = {
                "node_id": None,
                "label": "업무 시작",
                "position": 0,
                "state": "start",
            }

        next_card = None
        conditional_next = False
        if current_id and current_id in by_id:
            index = {
                node.get("id"): number
                for number, node in enumerate(task.get("nodes") or [])
                if isinstance(node, dict) and node.get("id")
            }
            node = by_id[current_id]
            next_id = node.get("next")
            if next_id is None:
                at = index.get(current_id)
                nodes = task.get("nodes") or []
                if at is not None:
                    for following in nodes[at + 1:]:
                        if (
                            isinstance(following, dict)
                            and following.get("id")
                        ):
                            next_id = following["id"]
                            break
            visited = set()
            while next_id and next_id not in visited:
                visited.add(next_id)
                candidate = by_id.get(next_id)
                if candidate is None:
                    next_id = None
                    break
                if candidate.get("type") != "if":
                    break
                source = util.latest(run, candidate.get("source_node", ""))
                label = source.get("label") if source else None
                case = next((
                    item for item in candidate.get("cases") or []
                    if item.get("value") == label
                ), None)
                if case is None:
                    conditional_next = True
                    next_id = None
                    break
                next_id = case.get("next")
            if next_id:
                next_card = card(next_id, "next")
        if conditional_next:
            next_card = {
                "node_id": None,
                "label": "분기 결과에 따라 결정",
                "position": None,
                "state": "conditional",
            }

        actor = engine.PAUSE_ACTOR.get(
            run.get("waiting_kind"), "user")
        if run.get("status") == "done":
            status_label = "실행 완료"
        elif run.get("status") == "error":
            status_label = "실행 오류"
        elif run.get("status") == "waiting" and actor == "agent":
            status_label = "Agent 처리 대기"
        elif run.get("status") == "waiting":
            status_label = "사용자 입력 대기"
        else:
            status_label = "진행 중"
        navigation = {
            "task_name": task.get("task_name") or task.get("task_id"),
            "key": run.get("key"),
            "status": run.get("status"),
            "status_label": status_label,
            "completed": len(completed),
            "total": len(action_nodes),
            "previous": previous,
            "current": current,
            "next": next_card,
        }
        navigation["dependency_dummy"] = self._dependency_dummy_summary(run)
        return navigation

    @staticmethod
    def _presentation_value(value, limit=1200):
        try:
            text = value if isinstance(value, str) else json.dumps(
                value, ensure_ascii=False, sort_keys=True, indent=2)
        except (TypeError, ValueError):
            text = str(value)
        text = text or ""
        return {
            "text": text[:limit],
            "truncated": len(text) > limit,
            "kind": (
                "null" if value is None else
                "object" if isinstance(value, dict) else
                "list" if isinstance(value, list) else "text"
            ),
        }

    def _file_preview_meta(self, path):
        if not isinstance(path, str) or not path.strip() or "\x00" in path:
            return None
        candidate = path.strip()
        if not os.path.isabs(candidate):
            candidate = os.path.join(self.project_root, candidate)
        candidate = os.path.realpath(os.path.abspath(candidate))
        identity = os.path.normcase(candidate).encode("utf-8", errors="replace")
        return {
            "id": hashlib.sha256(identity).hexdigest()[:24],
            "path": candidate,
            "name": os.path.basename(candidate),
            "markdown": os.path.splitext(candidate)[1].lower() in (".md", ".markdown"),
        }

    def _run_presentation(self, task, run):
        """저장된 run을 근거 중심의 사용자용 실행 과정으로 투영한다."""
        all_nodes = [n for n in task.get("nodes") or [] if isinstance(n, dict)]
        action_nodes = [n for n in all_nodes if n.get("type") != "if"]
        by_id = {n.get("id"): n for n in all_nodes if n.get("id")}
        positions = {n.get("id"): i for i, n in enumerate(action_nodes, 1)}
        output_names = {
            node.get("id"): {
                item.get("id"): item.get("name") or item.get("id")
                for item in node.get("outputs") or [] if isinstance(item, dict)
            }
            for node in action_nodes
        }
        consumers = {}
        for node in action_nodes:
            for spec in node.get("inputs") or []:
                if not isinstance(spec, dict):
                    continue
                resolved = references.resolve_output_source(task, spec.get("source"), by_id)
                if not resolved or resolved.get("kind") not in ("canonical", "legacy_name"):
                    continue
                key = (resolved.get("node_id"), resolved.get("output_id"))
                consumers.setdefault(key, []).append({
                    "node": engine._node_label(node),
                    "field": spec.get("field") or spec.get("name") or "입력",
                })

        def source_display(source):
            resolved = references.resolve_output_source(task, source, by_id)
            if resolved and resolved.get("kind") in ("canonical", "legacy_name"):
                producer = by_id.get(resolved.get("node_id")) or {}
                return {
                    "kind": "node_output",
                    "node": engine._node_label(producer),
                    "output": resolved.get("output_name") or resolved.get("output_id"),
                }
            if str(source or "").startswith("$.inputs_from."):
                return {
                    "kind": "previous_task", "node": "이전 Task",
                    "output": str(source).split(".")[-1],
                }
            if source == "$.key":
                return {"kind": "run_key", "node": "실행 정보", "output": "업무 식별자"}
            return {"kind": "external", "node": "직접 입력", "output": None}

        def recorded_file_path(node_id, output_id, before=None):
            state = (run.get("nodes") or {}).get(node_id) or {}
            history = state.get("history") or []
            for candidate in reversed(history):
                if not isinstance(candidate, dict):
                    continue
                at = candidate.get("at")
                if before and at and str(at) > str(before):
                    continue
                written = candidate.get("written_file") or {}
                if isinstance(written.get("path"), str):
                    return written["path"]
                output = candidate.get("output") or {}
                if isinstance(output.get(output_id), str):
                    return output[output_id]
            return None

        def input_file_preview(item, node, entry=None):
            path = item.get("file_path")
            if not isinstance(path, str) and not item.get("truncated"):
                path = item.get("preview")
            if (node.get("action_type") == "file_read"
                    and node.get("path_input") == item.get("name")
                    and isinstance(path, str)):
                return self._file_preview_meta(path)
            resolved = references.resolve_output_source(
                task, item.get("source"), by_id)
            if not resolved or resolved.get("kind") not in (
                    "canonical", "legacy_name"):
                return None
            producer = by_id.get(resolved.get("node_id")) or {}
            outputs = [
                output for output in producer.get("outputs") or []
                if isinstance(output, dict)
            ]
            if (producer.get("action_type") != "file_write" or not outputs
                    or resolved.get("output_id") != outputs[0].get("id")):
                return None
            if not isinstance(path, str):
                path = recorded_file_path(
                    resolved.get("node_id"), resolved.get("output_id"),
                    entry.get("at") if isinstance(entry, dict) else None,
                )
            return self._file_preview_meta(path)

        def input_display(item, node, entry=None):
            result = {
                "name": item.get("name") or "입력",
                "source": source_display(item.get("source")),
                "value": {
                    "text": str(item.get("preview") or ""),
                    "truncated": bool(item.get("truncated")),
                    "kind": item.get("value_type") or "text",
                },
            }
            preview = input_file_preview(item, node, entry)
            if preview:
                result["file_preview"] = preview
            return result

        def evidence_display(entry, names):
            evidence = entry.get("evidence")
            if not isinstance(evidence, dict):
                return None
            reasons = evidence.get("outputs") if isinstance(evidence.get("outputs"), dict) else {}
            sources = []
            for source in evidence.get("sources") or []:
                if not isinstance(source, dict):
                    continue
                sources.append({
                    "path": str(source.get("path") or ""),
                    "reason": str(source.get("reason") or ""),
                    **({"line_start": source.get("line_start")} if source.get("line_start") else {}),
                    **({"line_end": source.get("line_end")} if source.get("line_end") else {}),
                })
            return {
                "summary": str(evidence.get("summary") or evidence.get("label") or ""),
                "outputs": [
                    {"name": names.get(field, field), "reason": str(reason)}
                    for field, reason in reasons.items() if str(reason or "").strip()
                ],
                "sources": sources,
            }

        steps = []
        for node in action_nodes:
            node_id = node.get("id")
            history = ((run.get("nodes") or {}).get(node_id) or {}).get("history") or []
            for iteration, entry in enumerate(history, 1):
                if not isinstance(entry, dict):
                    continue
                trace = entry.get("trace") if isinstance(entry.get("trace"), dict) else {}
                trace_inputs = [
                    input_display(item, node, entry) for item in trace.get("inputs") or []
                    if isinstance(item, dict)
                ]
                if not trace_inputs:
                    trace_inputs = [{
                        "name": spec.get("field") or spec.get("name") or "입력",
                        "source": source_display(spec.get("source")),
                        "value": None,
                    } for spec in node.get("inputs") or [] if isinstance(spec, dict)]
                names = output_names.get(node_id) or {}
                written = entry.get("written_file")
                if not (isinstance(written, dict)
                        and isinstance(written.get("preview"), str)):
                    written = None
                declared_outputs = [
                    item for item in node.get("outputs") or []
                    if isinstance(item, dict)
                ]
                path_output_id = (declared_outputs[0].get("id")
                                  if declared_outputs else None)
                output_items = []
                for field, value in (entry.get("output") or {}).items():
                    if written and field == path_output_id:
                        continue
                    item = {
                        "name": names.get(field, field),
                        "value": self._presentation_value(value),
                        "handoffs": consumers.get((node_id, field), []),
                    }
                    if (node.get("action_type") == "file_write"
                            and field == path_output_id):
                        preview = self._file_preview_meta(value)
                        if preview:
                            item["file_preview"] = preview
                    output_items.append(item)
                step = {
                    "position": positions.get(node_id),
                    "iteration": iteration,
                    "node": engine._node_label(node),
                    "action": engine.ACTION_TYPE_KO.get(node.get("action_type"), "업무 처리"),
                    "state": "completed",
                    "actor": trace.get("actor") or "legacy",
                    "started_at": trace.get("started_at"),
                    "completed_at": entry.get("at"),
                    "inputs": trace_inputs,
                    "outputs": output_items,
                    "label": entry.get("label"),
                    "evidence": evidence_display(entry, names),
                    "path": entry.get("path"),
                }
                if written:
                    step["written_file"] = {
                        "path": str(written.get("path") or ""),
                        "value": {
                            "text": written["preview"],
                            "truncated": bool(written.get("truncated")),
                            "kind": "text",
                        },
                        "handoffs": consumers.get(
                            (node_id, path_output_id), []),
                    }
                    preview = self._file_preview_meta(written.get("path"))
                    if preview:
                        step["written_file"]["file_preview"] = preview
                steps.append(step)
        steps.sort(key=lambda item: (
            str(item.get("completed_at") or ""), item.get("position") or 0,
            item.get("iteration") or 0))

        current_id = run.get("waiting_node") or run.get("cursor")
        if current_id and current_id in by_id and by_id[current_id].get("type") != "if":
            node = by_id[current_id]
            trace = run.get("waiting_trace") if isinstance(run.get("waiting_trace"), dict) else {}
            steps.append({
                "position": positions.get(current_id),
                "iteration": len(((run.get("nodes") or {}).get(current_id) or {}).get("history") or []) + 1,
                "node": engine._node_label(node),
                "action": engine.ACTION_TYPE_KO.get(node.get("action_type"), "업무 처리"),
                "state": "current",
                "actor": trace.get("actor") or (
                    engine.PAUSE_ACTOR.get(run.get("waiting_kind"), "system")
                    if run.get("status") == "waiting" else "system"),
                "started_at": trace.get("started_at") or run.get("waiting_since"),
                "completed_at": None,
                "inputs": [input_display(item, node) for item in trace.get("inputs") or []
                           if isinstance(item, dict)],
                "outputs": [], "label": None, "evidence": None, "path": None,
            })

        outline = []
        for node in action_nodes:
            node_id = node.get("id")
            count = len(((run.get("nodes") or {}).get(node_id) or {}).get("history") or [])
            state = (
                "current" if node_id == current_id and run.get("status") != "done" else
                "completed" if count else
                "not_run" if run.get("status") == "done" else "upcoming"
            )
            outline.append({
                "position": positions.get(node_id), "node": engine._node_label(node),
                "state": state, "iterations": count,
            })

        routes = []
        for event in run.get("journal") or []:
            if not isinstance(event, dict) or event.get("event") != "route":
                continue
            detail = event.get("detail") if isinstance(event.get("detail"), dict) else {}
            target = by_id.get(detail.get("next")) or {}
            routes.append({
                "at": event.get("at"), "label": detail.get("label"),
                "next": engine._node_label(target) if target else "업무 종료",
            })

        completed_steps = [item for item in steps if item.get("state") == "completed"]
        decision_steps = [item for item in completed_steps if item.get("label") or item.get("evidence")]
        progress = engine._progress(run) or {}
        return {
            "summary": {
                "status": run.get("status"),
                "completed": progress.get("completed", 0),
                "total": progress.get("total", len(action_nodes)),
                "current": progress.get("current"),
                "started_at": run.get("started_at"),
                "updated_at": ((run.get("journal") or [{}])[-1].get("at")
                               or run.get("waiting_since") or run.get("started_at")),
            },
            "outline": outline, "steps": steps, "routes": routes,
            "result_highlights": list(reversed(decision_steps[-3:] or completed_steps[-3:])),
        }

    @staticmethod
    def _dependency_dummy_summary(run):
        items = run.get("dependency_dummy_inputs") or {}
        origins = {}
        fields = []
        for field_id, meta in items.items():
            meta = meta if isinstance(meta, dict) else {}
            origin = str(meta.get("origin") or "manual")
            origins[origin] = origins.get(origin, 0) + 1
            fields.append({"id": field_id, **deepcopy(meta)})
        return {
            "used": bool(fields),
            "count": len(fields),
            "origins": origins,
            "fields": fields,
        }

    def _runtime_ctx(self):
        ctx = engine.default_ctx()
        ctx["project_root"] = self.project_root
        ctx["authorize_path"] = self.authorize_path
        ctx["authorize_task_path"] = self.authorize_task_path
        ctx["redact_logs"] = True
        return ctx

    def authorize_task_path(self, path, mode="read"):
        """Task가 명시한 읽기·쓰기 자원을 OS 권한 범위에서 허용한다."""
        if mode not in ("read", "write"):
            raise ValueError(f"지원하지 않는 Task 파일 접근 모드입니다: {mode}")
        if not isinstance(path, str) or not path.strip() or "\x00" in path:
            raise ValueError("빈 경로 또는 잘못된 경로")
        candidate = path.strip()
        if not os.path.isabs(candidate):
            candidate = os.path.join(self.project_root, candidate)
        candidate = os.path.realpath(os.path.abspath(candidate))
        if mode == "read" and not os.path.exists(candidate):
            raise ValueError("경로가 존재하지 않습니다")
        return candidate

    def authorize_path(self, path, mode="read"):
        if not isinstance(path, str) or not path.strip() or "\x00" in path:
            raise ValueError("빈 경로 또는 잘못된 경로")
        candidate = path.strip()
        if not os.path.isabs(candidate):
            candidate = os.path.join(self.project_root, candidate)
        candidate = os.path.realpath(os.path.abspath(candidate))
        roots = (self.project_root,) + self.trusted_roots
        if not any(self._inside(candidate, root) for root in roots):
            raise PermissionError("프로젝트 또는 승인된 trusted root 밖입니다")
        if mode in ("read", "execute") and not os.path.exists(candidate):
            raise ValueError("경로가 존재하지 않습니다")
        if mode == "write":
            parent = os.path.dirname(candidate)
            while parent and not os.path.exists(parent):
                new_parent = os.path.dirname(parent)
                if new_parent == parent:
                    break
                parent = new_parent
            if not any(self._inside(os.path.realpath(parent), root) for root in roots):
                raise PermissionError("쓰기 대상의 상위 경로가 trusted root 밖입니다")
        return candidate

    # ------------------------------------------------------------------ schemas/validation

    def _result_schema(self, run, node):
        slot = run.get("waiting_slot")
        fields = run.get("waiting_fields") or []
        if slot in ("output", "inputs"):
            properties = {f["id"]: {} for f in fields}
            schema = {
                "type": "object",
                "properties": {
                    "output": {
                        "type": "object",
                        "properties": properties,
                        "required": [f["id"] for f in fields],
                        "additionalProperties": True,
                    }
                },
                "required": ["output"],
            }
            if (slot == "output" and node.get("action_type") == "decision"
                    and node.get("evidence_required")):
                schema["properties"]["evidence"] = self._evidence_schema(
                    [f["id"] for f in fields], label_mode=False)
                schema["required"].append("evidence")
            return schema
        if slot == "label":
            schema = {
                "type": "object",
                "properties": {
                    "label": {"type": "string", "enum": [
                        x for x in (node.get("labels") or []) if x]},
                },
                "required": ["label"],
            }
            if fields:
                schema["properties"]["output"] = {
                    "type": "object",
                    "properties": {f["id"]: {} for f in fields},
                    "required": [f["id"] for f in fields],
                }
                schema["required"].append("output")
            if node.get("evidence_required"):
                schema["properties"]["evidence"] = self._evidence_schema(
                    [f["id"] for f in fields], label_mode=True)
                schema["required"].append("evidence")
            return schema
        if slot == "content":
            return {"type": "object", "properties": {"content": {"type": "string"}},
                    "required": ["content"]}
        if slot == "path":
            return {"type": "object", "properties": {"path": {"type": "string"}},
                    "required": ["path"]}
        if slot == "system":
            return {
                "type": "object",
                "properties": {"system": {
                    "type": "string",
                    "enum": [s.get("name") for s in node.get("systems") or []
                             if s.get("name")]}},
                "required": ["system"],
            }
        return {
            "type": "object",
            "properties": {"confirmed": {"type": "boolean"}},
            "required": ["confirmed"],
        }

    @staticmethod
    def _evidence_schema(field_ids, label_mode):
        root = "label" if label_mode else "summary"
        return {
            "type": "object",
            "properties": {
                root: {"type": "string"},
                "outputs": {
                    "type": "object",
                    "properties": {field: {"type": "string"} for field in field_ids},
                },
                "sources": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "path": {"type": "string"},
                            "reason": {"type": "string"},
                            "line_start": {"type": "integer"},
                            "line_end": {"type": "integer"},
                        },
                        "required": ["path", "reason"],
                    },
                },
            },
            "required": [root],
        }

    def _validate_job_result(self, run, node, result):
        if not isinstance(result, dict):
            return "result는 JSON 객체여야 합니다"
        slot = run.get("waiting_slot")
        fields = [f.get("id") for f in (run.get("waiting_fields") or [])]
        if slot in ("output", "inputs"):
            output = result.get("output")
            if not isinstance(output, dict):
                return 'result에 "output" 객체가 필요합니다'
            missing = [field for field in fields if field not in output]
            if missing:
                return "필수 출력이 없습니다: " + ", ".join(missing)
            if any(isinstance(output.get(field), str) and not output[field].strip()
                   for field in fields):
                return "빈 문자열 대신 실제 값 또는 null을 제출해야 합니다"
            if slot == "inputs":
                return None
            return self._validate_evidence(node, result, output, label_mode=False)
        if slot == "label":
            labels = [x for x in (node.get("labels") or []) if x]
            if result.get("label") not in labels:
                return "label은 허용 라벨 중 하나여야 합니다: " + ", ".join(labels)
            output = result.get("output", {})
            if fields:
                if not isinstance(output, dict):
                    return 'result에 "output" 객체가 필요합니다'
                missing = [field for field in fields if field not in output]
                if missing:
                    return "필수 출력이 없습니다: " + ", ".join(missing)
            return self._validate_evidence(node, result, output, label_mode=True)
        if slot == "content":
            return None if isinstance(result.get("content"), str) and result["content"] else (
                'result에 비어 있지 않은 "content" 문자열이 필요합니다')
        if slot == "path":
            path = result.get("path")
            if not isinstance(path, str) or not path.strip():
                return 'result에 "path" 문자열이 필요합니다'
            try:
                path = self.authorize_task_path(path, "read")
            except (OSError, ValueError, PermissionError) as exc:
                return f"허용되지 않은 파일 경로입니다: {exc}"
            return None if os.path.isfile(path) else "path는 실제 파일이어야 합니다"
        if slot == "system":
            names = [s.get("name") for s in node.get("systems") or []]
            return None if result.get("system") in names else (
                "system은 선언된 시스템 중 하나여야 합니다")
        if slot in ("confirm", "approval", "confirm_retry", "confirm_done"):
            return None if isinstance(result.get("confirmed"), bool) else (
                'result에 "confirmed": true|false가 필요합니다')
        return f"지원하지 않는 대기 슬롯입니다: {slot}"

    def _validate_evidence(self, node, result, output, label_mode):
        if not node.get("evidence_required"):
            return None
        evidence = result.get("evidence")
        if not isinstance(evidence, dict):
            return '판단 result에 "evidence" 객체가 필요합니다'
        root = "label" if label_mode else "summary"
        if not str(evidence.get(root) or "").strip():
            return f'evidence에 "{root}" 근거가 필요합니다'
        reasons = evidence.get("outputs")
        reasons = reasons if isinstance(reasons, dict) else {}
        unsupported = [
            field for field, value in (output or {}).items()
            if value is not None and not str(reasons.get(field) or "").strip()
        ]
        if unsupported:
            return "null이 아닌 출력의 근거가 없습니다: " + ", ".join(unsupported)
        sources = evidence.get("sources")
        if sources is not None:
            if not isinstance(sources, list) or len(sources) > 50:
                return "evidence.sources는 최대 50개의 근거 목록이어야 합니다"
            for source in sources:
                if not isinstance(source, dict):
                    return "각 evidence.sources 항목은 객체여야 합니다"
                path = source.get("path")
                reason = source.get("reason")
                if not isinstance(path, str) or not path.strip():
                    return "각 근거에는 비어 있지 않은 path가 필요합니다"
                if not isinstance(reason, str) or not reason.strip():
                    return "각 근거에는 비어 있지 않은 reason이 필요합니다"
                try:
                    resolved = self.authorize_task_path(path.strip(), "read")
                except (OSError, ValueError, PermissionError) as exc:
                    return f"근거 파일 경로가 허용되지 않습니다: {exc}"
                if not os.path.isfile(resolved):
                    return f"근거 path는 실제 파일이어야 합니다: {path}"
                for key in ("line_start", "line_end"):
                    value = source.get(key)
                    if value is not None and (not isinstance(value, int) or value < 1):
                        return f"근거의 {key}는 1 이상의 정수여야 합니다"
        return None

    # ------------------------------------------------------------------ path/state helpers

    def _configured_trusted_roots(self):
        path = os.path.join(self.project_root, ".ops", "controller", "config.json")
        if not os.path.isfile(path):
            return []
        try:
            data = self._load_json(path)
        except (OSError, ValueError, json.JSONDecodeError):
            return []
        roots = data.get("trusted_roots") or []
        return [value for value in roots if isinstance(value, str) and value.strip()]

    @staticmethod
    def _canonical_root(path):
        root = os.path.realpath(os.path.abspath(path))
        if not os.path.isdir(root):
            raise ValueError(f"trusted root가 존재하지 않습니다: {path}")
        return root

    @staticmethod
    def _inside(path, root):
        try:
            return os.path.commonpath([os.path.normcase(path), os.path.normcase(root)]) == (
                os.path.normcase(root))
        except ValueError:
            return False

    def _resolve_project_ref(self, ref, must_exist=True, suffixes=None):
        if not isinstance(ref, str) or not ref.strip() or "\x00" in ref:
            raise ValueError("경로 ref가 비어 있거나 잘못되었습니다")
        path = ref.strip()
        if not os.path.isabs(path):
            path = os.path.join(self.project_root, path.replace("/", os.sep))
        path = os.path.realpath(os.path.abspath(path))
        if not self._inside(path, self.project_root):
            raise PermissionError("프로젝트 루트 밖의 경로 ref입니다")
        if suffixes and not path.lower().endswith(tuple(s.lower() for s in suffixes)):
            raise ValueError("허용되지 않은 파일 확장자입니다")
        if must_exist and not os.path.isfile(path):
            raise FileNotFoundError(path)
        if not must_exist:
            parent = os.path.dirname(path)
            while not os.path.exists(parent):
                new_parent = os.path.dirname(parent)
                if new_parent == parent:
                    break
                parent = new_parent
            if not self._inside(os.path.realpath(parent), self.project_root):
                raise PermissionError("출력 경로가 프로젝트 밖입니다")
        return path

    def _task_path(self, task_ref):
        return self._resolve_project_ref(
            task_ref, must_exist=True, suffixes=(".json",))

    def _run_path(self, run_ref):
        path = self._resolve_project_ref(
            run_ref, must_exist=True, suffixes=(".json",))
        allowed = [os.path.join(self.project_root, rel) for rel in _RUN_DIRS]
        if not any(self._inside(path, root) for root in allowed):
            raise PermissionError("run_ref는 .ops/runs 또는 legacy runs 안이어야 합니다")
        run = self._load_json(path)
        if run.get("snapshot_ref"):
            engine.load_run_task(path, run)
        else:
            self._task_path(run.get("task_ref"))
        return path

    def _default_task_path(self, task):
        activity = yaml_to_task._sanitize(task.get("activity") or "")
        stem = yaml_to_task._sanitize(task.get("task_name") or "") or task["task_id"]
        folder = os.path.join(self.project_root, "workflows", activity)
        candidate = os.path.join(folder, f"{stem}.json")
        if os.path.exists(candidate):
            try:
                existing_id = self._load_json(candidate).get("task_id")
            except (OSError, ValueError, json.JSONDecodeError):
                existing_id = None
            if existing_id != task.get("task_id"):
                candidate = os.path.join(folder, f"{stem}__{task['task_id']}.json")
        return self._resolve_project_ref(candidate, must_exist=False, suffixes=(".json",))

    def _runs_dir_for_existing(self, task, key):
        canonical_run = engine.find_existing_run_path(
            self.runs_dir, task.get("activity"), task.get("task_id"), key)
        if canonical_run is not None:
            return self.runs_dir
        legacy = os.path.join(self.project_root, "runs")
        canonical_legacy = os.path.realpath(legacy)
        if not self._inside(canonical_legacy, self.project_root):
            return self.runs_dir
        legacy_run = engine.find_existing_run_path(
            legacy, task.get("activity"), task.get("task_id"), key)
        if (legacy_run is not None
                and self._inside(os.path.realpath(legacy_run), canonical_legacy)):
            return legacy
        return self.runs_dir

    def _iter_task_runs(self, task):
        seen = set()
        for relative in _RUN_DIRS:
            folder = os.path.join(self.project_root, relative)
            canonical_folder = os.path.realpath(folder)
            if not self._inside(canonical_folder, self.project_root):
                continue
            try:
                names = sorted(os.listdir(folder))
            except OSError:
                continue
            for name in names:
                if not name.endswith(".json"):
                    continue
                path = os.path.join(folder, name)
                canonical = os.path.normcase(os.path.realpath(path))
                if not self._inside(canonical, canonical_folder):
                    continue
                if canonical in seen:
                    continue
                try:
                    run = self._load_json(path)
                except (OSError, ValueError, json.JSONDecodeError):
                    continue
                if (run.get("activity") == task.get("activity")
                        and run.get("task_id") == task.get("task_id")):
                    seen.add(canonical)
                    yield path, run

    def _pin_active_legacy_runs(self, task, task_path, effective_task=None):
        """Canonical design 저장 전에 snapshot 없는 기존 run의 의미를 고정한다."""
        canonical_task_path = os.path.normcase(os.path.realpath(task_path))
        current_fingerprint = engine._task_fingerprint(task_path)
        effective = (
            deepcopy(effective_task) if effective_task is not None
            else task_compat.effective_task(task, task_path)[0]
        )
        for run_path, run in self._iter_task_runs(task):
            if run.get("status") == "done" or run.get("snapshot_ref"):
                continue
            run_fingerprint = run.get("task_fingerprint")
            if (run_fingerprint is not None
                    and run_fingerprint != current_fingerprint):
                continue
            raw_ref = run.get("task_ref")
            if not isinstance(raw_ref, str) or not raw_ref:
                continue
            run_task_path = os.path.realpath(
                raw_ref if os.path.isabs(raw_ref)
                else os.path.join(self.project_root, raw_ref)
            )
            if os.path.normcase(run_task_path) != canonical_task_path:
                continue
            engine._upgrade_run_snapshot(
                run_path, run, task=deepcopy(effective))

    def _reference_manifest(self, node):
        items = []
        sources = []
        if node.get("prompt_file"):
            sources.append(("prompt_file", node.get("prompt_file")))
        sources.extend(("reference", value) for value in (node.get("references") or []))
        for kind, stored in sources:
            if not isinstance(stored, str):
                continue
            try:
                path = self.authorize_task_path(stored, "read")
            except (OSError, ValueError, PermissionError):
                continue
            if os.path.isdir(path):
                count = 0
                for root, _dirs, files in os.walk(path):
                    for name in sorted(files):
                        try:
                            file_path = self.authorize_task_path(
                                os.path.join(root, name), "read")
                        except (OSError, ValueError, PermissionError):
                            continue
                        items.append({
                            "kind": kind,
                            "path": self._ref_or_absolute(file_path),
                            "type": "file",
                            "exists": True,
                        })
                        count += 1
                        if count >= 100 or len(items) >= 100:
                            break
                    if count >= 100 or len(items) >= 100:
                        break
            else:
                items.append({
                    "kind": kind,
                    "path": self._ref_or_absolute(path),
                    "type": "file",
                    "exists": True,
                })
            if len(items) >= 100:
                break
        return items

    def _author_stage(self, task, task_path):
        if task.get("structure_confirmed") is False:
            return "structure_gate"
        projection = author_apply.structure_projection(
            task,
            allowed_direct_self_loops=(
                author_apply._legacy_direct_self_loops(task)
            ),
        )
        if not projection["ok"] or projection["changed"]:
            return "structure_gate"
        questions = author_questions.collect_questions(
            task, os.path.dirname(task_path))
        if any(question.get("qtype") == "io_confirm" for question in questions):
            return "io_gate"
        if questions:
            return "questionnaire"
        return "ready_to_validate"

    def _ref(self, path):
        relative = os.path.relpath(os.path.abspath(path), self.project_root)
        return relative.replace(os.sep, "/")

    def _ref_or_absolute(self, path):
        return self._ref(path) if self._inside(path, self.project_root) else path

    @staticmethod
    def _load_json(path):
        return util.load_json(path)

    @staticmethod
    def _fingerprint(path, length=16):
        with open(path, "rb") as handle:
            digest = hashlib.sha256(handle.read()).hexdigest()
        return digest if length is None else digest[:length]

    def _revision(self, path):
        return self._fingerprint(path, length=16)

    def _check_revision(self, path, expected):
        current = self._revision(path)
        if not expected:
            return self._invalid(
                "expected_revision이 필요합니다",
                reason_code="missing_revision",
                current_revision=current,
            )
        if expected != current:
            return self._conflict(
                "stale_revision",
                "대상을 읽은 뒤 상태가 변경되었습니다",
                current_revision=current,
            )
        return None

    def _job_id(self, run_path, run):
        material = "\0".join([
            self._ref(run_path),
            str(run.get("waiting_node") or ""),
            str(run.get("waiting_kind") or ""),
            str(run.get("waiting_since") or ""),
        ])
        return hashlib.sha256(material.encode("utf-8")).hexdigest()[:24]

    @staticmethod
    def _next_key(existing):
        today = datetime.date.today().strftime("%Y%m%d")
        number = 1
        while f"{today}-{number}" in existing:
            number += 1
        return f"{today}-{number}"

    # ------------------------------------------------------------------ idempotency/errors

    def _mutation_resources(self, tool, key, request):
        """Choose the narrowest stable coordination scope for a mutation."""
        resources = [("receipt", str(key))]
        if request.get("run_ref"):
            resources.append(("run", request["run_ref"]))
            raw_run_path = str(request["run_ref"])
            run_path = os.path.realpath(
                raw_run_path if os.path.isabs(raw_run_path)
                else os.path.join(self.project_root, raw_run_path)
            )
            try:
                run = self._load_json(run_path)
                raw_task_path = str(run.get("task_ref") or "")
                task_path = os.path.realpath(
                    raw_task_path if os.path.isabs(raw_task_path)
                    else os.path.join(self.project_root, raw_task_path)
                )
                task_identity = os.path.normcase(task_path)
                run_identity = (
                    task_identity + "\0" + str(run.get("key") or "default")
                )
                resources.extend((
                    ("task-run", task_identity),
                    ("run", run_identity),
                ))
            except (OSError, ValueError, KeyError, json.JSONDecodeError):
                pass
        elif request.get("test_id") or request.get("parse_job_id"):
            resources.append((
                "job", request.get("test_id") or request.get("parse_job_id")))
        elif request.get("task_ref"):
            identity = str(request["task_ref"])
            if tool.endswith("run_start"):
                identity += "\0" + str(request.get("key") or "")
                resources.append(("run", identity))
            else:
                resources.append(("task", identity))
            if tool == "author_submit":
                raw_task_path = str(request["task_ref"])
                task_path = os.path.realpath(
                    raw_task_path if os.path.isabs(raw_task_path)
                    else os.path.join(self.project_root, raw_task_path)
                )
                resources.append((
                    "task-run", os.path.normcase(task_path),
                ))
            if tool == "task_delete":
                raw_path = str(request["task_ref"])
                task_path = os.path.realpath(
                    raw_path if os.path.isabs(raw_path)
                    else os.path.join(self.project_root, raw_path)
                )
                resources.append((
                    "task-run",
                    os.path.normcase(os.path.realpath(task_path)),
                ))
        elif request.get("launch_id"):
            resources.append(("creator", request["launch_id"]))
        else:
            resources.append(("operation", tool))
        return resources

    def _idempotent(self, tool, key, request, action):
        if not isinstance(key, str) or not _IDEMPOTENCY_KEY_RE.match(key):
            return self._invalid(
                "idempotency_key는 제어문자 없는 8~200자 문자열이어야 합니다",
                reason_code="invalid_idempotency_key")
        digest = self._digest({"tool": tool, "request": request})
        receipt_path = os.path.join(
            self.idempotency_dir,
            hashlib.sha256(key.encode("utf-8")).hexdigest() + ".json")
        try:
            with mutation_lock.multi_resource_mutation_lock(
                    self.project_root,
                    self._mutation_resources(tool, key, request),
                    blocking=False):
                    if os.path.isfile(receipt_path):
                        receipt = self._load_json(receipt_path)
                        if (receipt.get("tool") == tool
                                and receipt.get("request_digest") == digest):
                            if "response" in receipt:
                                return receipt.get("response")
                            # Local-only mutations are safe to re-evaluate once
                            # their receipt/resource locks are free.  Long-running
                            # run execution remains uncertain to avoid repeating
                            # an external write.
                            safe_recovery = tool in {
                                "task_create_draft", "author_submit",
                                "run_delete", "creator_draft_submit",
                                "creator_custom_logic_submit",
                            }
                            if safe_recovery:
                                try:
                                    os.remove(receipt_path)
                                except FileNotFoundError:
                                    pass
                            else:
                                return {
                                    "status": "uncertain",
                                    "reason_code": "idempotency_uncertain",
                                    "reason": (
                                        "이전 요청의 완료 여부를 현재 상태에서 "
                                        "확인해야 합니다. 요청을 자동으로 반복하지 않았습니다"
                                    ),
                                    "retryable": False,
                                }
                        else:
                            return self._conflict(
                                "idempotency_conflict",
                                "같은 idempotency_key가 다른 요청에 이미 사용되었습니다")
                    # 실행 전 pending receipt를 먼저 남긴다. 실행 후 디스크 오류나 프로세스
                    # 종료가 생겨도 같은 요청을 조용히 재실행하지 않는다.
                    created_at = datetime.datetime.now().isoformat(
                        timespec="seconds")
                    util.atomic_write_json(receipt_path, {
                        "tool": tool,
                        "request_digest": digest,
                        "state": "pending",
                        "created_at": created_at,
                    })
                    response = action()
                    # 이 충돌은 task를 전혀 바꾸지 않은 외부 파일 사전조건 실패다.
                    # 사용자가 파일을 정리한 뒤 같은 화면을 그대로 다시 제출할 수
                    # 있도록 완료 receipt를 남기지 않는다.
                    if (
                        isinstance(response, dict)
                        and response.get("status") == "conflict"
                        and response.get("reason_code")
                            == "prompt_file_conflict"
                    ):
                        try:
                            os.remove(receipt_path)
                        except FileNotFoundError:
                            pass
                        return response
                    util.atomic_write_json(receipt_path, {
                        "tool": tool,
                        "request_digest": digest,
                        "state": "complete",
                        "response": response,
                        "created_at": created_at,
                    })
                    return response
        except mutation_lock.MutationBusy as exc:
            return {
                "status": "busy",
                "reason_code": "resource_mutation_busy",
                "reason": str(exc),
                "retryable": True,
            }
        except (OSError, ValueError, KeyError, json.JSONDecodeError) as exc:
            return self._failure(f"{tool}_failed", exc)

    @staticmethod
    def _digest(value):
        raw = json.dumps(
            value, ensure_ascii=False, sort_keys=True,
            separators=(",", ":"), default=str).encode("utf-8")
        return hashlib.sha256(raw).hexdigest()

    @classmethod
    def _strip_legacy(cls, value):
        if isinstance(value, dict):
            return {
                key: cls._strip_legacy(item)
                for key, item in value.items()
                if key not in _DROP_TRANSPORT_KEYS
            }
        if isinstance(value, list):
            return [cls._strip_legacy(item) for item in value]
        return value

    @staticmethod
    def _invalid(reason, reason_code="invalid_request", **extra):
        return {"status": "invalid", "reason_code": reason_code,
                "reason": str(reason), **extra}

    @staticmethod
    def _conflict(reason_code, reason, **extra):
        return {"status": "conflict", "reason_code": reason_code,
                "reason": str(reason), **extra}

    @staticmethod
    def _failure(reason_code, error):
        return {"status": "error", "reason_code": reason_code,
                "reason": str(error)}
