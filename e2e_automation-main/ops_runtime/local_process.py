# -*- coding: utf-8 -*-
"""프로젝트의 백그라운드 프로세스를 관리하는 공통 함수."""
from __future__ import annotations

import os
import subprocess
import threading

from . import util


def canonical_root(value):
    return os.path.realpath(os.path.abspath(value))


def write_private(path, value):
    """상태 JSON을 원자적으로 쓰고 지원되는 OS에서 권한을 제한한다."""
    util.atomic_write_json(path, value)
    try:
        os.chmod(path, 0o600)
    except OSError:
        # Windows에서는 프로젝트 폴더의 사용자 ACL을 그대로 사용한다.
        pass


def process_alive(pid):
    """PID가 현재 실행 중인 OS 프로세스를 가리키는지 반환한다."""
    try:
        pid = int(pid)
    except (TypeError, ValueError):
        return False
    if pid <= 0:
        return False

    if os.name == "nt":
        import ctypes
        from ctypes import wintypes

        process_query_limited_information = 0x1000
        still_active = 259
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        open_process = kernel32.OpenProcess
        open_process.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
        open_process.restype = wintypes.HANDLE
        get_exit_code = kernel32.GetExitCodeProcess
        get_exit_code.argtypes = (
            wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD))
        get_exit_code.restype = wintypes.BOOL
        close_handle = kernel32.CloseHandle
        close_handle.argtypes = (wintypes.HANDLE,)
        close_handle.restype = wintypes.BOOL

        handle = open_process(process_query_limited_information, False, pid)
        if not handle:
            # Access denied이면 프로세스가 살아 있을 수 있다. PID가 없을 때 Windows가
            # 반환하는 ERROR_INVALID_PARAMETER 등은 종료로 판단한다.
            return ctypes.get_last_error() == 5
        try:
            exit_code = wintypes.DWORD()
            if not get_exit_code(handle, ctypes.byref(exit_code)):
                return True
            return exit_code.value == still_active
        finally:
            close_handle(handle)

    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def spawn_worker(argv, project_root):
    """현재 Python 환경을 유지한 채 콘솔 없는 백그라운드 프로세스를 실행한다."""
    module_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    env = dict(os.environ)
    inherited = env.get("PYTHONPATH")
    env["PYTHONPATH"] = (
        module_root + (os.pathsep + inherited if inherited else ""))
    common = {
        "cwd": project_root,
        "stdin": subprocess.DEVNULL,
        "stdout": subprocess.DEVNULL,
        "stderr": subprocess.DEVNULL,
        "shell": False,
        "close_fds": True,
        "env": env,
    }
    if os.name != "nt":
        return subprocess.Popen(argv, start_new_session=True, **common)

    detached = getattr(subprocess, "DETACHED_PROCESS", 0x00000008)
    new_group = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0x00000200)
    breakaway = getattr(subprocess, "CREATE_BREAKAWAY_FROM_JOB", 0x01000000)
    try:
        return subprocess.Popen(
            argv, creationflags=detached | new_group | breakaway, **common)
    except OSError:
        # 일부 회사 단말의 Job Object는 breakaway를 금지한다.
        return subprocess.Popen(
            argv, creationflags=detached | new_group, **common)


def reap_later(child, thread_name):
    """백그라운드 프로세스의 운영체제 자원을 종료 후 비동기로 회수한다."""
    threading.Thread(
        target=child.wait, name=thread_name, daemon=True).start()
