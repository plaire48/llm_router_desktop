# -*- coding: utf-8 -*-
"""커스텀 로직 초안 추적.

AI 에이전트가 사용자 설명을 근거로 run.py 초안을 작성한 직후 `mark`로 해시 사이드카
(ai_draft.json)를 남긴다. 검증기는 사이드카와 현재 run.py 해시를 대조해
"AI 초안 그대로(검토 필요)"인지 판별한다 — 사용자가 run.py를 한 글자라도 고치면
해시가 어긋나 검토한 것으로 간주한다. 코드 수정 없이 검토만 확정하면 `approve`로
사이드카를 삭제한다. 사이드카는 로직 폴더 안에 있어 task JSON을 건드리지 않고
(지문 무효화 없음), 폴더째 이전해도 상태가 따라간다.

CLI (AI 에이전트가 실행한다):
  python ops_runtime/logic_draft.py mark     <로직폴더>
  python ops_runtime/logic_draft.py approve <로직폴더>
"""
import argparse
import hashlib
import json
import os
import sys

if __package__ in (None, ""):  # 파일 직접 실행 지원
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from ops_runtime import util
else:
    from . import util

SIDECAR = "ai_draft.json"
RUN_PY = "run.py"


def _run_py_sha256(folder):
    path = os.path.join(folder, RUN_PY)
    if not os.path.isfile(path):
        return None
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def draft_status(folder):
    """로직 폴더의 초안 상태.

    - "ai_draft":  사이드카 존재 + run.py 해시 일치 — AI 초안 그대로(검토 필요)
    - "reviewed":  사이드카 존재 + 해시 불일치 — 사용자가 수정함(검토로 간주)
    - "clean":     사이드카 없음 — 추적 대상 아님(approve 됐거나 초안 아님)
    """
    sidecar = os.path.join(folder, SIDECAR)
    if not os.path.isfile(sidecar):
        return "clean"
    try:
        recorded = util.load_json(sidecar).get("run_py_sha256")
    except Exception:
        return "clean"  # 손상 사이드카 — 판별 불가는 경고를 만들지 않는다
    current = _run_py_sha256(folder)
    if recorded and current == recorded:
        return "ai_draft"
    return "reviewed"


def mark(folder):
    """run.py의 현재 해시를 보조 파일에 기록해 AI 초안 상태로 표시한다."""
    digest = _run_py_sha256(folder)
    if digest is None:
        return {"status": "error",
                "reason": f"run.py가 없습니다: {os.path.join(folder, RUN_PY)} — 먼저 run.py를 작성해 주세요"}
    util.atomic_write_json(os.path.join(folder, SIDECAR),
                           {"run_py_sha256": digest})
    return {"status": "ok", "folder": folder, "state": "ai_draft",
            "note": "run.py를 AI 초안으로 표시했습니다. 사용자가 수정하면 자동으로 검토 처리되고, "
                    "수정 없이 확정하려면 approve를 실행하세요."}


def approve(folder):
    """사이드카 삭제 — 사용자가 코드 수정 없이 검토를 확정한 경우."""
    sidecar = os.path.join(folder, SIDECAR)
    if not os.path.isfile(sidecar):
        return {"status": "ok", "folder": folder, "state": "clean",
                "note": "초안 표시가 이미 없습니다 — 검토 안내가 뜨지 않는 상태입니다."}
    os.remove(sidecar)
    return {"status": "ok", "folder": folder, "state": "clean",
            "note": "검토 확정 처리했습니다 — 검증에서 초안 안내가 더 이상 뜨지 않습니다."}


def main(argv=None):
    util.utf8_stdout()
    p = argparse.ArgumentParser(description="커스텀 로직 초안 추적 (AI 에이전트가 실행)")
    sub = p.add_subparsers(dest="cmd", required=True)
    for name, help_text in (("mark", "run.py를 AI 초안으로 표시"),
                            ("approve", "검토 확정 — 초안 표시 삭제")):
        sp = sub.add_parser(name, help=help_text)
        sp.add_argument("folder", help="로직 폴더 (workflows/<활동>/logic/<이름>/)")
    args = p.parse_args(argv)
    res = mark(args.folder) if args.cmd == "mark" else approve(args.folder)
    print(json.dumps(res, ensure_ascii=False, indent=2))
    return 0 if res.get("status") == "ok" else 1


if __name__ == "__main__":
    sys.exit(main())
