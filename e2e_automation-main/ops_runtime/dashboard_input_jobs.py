# -*- coding: utf-8 -*-
"""Dashboard Runner의 전체 붙여넣기 입력을 Code Assistant 작업으로 연결한다."""
from __future__ import annotations

import datetime
import hashlib
import json
import os
import re
import shlex
import subprocess
import sys

from . import runner_app, util, workspace


_ID_RE = re.compile(r"^[A-Za-z0-9._-]{8,160}$")
_REASON_CODE_RE = re.compile(r"^[a-z0-9_]{3,80}$")
_MAX_RAW_INPUT = 1024 * 1024
_MAX_REJECTION_MESSAGE = 4000
_MAX_MISSING_FIELDS = 100


def _now():
    return datetime.datetime.now().isoformat(timespec="seconds")


def _digest(value):
    raw = json.dumps(
        value, ensure_ascii=False, sort_keys=True,
        separators=(",", ":"), default=str).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def _command_line(argv):
    return subprocess.list2cmdline(argv) if os.name == "nt" else shlex.join(argv)


def _object_particle(value):
    text = str(value or "").strip()
    if not text:
        return "을"
    code = ord(text[-1])
    if 0xAC00 <= code <= 0xD7A3:
        return "을" if (code - 0xAC00) % 28 else "를"
    return "을"


class DashboardInputJobs:
    """사용자가 붙여넣은 원문을 Runner의 사용자 입력 형식으로 정리하는 임시 큐."""

    def __init__(self, controller):
        self.controller = controller
        self.root = os.path.realpath(os.path.join(
            controller.project_root, ".ops", "dashboard", "runner-inputs"))
        if not controller._inside(self.root, controller.project_root):
            raise ValueError("Dashboard 입력 작업 경로가 프로젝트 밖입니다")
        os.makedirs(self.root, exist_ok=True)

    def create(self, run_ref, job_id, revision, raw_input):
        if not isinstance(raw_input, str) or not raw_input.strip():
            return self.controller._invalid("붙여넣은 내용을 입력해 주세요")
        if len(raw_input.encode("utf-8")) > _MAX_RAW_INPUT:
            return self.controller._invalid("붙여넣은 내용은 1MB 이하여야 합니다")
        boundary = self.controller.run_status(run_ref)
        current = boundary.get("job") or {}
        if (
            boundary.get("status") != "paused"
            or current.get("actor") != "user"
        ):
            return self.controller._conflict(
                "run_not_waiting_for_user",
                "현재 실행은 사용자 입력을 기다리는 상태가 아닙니다",
                current_revision=boundary.get("revision"),
            )
        if job_id != current.get("job_id") or revision != boundary.get("revision"):
            return self.controller._conflict(
                "stale_job",
                "현재 사용자 입력 단계가 변경되었습니다",
                current_job_id=current.get("job_id"),
                current_revision=boundary.get("revision"),
            )
        parse_job_id = self._parse_job_id(
            boundary.get("run_ref"), job_id, revision)
        path = self._path(parse_job_id)
        record = {
            "type": "ops_dashboard_runner_input",
            "parse_job_id": parse_job_id,
            "status": "waiting_agent",
            "run_ref": boundary["run_ref"],
            "target_job_id": job_id,
            "target_revision": revision,
            "node_label": current.get("node_label"),
            "prompt": current.get("prompt"),
            "fields": current.get("fields") or [],
            "result_schema": current.get("result_schema") or {},
            "raw_input": raw_input,
            "raw_digest": _digest(raw_input),
            "created_at": _now(),
            "updated_at": _now(),
        }
        try:
            previous = util.load_json(path)
        except (OSError, ValueError, json.JSONDecodeError):
            previous = None
        if (
            previous
            and previous.get("status") == "waiting_agent"
            and previous.get("raw_digest") == record["raw_digest"]
        ):
            record = previous
        else:
            util.atomic_write_json(path, record)
        return {
            "status": "ok",
            "parse_job_id": parse_job_id,
            "run_ref": boundary["run_ref"],
            "revision": self._revision(record),
            "queued": True,
        }

    def create_dependency_dummy(self, run_ref, job_id, revision):
        """Queue an AI draft for a dependency-output pause without user paste."""
        boundary = self.controller.run_status(run_ref)
        current = boundary.get("job") or {}
        if (
            boundary.get("status") != "paused"
            or current.get("actor") != "user"
            or current.get("kind") != "ask_dependency_dummy"
        ):
            return self.controller._conflict(
                "run_not_waiting_for_dependency_dummy",
                "현재 실행은 이전 Task 더미 입력을 기다리는 상태가 아닙니다.",
                current_revision=boundary.get("revision"),
            )
        if job_id != current.get("job_id") or revision != boundary.get("revision"):
            return self.controller._conflict(
                "stale_job", "현재 사용자 입력 단계가 변경되었습니다.",
                current_job_id=current.get("job_id"),
                current_revision=boundary.get("revision"),
            )
        parse_job_id = self._parse_job_id(boundary["run_ref"], job_id, revision)
        path = self._path(parse_job_id)
        record = {
            "type": "ops_dashboard_runner_input",
            "mode": "dependency_dummy",
            "parse_job_id": parse_job_id,
            "status": "waiting_agent",
            "run_ref": boundary["run_ref"],
            "target_job_id": job_id,
            "target_revision": revision,
            "node_label": current.get("node_label"),
            "prompt": current.get("prompt"),
            "fields": current.get("fields") or [],
            "result_schema": current.get("result_schema") or {},
            "raw_input": "이전 Task 출력이 없는 모든 항목의 예시 데이터",
            "raw_digest": _digest({"mode": "dependency_dummy", "fields": current.get("fields") or []}),
            "created_at": _now(),
            "updated_at": _now(),
        }
        try:
            previous = util.load_json(path)
        except (OSError, ValueError, json.JSONDecodeError):
            previous = None
        if previous and previous.get("mode") == "dependency_dummy" and previous.get("status") in (
                "waiting_agent", "review_ready"):
            record = previous
        else:
            util.atomic_write_json(path, record)
        return {
            "status": "ok", "parse_job_id": parse_job_id,
            "run_ref": boundary["run_ref"], "revision": self._revision(record),
            "queued": record.get("status") == "waiting_agent",
            "already_drafted": record.get("status") == "review_ready",
        }

    def decorate_boundary(self, boundary):
        """현재 사용자 입력 대기와 연결된 처리 상태를 화면에 덧붙인다."""
        if not isinstance(boundary, dict):
            return boundary
        current = boundary.get("job") or {}
        if (
            boundary.get("status") != "paused"
            or current.get("actor") != "user"
            or not boundary.get("run_ref")
            or not current.get("job_id")
            or not boundary.get("revision")
        ):
            return boundary
        parse_job_id = self._parse_job_id(
            boundary["run_ref"], current["job_id"], boundary["revision"])
        try:
            record = self._load(parse_job_id)
        except (OSError, ValueError, json.JSONDecodeError):
            return boundary
        if not self._matches_boundary(record, boundary):
            return boundary
        status = record.get("status")
        if status not in (
            "waiting_agent", "review_ready", "needs_user_input"
        ):
            return boundary
        result = dict(boundary)
        result["input_parse"] = self._public_state(record)
        return result

    def list_jobs(self):
        jobs = []
        try:
            names = sorted(os.listdir(self.root))
        except OSError:
            names = []
        for name in names:
            if not name.endswith(".json"):
                continue
            try:
                record = util.load_json(os.path.join(self.root, name))
            except (OSError, ValueError, json.JSONDecodeError):
                continue
            if (
                record.get("type") != "ops_dashboard_runner_input"
                or record.get("status") != "waiting_agent"
            ):
                continue
            boundary = self.controller.run_status(record.get("run_ref"))
            current = boundary.get("job") or {}
            if (
                boundary.get("status") != "paused"
                or current.get("actor") != "user"
                or current.get("job_id") != record.get("target_job_id")
                or boundary.get("revision") != record.get("target_revision")
            ):
                continue
            jobs.append(self._public_job(record))
        return jobs

    def submit(self, parse_job_id, expected_revision, result_file,
               defer_pump=False):
        """호환성을 위해 AI가 정리한 결과를 사용자 입력 대기에 바로 제출한다."""
        record = self._load(parse_job_id)
        if record.get("status") == "completed":
            return record.get("completion") or {
                "status": "ok", "already_completed": True}
        if record.get("status") == "processing":
            result_path = record.get("result_path") or self.controller.authorize_path(
                result_file, "read")
            boundary = self.controller.run_status(record["run_ref"])
            if boundary.get("status") in ("paused", "done", "error"):
                return self.complete_submit(parse_job_id, boundary, result_path)
            return {
                **boundary,
                "parse_job_id": parse_job_id,
                "result_path": result_path,
            }
        current_revision = self._revision(record)
        if expected_revision != current_revision:
            return self.controller._conflict(
                "stale_input_parse_revision",
                "붙여넣기 입력 작업이 변경되었습니다",
                current_revision=current_revision,
            )
        if record.get("status") != "waiting_agent":
            return self.controller._conflict(
                "input_parse_not_waiting",
                "현재 처리할 붙여넣기 입력 작업이 없습니다")
        result_path = self.controller.authorize_path(result_file, "read")
        result = util.load_json(result_path)
        boundary = self.controller.run_complete_human_job(
            record["run_ref"],
            record["target_job_id"],
            record["target_revision"],
            f"dashboard-input-{parse_job_id}-{current_revision}",
            result,
            defer_pump=defer_pump,
        )
        if boundary.get("status") in ("invalid", "conflict", "busy", "error"):
            return boundary
        if defer_pump and boundary.get("status") == "running":
            record.update({
                "status": "processing",
                "updated_at": _now(),
                "result_path": result_path,
            })
            util.atomic_write_json(self._path(parse_job_id), record)
            return {
                **boundary,
                "parse_job_id": parse_job_id,
                "result_path": result_path,
            }
        return self.complete_submit(parse_job_id, boundary, result_path)

    def complete_submit(self, parse_job_id, boundary, result_path):
        record = self._load(parse_job_id)
        completion = runner_app._decorate_result(
            self.controller.project_root, boundary)
        record.update({
            "status": "completed",
            "completed_at": _now(),
            "updated_at": _now(),
            "completion": completion,
        })
        record.pop("result_path", None)
        util.atomic_write_json(self._path(parse_job_id), record)
        try:
            os.remove(result_path)
        except OSError:
            pass
        return completion

    def draft(self, parse_job_id, expected_revision, result_file):
        """AI가 정리한 값을 Runner에 제출하지 않고 사용자 검토 초안으로 저장한다."""
        record = self._load(parse_job_id)
        if record.get("status") == "review_ready":
            return self._draft_result(record, already_drafted=True)
        current_revision = self._revision(record)
        if expected_revision != current_revision:
            return self.controller._conflict(
                "stale_input_parse_revision",
                "붙여넣기 입력 작업이 변경되었습니다",
                current_revision=current_revision,
            )
        if record.get("status") != "waiting_agent":
            return self.controller._conflict(
                "input_parse_not_waiting",
                "현재 처리할 붙여넣기 입력 작업이 없습니다")
        boundary = self.controller.run_status(record.get("run_ref"))
        if not self._matches_boundary(record, boundary):
            return self.controller._conflict(
                "stale_input_parse_target",
                "현재 사용자 입력 단계가 변경되었습니다",
                current_revision=boundary.get("revision"),
            )
        result_path = self.controller.authorize_path(result_file, "read")
        payload = util.load_json(result_path)
        if not isinstance(payload, dict):
            return self.controller._invalid(
                "입력 초안 결과는 JSON 객체여야 합니다")
        raw_output = payload.get("output")
        if not isinstance(raw_output, dict):
            return self.controller._invalid(
                "입력 초안 결과에는 output 객체가 필요합니다")
        draft_output = self._normalize_draft_output(record, raw_output)
        record.update({
            "status": "review_ready",
            "drafted_at": _now(),
            "updated_at": _now(),
            "draft_output": draft_output,
        })
        record.pop("rejection", None)
        record.pop("rejected_at", None)
        util.atomic_write_json(self._path(parse_job_id), record)
        try:
            os.remove(result_path)
        except OSError:
            pass
        return self._draft_result(record)

    def reject(self, parse_job_id, expected_revision, result_file):
        """Code Assistant가 원문을 필수 항목으로 정리할 수 없음을 종결 제출한다."""
        record = self._load(parse_job_id)
        if record.get("status") == "needs_user_input":
            return self._rejection_result(record, already_rejected=True)
        current_revision = self._revision(record)
        if expected_revision != current_revision:
            return self.controller._conflict(
                "stale_input_parse_revision",
                "붙여넣기 입력 작업이 변경되었습니다",
                current_revision=current_revision,
            )
        if record.get("status") != "waiting_agent":
            return self.controller._conflict(
                "input_parse_not_waiting",
                "현재 처리할 붙여넣기 입력 작업이 없습니다")
        boundary = self.controller.run_status(record.get("run_ref"))
        if not self._matches_boundary(record, boundary):
            return self.controller._conflict(
                "stale_input_parse_target",
                "현재 사용자 입력 단계가 변경되었습니다",
                current_revision=boundary.get("revision"),
            )
        result_path = self.controller.authorize_path(result_file, "read")
        payload = util.load_json(result_path)
        if not isinstance(payload, dict):
            return self.controller._invalid(
                "입력 확인 필요 결과는 JSON 객체여야 합니다")
        reason_code = str(
            payload.get("reason_code") or "missing_required_fields").strip()
        if not _REASON_CODE_RE.fullmatch(reason_code):
            return self.controller._invalid(
                "입력 확인 필요 reason_code 형식이 잘못되었습니다")
        missing_fields = payload.get("missing_fields") or []
        if (
            not isinstance(missing_fields, list)
            or not missing_fields
            or len(missing_fields) > _MAX_MISSING_FIELDS
            or any(
                not isinstance(value, str) or not value.strip()
                for value in missing_fields
            )
        ):
            return self.controller._invalid(
                "missing_fields는 비어 있지 않은 문자열 배열이어야 합니다")
        missing_fields = self._display_field_names(
            record, [value.strip() for value in missing_fields])
        message = str(payload.get("message") or "").strip()
        if not message:
            if len(missing_fields) == 1:
                message = (
                    f"붙여넣은 내용에서 ‘{missing_fields[0]}’"
                    f"{_object_particle(missing_fields[0])} "
                    "확인하지 못했습니다.")
            else:
                message = (
                    "붙여넣은 내용에서 필요한 항목을 확인하지 못했습니다.")
        if len(message) > _MAX_REJECTION_MESSAGE:
            return self.controller._invalid(
                "입력 확인 필요 안내가 허용 길이를 초과했습니다")
        record.update({
            "status": "needs_user_input",
            "rejected_at": _now(),
            "updated_at": _now(),
            "rejection": {
                "reason_code": reason_code,
                "message": message,
                "missing_fields": missing_fields,
            },
        })
        util.atomic_write_json(self._path(parse_job_id), record)
        try:
            os.remove(result_path)
        except OSError:
            pass
        return self._rejection_result(record)

    def _public_job(self, record):
        revision = self._revision(record)
        payload_dir = workspace.ensure_dirs(
            self.controller.project_root)["payloads"]
        payload_path = os.path.join(
            payload_dir, f"{record['parse_job_id']}.json")
        draft_command = [
            os.path.abspath(sys.executable),
            "-B",
            "-m",
            "ops_runtime.dashboard_app",
            "runner-input-draft",
            "--project-root",
            self.controller.project_root,
            "--parse-job-id",
            record["parse_job_id"],
            "--expected-revision",
            revision,
            "--result-file",
            payload_path,
        ]
        reject_command = [
            os.path.abspath(sys.executable),
            "-B",
            "-m",
            "ops_runtime.dashboard_app",
            "runner-input-reject",
            "--project-root",
            self.controller.project_root,
            "--parse-job-id",
            record["parse_job_id"],
            "--expected-revision",
            revision,
            "--result-file",
            payload_path,
        ]
        fields = record.get("fields") or []
        field_names = [
            f"{item.get('name') or item.get('id')} ({item.get('id')})"
            for item in fields if isinstance(item, dict) and item.get("id")
        ]
        if record.get("mode") == "dependency_dummy":
            sources = []
            for item in fields:
                if isinstance(item, dict):
                    sources.append(
                        f"{item.get('source_task_name') or item.get('from_task')} / "
                        f"{item.get('source_node_name') or item.get('from_node')} / "
                        f"{item.get('source_field_name') or item.get('from_field')}"
                    )
            prompt = (
                "Runner가 시작 전에 요구하는 모든 항목에 짧고 이해하기 쉬운 예시 문장을 "
                "작성하세요. 실제 개인정보, 인증정보, 운영 식별자는 사용하지 마세요. "
                "각 값은 일반 텍스트로 작성하고 모든 필드 id를 output 객체에 포함하세요. "
                "결과는 자동 제출되지 않고 사용자 검토 화면에만 채워집니다. "
                "payload_file에 결과를 저장하고 resume_command를 실행하세요. "
                "출처: " + "; ".join(sources)
            )
            job_kind = "dependency_dummy_draft"
        else:
            prompt = (
                "사용자가 Dashboard에 붙여넣은 원문과 요청을 바탕으로 현재 사용자 입력 "
                "항목의 초안을 result_schema에 맞게 작성하세요. 원문이 값 생성을 요청하면 "
                "검토 가능한 초안 값을 생성해도 됩니다. 확인하거나 작성할 수 있는 항목만 "
                "output 객체에 넣고, 나머지는 생략해도 됩니다. 결과는 Runner에 자동 "
                "반영되지 않고 항목별 직접 입력 화면에 채워져 사용자가 검토합니다. "
                "payload_file에 초안 JSON을 저장하고 resume_command를 실행해 작업을 "
                "반드시 종결하세요."
            )
            job_kind = "user_input_parse"
        if field_names:
            prompt += " 대상 필드: " + ", ".join(field_names)
        return {
            "domain": "runner",
            "kind": job_kind,
            "run_ref": record["run_ref"],
            "parse_job_id": record["parse_job_id"],
            "revision": revision,
            "job": {
                "job_id": record["parse_job_id"],
                "revision": revision,
                "actor": "agent",
                "kind": job_kind,
                "node_label": record.get("node_label") or "사용자 입력 정리",
                "prompt": prompt,
                "raw_input": record.get("raw_input"),
                "fields": fields,
                "result_schema": record.get("result_schema") or {},
            },
            "payload_file": os.path.relpath(
                payload_path, self.controller.project_root).replace(os.sep, "/"),
            "resume_command": _command_line(draft_command),
            "reject_command": _command_line(reject_command),
        }

    @staticmethod
    def _parse_job_id(run_ref, job_id, revision):
        identity = _digest({
            "run_ref": run_ref,
            "job_id": job_id,
            "revision": revision,
        })[:32]
        return f"runner-input-{identity}"

    @staticmethod
    def _matches_boundary(record, boundary):
        current = boundary.get("job") or {}
        return (
            boundary.get("status") == "paused"
            and current.get("actor") == "user"
            and boundary.get("run_ref") == record.get("run_ref")
            and current.get("job_id") == record.get("target_job_id")
            and boundary.get("revision") == record.get("target_revision")
        )

    @staticmethod
    def _display_field_names(record, values):
        names = {}
        for item in record.get("fields") or []:
            if not isinstance(item, dict):
                continue
            field_id = item.get("id")
            field_name = item.get("name") or field_id
            if field_id:
                names[str(field_id)] = str(field_name)
            if field_name:
                names[str(field_name)] = str(field_name)
        return [names.get(value, value) for value in values]

    def _public_state(self, record):
        rejection = record.get("rejection") or {}
        return {
            "status": record.get("status"),
            "mode": record.get("mode") or "pasted_input",
            "raw_input": record.get("raw_input") or "",
            "draft_output": record.get("draft_output") or {},
            "reason_code": rejection.get("reason_code"),
            "message": rejection.get("message"),
            "missing_fields": rejection.get("missing_fields") or [],
            "updated_at": record.get("updated_at"),
        }

    def _draft_result(self, record, already_drafted=False):
        boundary = self.controller.run_status(record.get("run_ref"))
        result = {
            "status": "ok",
            "outcome": "review_ready",
            "run_ref": record.get("run_ref"),
            "run_revision": boundary.get("revision"),
            "input_parse": self._public_state(record),
        }
        if already_drafted:
            result["already_drafted"] = True
        return result

    def _rejection_result(self, record, already_rejected=False):
        boundary = self.controller.run_status(record.get("run_ref"))
        result = {
            "status": "ok",
            "outcome": "needs_user_input",
            "run_ref": record.get("run_ref"),
            "run_revision": boundary.get("revision"),
            "input_parse": self._public_state(record),
        }
        if already_rejected:
            result["already_rejected"] = True
        return result

    @staticmethod
    def _normalize_draft_output(record, raw_output):
        fields = [
            item for item in record.get("fields") or []
            if isinstance(item, dict) and item.get("id")
        ]
        if not fields:
            return dict(raw_output)
        normalized = {}
        for field in fields:
            field_id = str(field["id"])
            field_name = str(field.get("name") or field_id)
            if field_id in raw_output:
                normalized[field_id] = raw_output[field_id]
            elif field_name in raw_output:
                normalized[field_id] = raw_output[field_name]
        return normalized

    def _path(self, parse_job_id):
        if not isinstance(parse_job_id, str) or not _ID_RE.fullmatch(parse_job_id):
            raise ValueError("잘못된 Dashboard 입력 작업 ID")
        path = os.path.realpath(os.path.join(self.root, f"{parse_job_id}.json"))
        if not self.controller._inside(path, self.root):
            raise PermissionError("Dashboard 입력 작업 경로가 범위를 벗어났습니다")
        return path

    def _load(self, parse_job_id):
        value = util.load_json(self._path(parse_job_id))
        if value.get("type") != "ops_dashboard_runner_input":
            raise ValueError("Dashboard 입력 작업 형식이 올바르지 않습니다")
        return value

    @staticmethod
    def _revision(record):
        return _digest({
            key: value for key, value in record.items()
            if key not in ("updated_at", "completion")
        })[:16]
