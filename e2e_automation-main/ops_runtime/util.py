# -*- coding: utf-8 -*-
"""공용 유틸 — 원자적 저장, JSON 입출력, 제한 JSONPath 해석."""
import json
import os
import re
import sys
import tempfile
import time


def utf8_stdout():
    """Windows cp949 콘솔 오류를 방지한다."""
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass


def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def atomic_write_json(path, data):
    """같은 디렉터리에 임시 파일을 쓰고 os.replace — 진행상태 파일은 항상 원자적.

    Windows에서 AV/인덱서가 파일을 잠깐 잠가 os.replace가 PermissionError로 죽는
    일이 실측 3회 있었다 — 짧은 백오프로 재시도한다.
    """
    d = os.path.dirname(os.path.abspath(path))
    os.makedirs(d, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=d, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        for attempt in range(5):
            try:
                os.replace(tmp, path)
                return
            except PermissionError:
                time.sleep(0.1 * (attempt + 1))
        os.replace(tmp, path)  # 마지막 시도 — 그래도 실패면 예외 전파
    except Exception:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise


def atomic_write_text(path, text):
    """UTF-8 텍스트를 같은 디렉터리의 임시 파일을 거쳐 원자적으로 저장한다."""
    d = os.path.dirname(os.path.abspath(path))
    os.makedirs(d, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=d, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
            f.write(str(text))
        for attempt in range(5):
            try:
                os.replace(tmp, path)
                return
            except PermissionError:
                time.sleep(0.1 * (attempt + 1))
        os.replace(tmp, path)
    except Exception:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise


def latest(run, node_id):
    """진행상태에서 노드의 최신 이력 항목. 없으면 None."""
    hist = run.get("nodes", {}).get(node_id, {}).get("history", [])
    return hist[-1] if hist else None


def normalize_named_placeholders(value, names):
    """기존 ``{{이름}}`` 표기를 런타임의 ``{이름}`` 표기로 맞춘다.

    알려진 입력 이름만 바꾸므로 일반 문장의 중괄호나 알 수 없는 참조를 조용히
    유효한 값으로 만들지 않는다. 이중 중괄호를 안내하던 예전 Creator 산출물을
    계속 실행하기 위한 호환 처리다.
    """
    text = str(value or "")
    known = sorted(
        {str(name) for name in names if isinstance(name, str) and name},
        key=len,
        reverse=True,
    )
    for name in known:
        text = text.replace("{{" + name + "}}", "{" + name + "}")
    return text


def named_placeholder_refs(value):
    """문자열에서 ``{이름}`` 참조 이름을 순서대로 반환한다."""
    return re.findall(r"\{([^{}]+)\}", str(value or ""))


def dig_found(obj, dotted):
    """점 표기 경로를 해석하되 값이 없는 경우와 null인 경우를 구분한다."""
    cur = obj
    for part in dotted.split("."):
        if isinstance(cur, dict) and part in cur:
            cur = cur[part]
        elif isinstance(cur, list) and part.isdigit():
            index = int(part)
            if index >= len(cur):
                return False, None
            cur = cur[index]
        else:
            return False, None
    return True, cur


def dig(obj, dotted):
    """점 표기 경로로 객체를 파고든다. 실패 시 None."""
    found, value = dig_found(obj, dotted)
    return value if found else None


def resolve_source(source, run):
    """task JSON의 inputs[].source 해석 (제한 문법).

    - $.nodes.<id>.output.<field>   → 같은 task 안 노드의 최신 출력
    - $.inputs_from.<name>          → task 밖 입력 (run["inputs_from"] 캐시)
    - $.key                         → 이 건의 식별자(건ID) — 티켓 키를 다시 묻지 않기 위함
    반환: (ok: bool, value)
    """
    if not isinstance(source, str) or not source.startswith("$."):
        return False, None
    parts = source[2:].split(".")
    if parts == ["key"]:
        return ("key" in run), run.get("key")
    if parts[0] == "nodes" and len(parts) >= 4 and parts[2] == "output":
        entry = latest(run, parts[1])
        if entry is None:
            return False, None
        field = ".".join(parts[3:])
        out = entry.get("output", {})
        if field in out:
            return True, out[field]
        return False, None
    if parts[0] == "inputs_from" and len(parts) >= 2:
        name = ".".join(parts[1:])
        cache = run.get("inputs_from", {})
        if name in cache:
            return True, cache[name]
        return False, None
    return False, None


def resolve_response_field(path, body):
    """integration.response_fields 값 해석: $.body.<dotted> → 응답 JSON에서 추출."""
    found, value = resolve_response_field_found(path, body)
    return value if found else None


def resolve_response_field_found(path, body):
    """API 응답 경로를 해석해 ``(존재 여부, 값)``을 반환한다."""
    if not isinstance(path, str) or (
            path != "$.body" and not path.startswith("$.body.")):
        return False, None
    rest = path[len("$.body"):].lstrip(".")
    if not rest:
        return True, body
    return dig_found(body, rest)


def file_sha256(path):
    """파일 원본 바이트의 SHA-256 해시를 반환한다."""
    import hashlib
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalized_bytes_sha256(raw):
    """줄바꿈 형식의 영향을 받지 않는 바이트 데이터의 SHA-256 해시를 반환한다.

    이미 읽어 둔 바이트로 해시할 수 있어야, 해시와 파싱이 서로 다른 시점의
    파일 내용을 보는 일을 막을 수 있다 (yaml_to_task._load).
    """
    import hashlib
    normalized = raw.replace(b"\r\n", b"\n").replace(b"\r", b"\n")
    return hashlib.sha256(normalized).hexdigest()


def normalized_text_sha256(path):
    """원본 파일을 바꾸지 않고 줄바꿈 형식에 무관한 SHA-256 해시를 반환한다."""
    with open(path, "rb") as stream:
        raw = stream.read()
    return normalized_bytes_sha256(raw)


def source_yaml_hashes(path):
    """YAML 원본에 허용되는 기존 방식과 정규화 방식의 해시를 모두 반환한다."""
    import hashlib
    with open(path, "rb") as stream:
        raw = stream.read()
    lf = raw.replace(b"\r\n", b"\n").replace(b"\r", b"\n")
    crlf = lf.replace(b"\n", b"\r\n")
    return {
        hashlib.sha256(raw).hexdigest(),
        hashlib.sha256(lf).hexdigest(),
        hashlib.sha256(crlf).hexdigest(),
    }
