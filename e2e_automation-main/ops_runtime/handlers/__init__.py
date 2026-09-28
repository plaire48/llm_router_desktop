# -*- coding: utf-8 -*-
"""Action Type 8종을 실행 핸들러에 연결하는 레지스트리."""
from . import (consult, decision, file_read, file_write, notify_receive,
               notify_send, system_read, system_write)

HANDLERS = {
    "file_read": file_read.handle,
    "file_write": file_write.handle,
    "system_read": system_read.handle,
    "system_write": system_write.handle,
    "notify_send": notify_send.handle,
    "notify_receive": notify_receive.handle,
    "consult": consult.handle,
    "decision": decision.handle,
}

WRITE_TYPES = {"system_write", "notify_send", "file_write"}
