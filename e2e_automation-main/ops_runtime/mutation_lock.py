# -*- coding: utf-8 -*-
"""프로젝트 상태 변경을 직렬화하는 운영체제 수준 파일 락.

서비스 계층과 직접 CLI는 같은 락을 사용한다. 락 파일의 존재가 아니라 파일
디스크립터에 대한 OS 락을 사용하므로 프로세스가 비정상 종료되어도 락이 남지 않는다.
같은 스레드에서 Controller -> 기존 런타임 API로 중첩 호출하는 경우에는 재진입한다.
"""
from contextlib import contextmanager
from functools import wraps
import hashlib
import json
import os
import re
import threading


class MutationBusy(RuntimeError):
    """다른 프로세스가 현재 프로젝트 상태를 변경 중이다."""


_LOCAL = threading.local()


def _held():
    if not hasattr(_LOCAL, "held"):
        _LOCAL.held = {}
    return _LOCAL.held


def _project_root(path):
    """path에서 ops_runtime 폴더가 있는 프로젝트 루트를 찾는다."""
    start = os.path.dirname(os.path.abspath(path)) if path else os.getcwd()
    here = start
    while True:
        if os.path.isdir(os.path.join(here, "ops_runtime")):
            return here
        parent = os.path.dirname(here)
        if parent == here:
            return start
        here = parent


def _try_lock(handle, blocking):
    if os.name == "nt":
        import msvcrt
        handle.seek(0, os.SEEK_END)
        if handle.tell() == 0:
            handle.write(b"\0")
            handle.flush()
        handle.seek(0)
        mode = msvcrt.LK_LOCK if blocking else msvcrt.LK_NBLCK
        try:
            msvcrt.locking(handle.fileno(), mode, 1)
        except OSError as exc:
            raise MutationBusy("다른 프로세스가 프로젝트 상태를 변경 중입니다") from exc
        return

    import fcntl
    mode = fcntl.LOCK_EX | (0 if blocking else fcntl.LOCK_NB)
    try:
        fcntl.flock(handle.fileno(), mode)
    except (OSError, BlockingIOError) as exc:
        raise MutationBusy("다른 프로세스가 프로젝트 상태를 변경 중입니다") from exc


def _unlock(handle):
    if os.name == "nt":
        import msvcrt
        handle.seek(0)
        msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
        return
    import fcntl
    fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


@contextmanager
def project_mutation_lock(project_root, blocking=False):
    """프로젝트의 단일 변경 락을 획득한다.

    ``blocking=False``가 기본이다. 서버 실행과 직접 CLI가 우연히 동시에 상태를
    바꾸는 경우 한쪽을 기다리게 두지 않고 즉시 알린다.
    """
    root = os.path.realpath(os.path.abspath(project_root))
    lock_path = os.path.join(root, ".ops", "controller", "mutation.lock")
    key = os.path.normcase(lock_path)
    held = _held()
    if key in held:
        held[key]["depth"] += 1
        try:
            yield
        finally:
            held[key]["depth"] -= 1
        return

    os.makedirs(os.path.dirname(lock_path), exist_ok=True)
    handle = open(lock_path, "a+b")
    try:
        _try_lock(handle, blocking)
        held[key] = {"handle": handle, "depth": 1}
        try:
            yield
        finally:
            held.pop(key, None)
            _unlock(handle)
    finally:
        handle.close()


def _resource_lock_path(project_root, scope, identity):
    """Return a stable lock path without exposing user-controlled identifiers."""
    root = os.path.realpath(os.path.abspath(project_root))
    normalized_scope = re.sub(r"[^a-z0-9_-]+", "-", str(scope).lower()).strip("-")
    normalized_scope = normalized_scope or "resource"
    material = os.path.normcase(str(identity or normalized_scope)).encode(
        "utf-8", errors="surrogatepass")
    digest = hashlib.sha256(material).hexdigest()[:32]
    return os.path.join(
        root, ".ops", "controller", "locks",
        f"{normalized_scope}-{digest}.lock")


@contextmanager
def resource_mutation_lock(project_root, scope, identity, blocking=False):
    """Serialize only mutations that target the same logical resource.

    Lock-file existence has no meaning. The operating-system byte-range lock is
    released when the owning handle/process exits, so a leftover file is never
    treated as a stale owner.
    """
    lock_path = _resource_lock_path(project_root, scope, identity)
    key = os.path.normcase(lock_path)
    held = _held()
    if key in held:
        held[key]["depth"] += 1
        try:
            yield
        finally:
            held[key]["depth"] -= 1
        return

    os.makedirs(os.path.dirname(lock_path), exist_ok=True)
    handle = open(lock_path, "a+b")
    try:
        _try_lock(handle, blocking)
        held[key] = {"handle": handle, "depth": 1}
        try:
            yield
        finally:
            held.pop(key, None)
            _unlock(handle)
    finally:
        handle.close()


@contextmanager
def multi_resource_mutation_lock(project_root, resources, blocking=False):
    """Acquire resource locks in canonical order to avoid lock-order cycles."""
    ordered = sorted(
        {(str(scope), str(identity)) for scope, identity in resources},
        key=lambda item: os.path.normcase(
            _resource_lock_path(project_root, item[0], item[1])),
    )

    @contextmanager
    def acquire(index):
        if index >= len(ordered):
            yield
            return
        scope, identity = ordered[index]
        with resource_mutation_lock(
                project_root, scope, identity, blocking=blocking):
            with acquire(index + 1):
                yield

    with acquire(0):
        yield


def serialized_path_mutation(path_arg=0, path_kw=None):
    """파일 경로 인자를 기준으로 기존 공개 mutation API를 락으로 감싼다."""
    def decorate(func):
        @wraps(func)
        def wrapped(*args, **kwargs):
            path = kwargs.get(path_kw) if path_kw else None
            if path is None and len(args) > path_arg:
                path = args[path_arg]
            root = _project_root(path)
            identity = os.path.realpath(os.path.abspath(path or root))
            try:
                with resource_mutation_lock(
                        root, "path", identity, blocking=False):
                    return func(*args, **kwargs)
            except MutationBusy as exc:
                return {
                    "status": "busy",
                    "reason_code": "resource_mutation_busy",
                    "reason": str(exc),
                    "retryable": True,
                }
        return wrapped
    return decorate


def serialized_keyed_path_mutation(path_arg=0, key_arg=1,
                                   path_kw=None, key_kw=None):
    """Serialize one logical run, while allowing other keys of a Task in parallel."""
    def decorate(func):
        @wraps(func)
        def wrapped(*args, **kwargs):
            path = kwargs.get(path_kw) if path_kw else None
            key_value = kwargs.get(key_kw) if key_kw else None
            if path is None and len(args) > path_arg:
                path = args[path_arg]
            if key_value is None and len(args) > key_arg:
                key_value = args[key_arg]
            root = _project_root(path)
            identity = (
                os.path.normcase(os.path.realpath(os.path.abspath(path or root)))
                + "\0" + str(key_value or "default")
            )
            try:
                task_identity = os.path.normcase(
                    os.path.realpath(os.path.abspath(path or root)))
                with multi_resource_mutation_lock(
                        root,
                        (("task-run", task_identity), ("run", identity)),
                        blocking=False):
                    return func(*args, **kwargs)
            except MutationBusy as exc:
                return {
                    "status": "busy",
                    "reason_code": "resource_mutation_busy",
                    "reason": str(exc),
                    "retryable": True,
                }
        return wrapped
    return decorate


def serialized_run_mutation(path_arg=0, path_kw=None):
    """Serialize a run mutation with the same identity used by ``start``."""
    def decorate(func):
        @wraps(func)
        def wrapped(*args, **kwargs):
            run_path = kwargs.get(path_kw) if path_kw else None
            if run_path is None and len(args) > path_arg:
                run_path = args[path_arg]
            try:
                with open(run_path, encoding="utf-8") as handle:
                    run = json.load(handle)
                task_path = run.get("task_ref")
                if not os.path.isabs(task_path):
                    task_path = os.path.join(_project_root(run_path), task_path)
                root = _project_root(task_path)
                identity = (
                    os.path.normcase(
                        os.path.realpath(os.path.abspath(task_path or root)))
                    + "\0" + str(run.get("key") or "default")
                )
                task_identity = os.path.normcase(
                    os.path.realpath(os.path.abspath(task_path or root)))
                with multi_resource_mutation_lock(
                        root,
                        (("task-run", task_identity), ("run", identity)),
                        blocking=False):
                    return func(*args, **kwargs)
            except MutationBusy as exc:
                return {
                    "status": "busy",
                    "reason_code": "resource_mutation_busy",
                    "reason": str(exc),
                    "retryable": True,
                }
        return wrapped
    return decorate
