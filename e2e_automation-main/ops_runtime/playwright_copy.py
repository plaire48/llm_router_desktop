# -*- coding: utf-8 -*-
"""기존 Edge 로그인 세션에서 페이지 접근성 snapshot을 한 번 복사한다.

Python Playwright를 격리된 Python worker에서 실행한다. 외부 Edge는 종료하지
않고 자동화용 탭만 열었다 닫으며, worker가 멈추면 부모가 제한 시간 안에
그 worker와 Playwright driver 하위 프로세스만 정리한다.
"""
from __future__ import annotations

from contextlib import contextmanager
import json
import os
import signal
import subprocess
import sys
import tempfile
import threading
import time
from urllib import error as urllib_error
from urllib import parse as urllib_parse
from urllib import request as urllib_request
import uuid


MAX_SNAPSHOT_BYTES = 1024 * 1024
MAX_URL_BYTES = 64 * 1024
DEFAULT_TIMEOUT_SECONDS = 90.0
_WORKER_CLEANUP_GRACE_MS = 5000

_EDGE_THREAD_LOCK = threading.Lock()
_LOCK_POLL_SECONDS = 0.05


class PlaywrightCopyError(RuntimeError):
    """Playwright 자동 복사를 완료하지 못했다."""


def _default_worker_command():
    return (sys.executable, os.path.abspath(__file__), "--worker")


def _windows_descendant_pids(root_pid):
    """Toolhelp snapshot에서 root_pid의 모든 하위 PID를 찾는다."""
    import ctypes
    from ctypes import wintypes

    class ProcessEntry(ctypes.Structure):
        _fields_ = [
            ("dwSize", wintypes.DWORD),
            ("cntUsage", wintypes.DWORD),
            ("th32ProcessID", wintypes.DWORD),
            ("th32DefaultHeapID", ctypes.c_size_t),
            ("th32ModuleID", wintypes.DWORD),
            ("cntThreads", wintypes.DWORD),
            ("th32ParentProcessID", wintypes.DWORD),
            ("pcPriClassBase", wintypes.LONG),
            ("dwFlags", wintypes.DWORD),
            ("szExeFile", wintypes.WCHAR * 260),
        ]

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    create_snapshot = kernel32.CreateToolhelp32Snapshot
    create_snapshot.argtypes = (wintypes.DWORD, wintypes.DWORD)
    create_snapshot.restype = wintypes.HANDLE
    process_first = kernel32.Process32FirstW
    process_first.argtypes = (wintypes.HANDLE, ctypes.POINTER(ProcessEntry))
    process_first.restype = wintypes.BOOL
    process_next = kernel32.Process32NextW
    process_next.argtypes = (wintypes.HANDLE, ctypes.POINTER(ProcessEntry))
    process_next.restype = wintypes.BOOL
    close_handle = kernel32.CloseHandle
    close_handle.argtypes = (wintypes.HANDLE,)

    snapshot = create_snapshot(0x00000002, 0)  # TH32CS_SNAPPROCESS
    if snapshot == wintypes.HANDLE(-1).value:
        return []
    children = {}
    try:
        entry = ProcessEntry()
        entry.dwSize = ctypes.sizeof(entry)
        present = process_first(snapshot, ctypes.byref(entry))
        while present:
            children.setdefault(int(entry.th32ParentProcessID), []).append(
                int(entry.th32ProcessID))
            present = process_next(snapshot, ctypes.byref(entry))
    finally:
        close_handle(snapshot)

    descendants = []
    pending = list(children.get(int(root_pid), ()))
    while pending:
        pid = pending.pop()
        descendants.append(pid)
        pending.extend(children.get(pid, ()))
    return descendants


def _windows_force_terminate(pid):
    import ctypes
    from ctypes import wintypes

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    open_process = kernel32.OpenProcess
    open_process.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
    open_process.restype = wintypes.HANDLE
    terminate_process = kernel32.TerminateProcess
    terminate_process.argtypes = (wintypes.HANDLE, wintypes.UINT)
    terminate_process.restype = wintypes.BOOL
    close_handle = kernel32.CloseHandle
    close_handle.argtypes = (wintypes.HANDLE,)
    close_handle.restype = wintypes.BOOL
    handle = open_process(0x0001, False, int(pid))  # PROCESS_TERMINATE
    if not handle:
        return
    try:
        terminate_process(handle, 1)
    finally:
        close_handle(handle)


def _windows_assign_kill_job(process):
    """suspended worker를 kill-on-close Job Object에 넣고 재개한다."""
    import ctypes
    from ctypes import wintypes

    class BasicLimitInformation(ctypes.Structure):
        _fields_ = [
            ("PerProcessUserTimeLimit", ctypes.c_longlong),
            ("PerJobUserTimeLimit", ctypes.c_longlong),
            ("LimitFlags", wintypes.DWORD),
            ("MinimumWorkingSetSize", ctypes.c_size_t),
            ("MaximumWorkingSetSize", ctypes.c_size_t),
            ("ActiveProcessLimit", wintypes.DWORD),
            ("Affinity", ctypes.c_size_t),
            ("PriorityClass", wintypes.DWORD),
            ("SchedulingClass", wintypes.DWORD),
        ]

    class IoCounters(ctypes.Structure):
        _fields_ = [
            ("ReadOperationCount", ctypes.c_ulonglong),
            ("WriteOperationCount", ctypes.c_ulonglong),
            ("OtherOperationCount", ctypes.c_ulonglong),
            ("ReadTransferCount", ctypes.c_ulonglong),
            ("WriteTransferCount", ctypes.c_ulonglong),
            ("OtherTransferCount", ctypes.c_ulonglong),
        ]

    class ExtendedLimitInformation(ctypes.Structure):
        _fields_ = [
            ("BasicLimitInformation", BasicLimitInformation),
            ("IoInfo", IoCounters),
            ("ProcessMemoryLimit", ctypes.c_size_t),
            ("JobMemoryLimit", ctypes.c_size_t),
            ("PeakProcessMemoryUsed", ctypes.c_size_t),
            ("PeakJobMemoryUsed", ctypes.c_size_t),
        ]

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    create_job = kernel32.CreateJobObjectW
    create_job.argtypes = (ctypes.c_void_p, wintypes.LPCWSTR)
    create_job.restype = wintypes.HANDLE
    set_information = kernel32.SetInformationJobObject
    set_information.argtypes = (
        wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD)
    set_information.restype = wintypes.BOOL
    assign = kernel32.AssignProcessToJobObject
    assign.argtypes = (wintypes.HANDLE, wintypes.HANDLE)
    assign.restype = wintypes.BOOL
    close_handle = kernel32.CloseHandle
    close_handle.argtypes = (wintypes.HANDLE,)
    close_handle.restype = wintypes.BOOL

    job = create_job(None, None)
    if not job:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        limits = ExtendedLimitInformation()
        limits.BasicLimitInformation.LimitFlags = 0x00002000
        if not set_information(
                job, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
            raise ctypes.WinError(ctypes.get_last_error())
        if not assign(job, wintypes.HANDLE(process._handle)):
            raise ctypes.WinError(ctypes.get_last_error())

        ntdll = ctypes.WinDLL("ntdll")
        resume = ntdll.NtResumeProcess
        resume.argtypes = (wintypes.HANDLE,)
        resume.restype = wintypes.LONG
        status = resume(wintypes.HANDLE(process._handle))
        if status != 0:
            raise OSError(f"NtResumeProcess 실패: 0x{status & 0xffffffff:08x}")
    except Exception:
        close_handle(job)
        raise
    return job


def _windows_close_job(job):
    if not job:
        return
    import ctypes
    from ctypes import wintypes

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    close_handle = kernel32.CloseHandle
    close_handle.argtypes = (wintypes.HANDLE,)
    close_handle.restype = wintypes.BOOL
    close_handle(job)


def _terminate_process_tree(process):
    """시간 초과 worker와 Playwright driver 하위 프로세스를 함께 종료한다."""
    if os.name == "nt":
        descendants = _windows_descendant_pids(process.pid)
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)
        try:
            killed = subprocess.run(
                ["taskkill.exe", "/PID", str(process.pid), "/T", "/F"],
                shell=False, stdin=subprocess.DEVNULL, capture_output=True,
                creationflags=flags, timeout=2)
            if killed.returncode:
                process.kill()
        except (OSError, subprocess.TimeoutExpired):
            process.kill()
        for pid in reversed(descendants):
            _windows_force_terminate(pid)
        return
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except (OSError, ProcessLookupError):
        try:
            process.kill()
        except OSError:
            pass


def _default_runner(argv, *, cwd, timeout):
    options = {
        "cwd": cwd,
        "shell": False,
        "stdin": subprocess.DEVNULL,
        "stdout": subprocess.PIPE,
        "stderr": subprocess.PIPE,
        "text": True,
        "encoding": "utf-8",
        "errors": "replace",
        "close_fds": True,
    }
    if os.name == "nt":
        no_window = getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)
        new_group = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0x00000200)
        create_suspended = getattr(subprocess, "CREATE_SUSPENDED", 0x00000004)
        options["creationflags"] = no_window | new_group | create_suspended
    else:
        options["start_new_session"] = True
    process = subprocess.Popen(list(argv), **options)
    windows_job = None
    job_lock = threading.Lock()

    def close_windows_job():
        nonlocal windows_job
        with job_lock:
            if windows_job is not None:
                _windows_close_job(windows_job)
                windows_job = None

    if os.name == "nt":
        try:
            windows_job = _windows_assign_kill_job(process)
        except Exception:
            try:
                process.kill()
                process.wait(timeout=1)
            except (OSError, subprocess.TimeoutExpired):
                pass
            raise
        if hasattr(process, "_handle"):
            def close_job_when_worker_exits():
                try:
                    process.wait()
                except Exception:
                    return
                close_windows_job()

            threading.Thread(
                target=close_job_when_worker_exits,
                name="playwright-copy-job-watch", daemon=True).start()
    try:
        try:
            stdout, stderr = process.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            if windows_job is not None:
                close_windows_job()
            else:
                _terminate_process_tree(process)
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                try:
                    process.wait(timeout=1)
                except subprocess.TimeoutExpired:
                    pass
            for stream in (process.stdout, process.stderr):
                if stream is not None:
                    stream.close()
            raise
    finally:
        close_windows_job()
    if process.returncode and os.name != "nt":
        _terminate_process_tree(process)
    return subprocess.CompletedProcess(
        list(argv), process.returncode, stdout, stderr)


def _try_file_lock(handle):
    if os.name == "nt":
        import msvcrt
        handle.seek(0, os.SEEK_END)
        if handle.tell() == 0:
            handle.write(b"\0")
            handle.flush()
        handle.seek(0)
        try:
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError:
            return False
        return True

    import fcntl
    try:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except (OSError, BlockingIOError):
        return False
    return True


def _unlock_file(handle):
    if os.name == "nt":
        import msvcrt
        handle.seek(0)
        msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
        return
    import fcntl
    fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


@contextmanager
def _edge_lock(deadline):
    remaining = max(0.0, deadline - time.monotonic())
    if not _EDGE_THREAD_LOCK.acquire(timeout=remaining):
        raise PlaywrightCopyError("Edge 자동 복사 대기 시간이 초과되었습니다")
    handle = None
    locked = False
    try:
        path = os.path.join(
            tempfile.gettempdir(), "ops-runtime-playwright-msedge.lock")
        handle = open(path, "a+b")
        while not _try_file_lock(handle):
            if time.monotonic() >= deadline:
                raise PlaywrightCopyError("Edge 자동 복사 대기 시간이 초과되었습니다")
            time.sleep(min(_LOCK_POLL_SECONDS, max(
                0.0, deadline - time.monotonic())))
        locked = True
        yield
    finally:
        if locked:
            _unlock_file(handle)
        if handle is not None:
            handle.close()
        _EDGE_THREAD_LOCK.release()


def _remaining(deadline):
    value = deadline - time.monotonic()
    if value <= 0:
        raise PlaywrightCopyError("Playwright 자동 복사 시간이 초과되었습니다")
    return value


def _remaining_milliseconds(deadline_ms):
    value = int(deadline_ms - time.time() * 1000)
    if value <= 0:
        raise PlaywrightCopyError("Playwright 자동 복사 시간이 초과되었습니다")
    return value


def _short_error(value):
    return str(value or "").strip()[:1000]


def _edge_endpoint():
    local_app_data = os.environ.get("LOCALAPPDATA")
    if not local_app_data:
        raise PlaywrightCopyError("LOCALAPPDATA 환경 변수가 없습니다")
    active_port_path = os.path.join(
        local_app_data, "Microsoft", "Edge", "User Data",
        "DevToolsActivePort")
    try:
        with open(active_port_path, encoding="utf-8") as handle:
            first_line = handle.readline().strip()
        port = int(first_line)
    except (OSError, TypeError, ValueError) as exc:
        raise PlaywrightCopyError(
            "Edge DevToolsActivePort를 읽을 수 없습니다") from exc
    if not 1 <= port <= 65535:
        raise PlaywrightCopyError("Edge DevToolsActivePort가 올바르지 않습니다")
    return f"http://127.0.0.1:{port}"


def _devtools_json(endpoint, path, *, timeout):
    parsed = urllib_parse.urlsplit(endpoint)
    if (parsed.scheme != "http" or parsed.hostname not in (
            "127.0.0.1", "localhost", "::1") or not parsed.port):
        raise PlaywrightCopyError("Edge DevTools endpoint가 올바르지 않습니다")
    request = urllib_request.Request(endpoint.rstrip("/") + path)
    try:
        with urllib_request.urlopen(request, timeout=max(0.001, timeout)) as response:
            raw = response.read(1024 * 1024 + 1)
    except urllib_error.HTTPError as exc:
        if exc.code == 404:
            return None
        raise PlaywrightCopyError("Edge DevTools HTTP 요청에 실패했습니다") from exc
    except OSError as exc:
        raise PlaywrightCopyError("Edge DevTools HTTP 요청에 실패했습니다") from exc
    if len(raw) > 1024 * 1024:
        raise PlaywrightCopyError("Edge DevTools 응답이 너무 큽니다")
    try:
        return json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise PlaywrightCopyError("Edge DevTools 응답이 올바르지 않습니다") from exc


def _write_ownership(path, value):
    temp_path = path + ".tmp"
    with open(temp_path, "w", encoding="utf-8") as handle:
        json.dump(value, handle, ensure_ascii=False)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temp_path, path)


def _create_owned_target(cdp_session, ownership_path, ownership):
    target = cdp_session.send("Target.createTarget", {
        "url": ownership["marker_url"],
        "background": True,
    })
    target_id = str((target or {}).get("targetId") or "").strip()
    if not target_id:
        raise PlaywrightCopyError("Edge 자동화 target을 만들 수 없습니다")
    ownership["target_id"] = target_id
    _write_ownership(ownership_path, ownership)
    return target_id


def _load_ownership(path):
    try:
        with open(path, encoding="utf-8") as handle:
            value = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(value, dict):
        return None
    return value


def _close_devtools_target(endpoint, target_id, timeout):
    path = "/json/close/" + urllib_parse.quote(target_id, safe="")
    # 이미 page.close로 사라진 target의 404도 정리 완료다.
    _devtools_json(endpoint, path, timeout=timeout)
    return True


def _cleanup_owned_target(ownership_path, *, timeout):
    """소유권 파일이 가리키는 자동화 target만 닫는다."""
    ownership = _load_ownership(ownership_path)
    if ownership is None:
        return True
    endpoint = str(ownership.get("endpoint") or "")
    marker_url = str(ownership.get("marker_url") or "")
    target_id = str(ownership.get("target_id") or "")
    started = time.monotonic()

    try:
        if target_id:
            _close_devtools_target(endpoint, target_id, timeout)
        else:
            targets = _devtools_json(
                endpoint, "/json/list", timeout=timeout)
            for target in (targets if isinstance(targets, list) else ()):
                if (isinstance(target, dict)
                        and target.get("type") == "page"
                        and target.get("url") == marker_url):
                    remaining = timeout - (time.monotonic() - started)
                    if remaining <= 0:
                        return False
                    exact_id = str(target.get("id") or "")
                    if exact_id:
                        _close_devtools_target(endpoint, exact_id, remaining)
    except PlaywrightCopyError:
        return False
    try:
        os.unlink(ownership_path)
    except FileNotFoundError:
        pass
    except OSError:
        return False
    return True


def _find_marker_page(context, marker_url, work_deadline_ms):
    while True:
        page = next(
            (candidate for candidate in context.pages
             if candidate.url == marker_url), None)
        if page is not None:
            return page
        remaining_ms = _remaining_milliseconds(work_deadline_ms)
        time.sleep(min(0.05, remaining_ms / 1000.0))


def _capture_with_playwright(url, work_deadline_ms, cleanup_deadline_ms,
                             playwright_factory, ownership_path):
    """Playwright 전용 스레드에서 snapshot 작업을 수행한다."""
    if playwright_factory is None:
        try:
            from playwright.sync_api import sync_playwright
        except ImportError as exc:
            raise PlaywrightCopyError(
                "Python playwright 패키지를 불러올 수 없습니다") from exc
        playwright_factory = sync_playwright

    endpoint = _edge_endpoint()
    marker_url = (
        "about:blank#ops-runtime-playwright-copy-" + uuid.uuid4().hex)
    ownership = {
        "endpoint": endpoint,
        "marker_url": marker_url,
        "target_id": None,
    }
    _write_ownership(ownership_path, ownership)

    page = None
    page_closed = False
    try:
        with playwright_factory() as playwright:
            browser = playwright.chromium.connect_over_cdp(
                endpoint, timeout=_remaining_milliseconds(work_deadline_ms),
                no_defaults=True)
            if not browser.contexts:
                raise PlaywrightCopyError("Edge 브라우저 context를 찾을 수 없습니다")
            context = browser.contexts[0]
            context.set_default_timeout(
                _remaining_milliseconds(work_deadline_ms))
            cdp_session = browser.new_browser_cdp_session()
            _create_owned_target(cdp_session, ownership_path, ownership)
            page = _find_marker_page(
                context, marker_url, work_deadline_ms)
            page.goto(
                url, wait_until="domcontentloaded",
                timeout=_remaining_milliseconds(work_deadline_ms))
            snapshot = page.locator("body").aria_snapshot(
                timeout=_remaining_milliseconds(work_deadline_ms))
    finally:
        if page is not None:
            try:
                page.close()
                page_closed = True
            except Exception:
                pass
        if ownership_path:
            if page_closed:
                try:
                    os.unlink(ownership_path)
                except FileNotFoundError:
                    pass
                except OSError:
                    page_closed = False
            if not page_closed:
                remaining = max(
                    0.001,
                    (cleanup_deadline_ms - time.time() * 1000) / 1000.0)
                _cleanup_owned_target(ownership_path, timeout=remaining)
    if not isinstance(snapshot, str):
        raise PlaywrightCopyError("Playwright snapshot 결과가 텍스트가 아닙니다")
    return snapshot


def _capture_in_process(url, work_deadline_ms, *, cleanup_deadline_ms=None,
                        playwright_factory=None, ownership_path=None):
    """cleanup deadline을 지키며 현재 worker에서 Playwright를 실행한다.

    Python Playwright sync API는 생성한 스레드에서 계속 사용해야 한다. 따라서
    Playwright의 시작부터 종료까지 한 daemon 스레드에 두고, worker 주 스레드는
    cleanup deadline까지만 기다린다. Playwright 연결이 멈추더라도 부모가
    소유권 파일의 정확한 target ID를 사용해 자동화 page만 닫을 수 있다.
    """
    work_deadline_ms = int(work_deadline_ms)
    if cleanup_deadline_ms is None:
        cleanup_deadline_ms = work_deadline_ms + _WORKER_CLEANUP_GRACE_MS
    cleanup_deadline_ms = int(cleanup_deadline_ms)
    if cleanup_deadline_ms <= work_deadline_ms:
        raise PlaywrightCopyError("Playwright cleanup 제한 시간이 올바르지 않습니다")

    done = threading.Event()
    result = {}

    def run():
        try:
            result["snapshot"] = _capture_with_playwright(
                url, work_deadline_ms, cleanup_deadline_ms,
                playwright_factory, ownership_path)
        except BaseException as exc:  # worker 경계에서 원래 오류를 전달한다.
            result["error"] = exc
        finally:
            done.set()

    thread = threading.Thread(
        target=run, name="playwright-copy-worker", daemon=True)
    thread.start()
    cleanup_seconds = max(
        0.0, (cleanup_deadline_ms - time.time() * 1000) / 1000.0)
    if not done.wait(cleanup_seconds):
        raise PlaywrightCopyError(
            "Playwright 페이지 생성 정리 시간이 초과되었습니다")
    if "error" in result:
        raise result["error"]
    return result["snapshot"]


def _write_snapshot(path, value):
    raw = value.encode("utf-8")
    if len(raw) > MAX_SNAPSHOT_BYTES:
        raise PlaywrightCopyError("Playwright snapshot 결과가 1MB를 초과했습니다")
    if not value.strip():
        raise PlaywrightCopyError("Playwright snapshot 결과가 비어 있습니다")
    with open(path, "wb") as handle:
        handle.write(raw)


def _write_url_input(path, url):
    raw = url.encode("utf-8")
    if len(raw) > MAX_URL_BYTES:
        raise PlaywrightCopyError("자동 복사 URL이 너무 깁니다")
    with open(path, "wb") as handle:
        handle.write(raw)
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


def _read_url_input(path):
    try:
        with open(path, "rb") as handle:
            raw = handle.read(MAX_URL_BYTES + 1)
    except OSError as exc:
        raise PlaywrightCopyError("자동 복사 URL 입력을 읽을 수 없습니다") from exc
    if len(raw) > MAX_URL_BYTES:
        raise PlaywrightCopyError("자동 복사 URL이 너무 깁니다")
    try:
        url = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise PlaywrightCopyError("자동 복사 URL이 UTF-8이 아닙니다") from exc
    if not url.strip():
        raise PlaywrightCopyError("자동 복사 URL이 비어 있습니다")
    return url


def _read_snapshot(path):
    try:
        with open(path, "rb") as handle:
            raw = handle.read(MAX_SNAPSHOT_BYTES + 1)
    except OSError as exc:
        raise PlaywrightCopyError(
            f"Playwright snapshot 결과를 읽을 수 없습니다: {_short_error(exc)}") from exc
    if len(raw) > MAX_SNAPSHOT_BYTES:
        raise PlaywrightCopyError("Playwright snapshot 결과가 1MB를 초과했습니다")
    try:
        value = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise PlaywrightCopyError(
            "Playwright snapshot 결과가 UTF-8 텍스트가 아닙니다") from exc
    if not value.strip():
        raise PlaywrightCopyError("Playwright snapshot 결과가 비어 있습니다")
    return value


def capture_snapshot(url, *, runner=None, worker_command=None,
                     timeout=DEFAULT_TIMEOUT_SECONDS):
    """실행 중 Edge의 SSO 세션으로 ``url``을 조회해 snapshot 텍스트를 반환한다.

    Python worker를 사용해 브라우저 자동화를 Dashboard 프로세스와 격리한다.
    실패 시 :class:`PlaywrightCopyError`를 발생시킨다.
    """
    if not isinstance(url, str) or not url.strip():
        raise PlaywrightCopyError("자동 복사 URL이 비어 있습니다")
    try:
        timeout = float(timeout)
    except (TypeError, ValueError) as exc:
        raise PlaywrightCopyError("자동 복사 제한 시간이 올바르지 않습니다") from exc
    if timeout <= 0:
        raise PlaywrightCopyError("자동 복사 제한 시간은 0보다 커야 합니다")

    runner = runner or _default_runner
    prefix = tuple(worker_command or _default_worker_command())
    if not prefix:
        raise PlaywrightCopyError("Playwright Python worker 명령이 비어 있습니다")
    deadline = time.monotonic() + timeout

    with _edge_lock(deadline), tempfile.TemporaryDirectory(
            prefix="ops-playwright-copy-") as temp_dir:
        snapshot_path = os.path.join(temp_dir, "snapshot.yml")
        url_input_path = os.path.join(temp_dir, "url-input.txt")
        ownership_path = os.path.join(temp_dir, "ownership.json")
        _write_url_input(url_input_path, url)
        total_ms = max(1, int(_remaining(deadline) * 1000))
        if total_ms < 2:
            raise PlaywrightCopyError("Playwright 자동 복사 시간이 초과되었습니다")
        cleanup_ms = min(
            _WORKER_CLEANUP_GRACE_MS, max(1, total_ms // 10))
        work_deadline_ms = int(
            (time.time() + (total_ms - cleanup_ms) / 1000.0) * 1000)
        parent_cleanup_ms = max(1, cleanup_ms // 2)
        cleanup_deadline_ms = work_deadline_ms + cleanup_ms - parent_cleanup_ms
        argv = prefix + (
            url_input_path, snapshot_path, str(work_deadline_ms),
            str(cleanup_deadline_ms), ownership_path)
        failure = None
        completed = None
        try:
            completed = runner(
                argv, cwd=temp_dir,
                timeout=max(
                    0.001,
                    (cleanup_deadline_ms - time.time() * 1000) / 1000.0))
        except subprocess.TimeoutExpired as exc:
            failure = (
                PlaywrightCopyError(
                    "Playwright Python worker 시간이 초과되었습니다"),
                exc)
        except OSError as exc:
            failure = (
                PlaywrightCopyError(
                    f"Playwright Python worker를 실행할 수 없습니다: "
                    f"{_short_error(exc)}"),
                exc)
        cleanup_ok = _cleanup_owned_target(
            ownership_path,
            timeout=max(0.1, deadline - time.monotonic()))
        if failure is not None:
            raise failure[0] from failure[1]
        if completed is not None and completed.returncode:
            raise PlaywrightCopyError("Playwright Python snapshot 작업에 실패했습니다")
        if not cleanup_ok:
            raise PlaywrightCopyError("Playwright 자동화 target 정리에 실패했습니다")
        return _read_snapshot(snapshot_path)


def _worker_main(argv):
    if len(argv) != 5:
        return 1
    (url_input_path, snapshot_path, work_deadline_value, cleanup_deadline_value,
     ownership_path) = argv
    try:
        url = _read_url_input(url_input_path)
        work_deadline_ms = int(work_deadline_value)
        cleanup_deadline_ms = int(cleanup_deadline_value)
        if work_deadline_ms <= 0 or cleanup_deadline_ms <= work_deadline_ms:
            return 1
        snapshot = _capture_in_process(
            url, work_deadline_ms,
            cleanup_deadline_ms=cleanup_deadline_ms,
            ownership_path=ownership_path)
        _write_snapshot(snapshot_path, snapshot)
    except Exception:
        # URL, 쿠키, 페이지 내용 등 회사 시스템 정보를 로그에 남기지 않는다.
        return 1
    return 0


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "--worker":
        raise SystemExit(_worker_main(sys.argv[2:]))
    raise SystemExit(2)
