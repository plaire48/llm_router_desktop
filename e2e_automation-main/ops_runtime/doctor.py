# -*- coding: utf-8 -*-
"""환경 사전 점검 — 배포 직후 읽기 전용 자가 진단.

ops_runtime+스킬을 타 프로젝트 PC로 복사 배포하는 실사용 패턴(sipms/ipms)에서,
실행 도중에야 터지던 환경 문제(pyyaml 부재·플랫폼별 스킬 배치 어긋남·경로 부재·
secret 미등록)를 미리 잡는다. **읽기 전용** – 아무것도 수정하지 않는다.

CLI (AI 에이전트가 실행):
  python ops_runtime/doctor.py                # 리포 루트 기준 전체 점검
"""
import argparse
import glob
import hashlib
import importlib.metadata
import json
import os
import sys

if __package__ in (None, ""):
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from ops_runtime import util, workspace
else:
    from . import util, workspace

PENDING = "__미정__"
SKILLS = ("e2e-agent-creator", "e2e-agent-validator", "e2e-agent-runner")
SKILL_ROOTS = (".aipro", ".claude", ".agents")
PLAYWRIGHT_VERSION = "1.60.0"
PLAYWRIGHT_REQUIREMENT = f"playwright=={PLAYWRIGHT_VERSION}"


def _check(name, ok, detail, level="error"):
    return {"check": name, "ok": bool(ok), "detail": detail,
            "level": "ok" if ok else level}


def _read(path):
    try:
        with open(path, encoding="utf-8") as f:
            return f.read()
    except OSError:
        return None


def _python_version():
    v = sys.version_info
    ok = (v.major, v.minor) >= (3, 9)
    return _check("python_version", ok,
                  f"Python {v.major}.{v.minor}.{v.micro}"
                  + ("" if ok else " – 3.9 이상이 필요합니다"))


def _pyyaml():
    try:
        import yaml  # noqa: F401
        return _check("pyyaml", True, "pyyaml 설치됨 (yaml_to_task 변환 가능)")
    except ImportError:
        return _check("pyyaml", False,
                      "pyyaml이 없습니다 – yaml_to_task.py(--list/--task)가 실패합니다. "
                      "pip install pyyaml 후 다시 점검하세요. (질문지·검증·실행은 영향 없음)",
                      level="warn")


def _playwright():
    """snapshot worker와 같은 현재 Python의 Playwright 고정 버전을 확인한다."""
    executable = sys.executable
    try:
        installed = importlib.metadata.version("playwright")
    except importlib.metadata.PackageNotFoundError:
        return _check(
            "playwright", False,
            f"현재 Python(sys.executable={executable})에 {PLAYWRIGHT_REQUIREMENT}가 "
            "없습니다 – requirements.txt를 이 interpreter에 "
            "설치하세요. 기존 Edge CDP 연결이므로 playwright install은 "
            "필요하지 않습니다. 자동 복사 대신 수동 fallback을 사용합니다",
            level="warn")
    if installed != PLAYWRIGHT_VERSION:
        return _check(
            "playwright", False,
            f"현재 Python(sys.executable={executable})의 playwright=={installed} – "
            f"{PLAYWRIGHT_REQUIREMENT}가 필요합니다. 자동 복사 대신 수동 "
            "fallback을 사용합니다",
            level="warn")
    return _check(
        "playwright", True,
        f"{PLAYWRIGHT_REQUIREMENT} 설치됨 (sys.executable={executable}, "
        "기존 Edge CDP 연결용; 브라우저 바이너리 설치 불필요)")


def _folders():
    out = []
    out.append(_check("repo_root", os.path.isdir("ops_runtime"),
                      "ops_runtime/ 확인" if os.path.isdir("ops_runtime")
                      else "ops_runtime/가 없습니다 – 리포 루트에서 실행하세요"))
    for d in ("workflows", os.path.join(".ops", "payloads"),
              os.path.join(".ops", "runs")):
        exists = os.path.isdir(d)
        writable = exists and os.access(d, os.W_OK)
        if not exists:
            out.append(_check(f"dir_{d}", True,
                              f"{d}/ 없음 – 도구가 필요 시 생성합니다", level="warn"))
        else:
            out.append(_check(f"dir_{d}", writable,
                              f"{d}/ 쓰기 가능" if writable else f"{d}/ 쓰기 권한이 없습니다"))
    return out


def _skill_snapshot(root, name):
    """SKILL.md뿐 아니라 점진 공개 reference까지 플랫폼 간 동일성을 확인한다."""
    folder = os.path.join(root, "skills", name)
    if not os.path.isfile(os.path.join(folder, "SKILL.md")):
        return None
    snapshot = {}
    for current, dirs, files in os.walk(folder):
        dirs[:] = [d for d in dirs if d not in {"__pycache__", ".git"}]
        for filename in sorted(files):
            if filename.endswith((".pyc", ".pyo")):
                continue
            path = os.path.join(current, filename)
            rel = os.path.relpath(path, folder).replace("\\", "/")
            with open(path, "rb") as f:
                snapshot[rel] = hashlib.sha256(f.read()).hexdigest()
    return snapshot


def _skills_sync():
    out = []
    names = set(SKILLS)
    for root in SKILL_ROOTS:
        for p in glob.glob(f"{root}/skills/custom-*/SKILL.md"):
            names.add(os.path.basename(os.path.dirname(p)))
    for name in sorted(names):
        deployed = {root: _skill_snapshot(root, name) for root in SKILL_ROOTS}
        present = {root: body for root, body in deployed.items() if body is not None}
        missing = [root for root, body in deployed.items() if body is None]
        if not present:
            out.append(_check(f"skill_{name}", False,
                              f"스킬 '{name}'의 SKILL.md가 모든 플랫폼에 없습니다",
                              level="warn"))
        elif missing:
            out.append(_check(
                f"skill_{name}", False,
                f"스킬 '{name}' 배치 누락: {', '.join(missing)} – "
                ".aipro 정본을 누락된 플랫폼의 skills 폴더로 복사하세요",
                level="warn"))
        elif len({json.dumps(body, sort_keys=True) for body in present.values()}) != 1:
            out.append(_check(f"skill_{name}", False,
                              f"스킬 '{name}'의 플랫폼별 배치가 어긋났습니다 – "
                              ".aipro(정본)를 .claude와 .agents로 복사해 맞추세요",
                              level="warn"))
        else:
            out.append(_check(f"skill_{name}", True,
                              f"스킬 '{name}' 플랫폼 3종 배치 일치"))
    return out


def _iter_task_paths():
    for p in sorted(glob.glob("workflows/*/*.json")):
        try:
            t = util.load_json(p)
        except Exception:
            continue
        if isinstance(t, dict) and t.get("schema_version") and t.get("nodes"):
            yield p, t


def _task_paths_exist():
    out = []
    for path, task in _iter_task_paths():
        missing = []
        for n in task.get("nodes", []):
            if n.get("type") == "if":
                continue
            pf = n.get("prompt_file")
            actual_pf = workspace.resolve_project_path(pf, path)
            if isinstance(pf, str) and PENDING not in pf and not os.path.isfile(actual_pf):
                missing.append(f"prompt_file: {pf}")
            cl = n.get("custom_logic")
            actual_cl = workspace.resolve_project_path(cl, path)
            if isinstance(cl, str) and PENDING not in cl and not os.path.isdir(actual_cl):
                missing.append(f"custom_logic: {cl}")
            for r in (n.get("references") or []):
                actual_ref = workspace.resolve_project_path(r, path)
                if isinstance(r, str) and PENDING not in r and not os.path.exists(actual_ref):
                    missing.append(f"references: {r}")
        if missing:
            out.append(_check(f"paths_{os.path.basename(path)}", False,
                              f"{path} – 로컬에 없는 경로 {len(missing)}건: "
                              + " / ".join(missing[:5]), level="warn"))
        else:
            out.append(_check(f"paths_{os.path.basename(path)}", True,
                              f"{path} – 참조 경로 이상 없음"))
    return out


def _secrets():
    """task들의 auth 참조(이름만)를 모아 존재 여부를 확인한다 – 값은 읽지도 싣지도 않는다."""
    refs = {}
    for path, task in _iter_task_paths():
        for n in task.get("nodes", []):
            for cfg in [n] + (n.get("systems") or []):
                auth = (cfg.get("integration") or {}).get("auth") or cfg.get("auth")
                if isinstance(auth, dict) and auth.get("name") and PENDING not in str(auth["name"]):
                    refs[(auth.get("kind", "env"), auth["name"])] = path
    out = []
    for (kind, name), path in sorted(refs.items()):
        if kind == "credman":
            try:
                import keyring
                found = keyring.get_password("ops_runtime", name) is not None
            except Exception:
                found = False
            where = "자격 증명 관리자"
        else:
            found = os.getenv(name) is not None
            where = "환경변수"
        out.append(_check(f"secret_{kind}_{name}", found,
                          f"{where} '{name}' " + ("등록됨" if found else
                          f"미등록 – 실행 전 등록 필요 (사용처: {path})"),
                          level="warn"))
    if not out:
        out.append(_check("secrets", True, "auth 참조를 쓰는 task 없음"))
    return out


def run_doctor():
    checks = ([_python_version(), _pyyaml(), _playwright()] + _folders() + _skills_sync()
              + _task_paths_exist() + _secrets())
    errors = [c for c in checks if not c["ok"] and c["level"] == "error"]
    warns = [c for c in checks if not c["ok"] and c["level"] == "warn"]
    return {
        "status": "error" if errors else ("warn" if warns else "ok"),
        "summary": (f"점검 {len(checks)}건 – 오류 {len(errors)}건, "
                    f"주의 {len(warns)}건"),
        "checks": checks,
        "instruction": ("AI 에이전트: ok가 아닌 항목의 detail을 사용자에게 요약해 알리고, "
                        "필요한 조치(설치·복사·등록)를 안내하라. 이 도구는 아무것도 "
                        "수정하지 않는다 – 조치 후 다시 실행해 확인한다."),
    }


def main(argv=None):
    util.utf8_stdout()
    argparse.ArgumentParser(
        description="배포 환경 사전 점검 (읽기 전용, AI 에이전트가 실행)").parse_args(argv)
    res = run_doctor()
    print(json.dumps(res, ensure_ascii=False, indent=2))
    return 0 if res["status"] != "error" else 1


if __name__ == "__main__":
    sys.exit(main())
