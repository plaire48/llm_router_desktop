# -*- coding: utf-8 -*-
"""Creator 질문지에 표시할 안전한 MCP 준비 상태를 만든다.

The standalone Creator server is not an MCP client.  The active Code Assistant
must probe its own tools and pass only these enums to Creator; credentials,
server configuration, and probe errors must never cross this boundary.
"""

SERVICES = ("knox", "confluence")
STATES = ("unlinked", "missing_token", "connected")
DEFAULT_STATE = "unlinked"

SERVICE_LABELS = {
    "knox": "Knox",
    "confluence": "Confluence",
}

STATE_LABELS = {
    "unlinked": "MCP 미연동",
    "missing_token": "인증 토큰 미입력",
    "connected": "MCP 연동",
}


def normalize(value=None):
    """임의 문자열을 제외하고 검증된 상태 항목을 빠짐없이 반환한다."""
    if value is None:
        value = {}
    if not isinstance(value, dict):
        raise ValueError("MCP 상태는 JSON 객체여야 합니다")
    unknown_services = sorted(set(value) - set(SERVICES))
    if unknown_services:
        raise ValueError(
            "지원하지 않는 MCP 상태 항목입니다: "
            + ", ".join(unknown_services))

    result = {}
    for service in SERVICES:
        state = value.get(service, DEFAULT_STATE)
        if state not in STATES:
            raise ValueError(
                f"{SERVICE_LABELS[service]} MCP 상태는 "
                + ", ".join(STATES)
                + " 중 하나여야 합니다"
            )
        result[service] = state
    return result
