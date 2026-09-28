# -*- coding: utf-8 -*-
"""사용자 산출물과 재생성 가능한 런타임 부산물의 경로를 분리한다."""
import os
import re


OPS_DIR = ".ops"
RUNS_DIR = os.path.join(OPS_DIR, "runs")
PAYLOADS_DIR = os.path.join(OPS_DIR, "payloads")


def ensure_dirs(root=None):
    """재생성 가능한 런타임 디렉터리를 미리 만든다."""
    root = os.path.abspath(root or os.getcwd())
    paths = {}
    for name, relative in (("runs", RUNS_DIR), ("payloads", PAYLOADS_DIR)):
        path = os.path.join(root, relative)
        os.makedirs(path, exist_ok=True)
        paths[name] = path
    return paths


def _safe(value):
    value = re.sub(r"\s+", "", str(value or ""))
    return re.sub(r'[\\/:*?"<>|]+', "-", value) or "task"


def project_root(task_path):
    """task 상위에서 ops_runtime이 있는 프로젝트 루트를 찾는다.

    프로젝트 밖 임시 task는 자신의 폴더 아래에 .ops를 만든다.
    """
    start = os.path.dirname(os.path.abspath(task_path)) or os.getcwd()
    here = start
    while True:
        if os.path.isdir(os.path.join(here, "ops_runtime")):
            return here
        parent = os.path.dirname(here)
        if parent == here:
            return start
        here = parent


def project_relative(path, task_path):
    """프로젝트 내부 경로를 task JSON에 저장할 슬래시 상대경로로 바꾼다."""
    if not isinstance(path, str) or not path.strip():
        return path
    absolute = os.path.abspath(path)
    root = project_root(task_path)
    try:
        relative = os.path.relpath(absolute, root)
    except ValueError:  # Windows의 다른 드라이브 등 프로젝트 밖 경로
        return path.replace("\\", "/")
    if relative == os.pardir or relative.startswith(os.pardir + os.sep):
        return path.replace("\\", "/")
    return relative.replace("\\", "/")


def resolve_project_path(path, task_path):
    """task JSON의 프로젝트 상대경로를 현재 프로젝트의 실제 경로로 해석한다."""
    if not isinstance(path, str) or not path.strip() or os.path.isabs(path):
        return path
    return os.path.abspath(os.path.join(project_root(task_path), path))


def ui_path(task_path, task, kind):
    root = project_root(task_path)
    activity = _safe((task or {}).get("activity") or "workflow")
    stem = _safe(os.path.splitext(os.path.basename(task_path))[0])
    folder = os.path.join(root, OPS_DIR, "ui", activity)
    os.makedirs(folder, exist_ok=True)
    suffix = "질문지" if kind == "questions" else "구성편집"
    return os.path.join(folder, f"{stem}_{suffix}.html")


def history_dir(task_path, task_id):
    folder = os.path.join(project_root(task_path), OPS_DIR, "history", _safe(task_id))
    os.makedirs(folder, exist_ok=True)
    return folder


def is_consumable_payload(path):
    """도구가 만든 .ops/payloads 파일만 성공 후 자동 삭제한다."""
    marker = os.sep + OPS_DIR + os.sep + "payloads" + os.sep
    return marker.lower() in os.path.realpath(path).lower()
