# Startup, notifications and progress reliability

The startup intro and CX modal manager previously both mutated root inert. A modal opened during the intro captured the locked root and restored it after closing, leaving every control inaccessible. The reproducer failed before the change. The intro now locks only the internal shell; CX retains root modal isolation. Tests cover a restored startup modal, early closing, repeated opening/closing, reload and real button clicks. This reproduces the failure locally; it is not proof of the user's Windows installation.

Wiki writing blocks conversation admissions for its project while settings and project navigation remain available. Its progress card uses one faint radial background with opacity motion and a solid progress fill. No additional illuminated strip is placed behind the bar. Counts and duration remain factual. Reduced-motion preferences remain supported.

Notification delivery receipts now survive window teardown and restart. Only hashed identifiers and timestamps are persisted, bounded to 4096 receipts. Closing a visible notification no longer resets delivery history. Mail authentication notices reset only after successful reconnection. Normal quit flushes pending receipts with a one-second ceiling; abrupt termination or disk failure can still lose a pending receipt.

Only the known session-expired alert on the approved mail-login tab's abnormal-logout path is automatically accepted once. Other alerts, confirmations, prompts and authentication submissions remain unchanged. Local Electron mock-HTTPS verification does not establish company SSO success.

The commit list keeps 25-entry pagination and adds incremental parent lanes. No external graph package or copied implementation is introduced. Native Git parent/topological tests and browser pagination checks cover the relationship boundary.

Validation: startup and cutscene browser checks passed; wiki/portal fixture at 440/1100 pixels passed; design token check passed; notification delivery and restart checks passed. Windows workflow now includes startup interaction regression before packaging, but this new workflow has not yet run.

Mac Electron validation also passed after the rebuilt bundle: real menus and modals released their input locks, file edits/readback and commit history opened, and the internal PTY accepted Korean input and interruption. First visible screen was 5.872 s and project readiness 6.684 s in this single instrumented run; this is not a performance distribution or Windows timing.

The first full suite reported 1408 passed, 2 failed, 196 skipped. Both failures were in notification test contracts: the old test expected re-notification after clear, and a new persistence test removed its temporary directory before its last queued write. These tests now require a verified reconnect before a new mail notice and await the write queue before cleanup. The targeted rerun passed 13/13; the full rerun is recorded separately when complete.

Final local full rerun: 1606 tests, 1410 passed, 0 failed, 196 skipped, 319.7 seconds. Build and design checks passed. Windows CI and installer validation are pending publication gates.
