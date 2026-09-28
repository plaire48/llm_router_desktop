"""실행 프로세스가 살아 있는 Dashboard에 best-effort 이벤트를 전달한다."""
from __future__ import annotations

import json
import os
from urllib import error as urlerror
from urllib import request as urlrequest

from . import util


_EVENT_PATH = "/api/internal/events"


def publish_to_live_dashboard(project_root, event, timeout=0.35):
    """현재 프로젝트 Dashboard가 살아 있으면 로컬 이벤트를 전달한다.

    이벤트 전달 실패는 Runner 결과 제출을 실패로 바꾸면 안 되므로 모든 연결·상태
    오류를 False로 축약한다.
    """
    root = os.path.realpath(os.path.abspath(project_root))
    record_path = os.path.join(root, ".ops", "dashboard", "server.json")
    try:
        record = util.load_json(record_path)
        if record.get("type") != "ops_dashboard_server":
            return False
        if os.path.realpath(os.path.abspath(
                record.get("project_root") or "")) != root:
            return False
        base_url = str(record["base_url"])
        server_id = str(record["server_id"])
        raw = json.dumps(event, ensure_ascii=False).encode("utf-8")
        request = urlrequest.Request(
            base_url + _EVENT_PATH,
            data=raw,
            headers={
                "Content-Type": "application/json",
                "X-Ops-Dashboard-Token": server_id,
            },
            method="POST",
        )
        opener = urlrequest.build_opener(urlrequest.ProxyHandler({}))
        with opener.open(request, timeout=float(timeout)) as response:
            result = json.loads(response.read().decode("utf-8"))
        return response.status == 200 and result.get("status") == "ok"
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError,
            urlerror.URLError):
        return False
