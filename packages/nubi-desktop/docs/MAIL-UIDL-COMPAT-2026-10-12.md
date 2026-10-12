# UIDL listing compatibility

The installed-app report is `mail_uidl_format`. This occurs after POP3 authentication when parsing the returned listing. No actual corporate listing was captured; the precise offending row is unverified.

The old parser rejected LF-separated rows, whitespace-only rows, zero-padded positive message numbers and IDs longer than 70 bytes. The parser now accepts these unambiguous representations while preserving the opaque ID exactly. A compatibility maximum of 1,024 ASCII bytes applies to IDs, within the existing 4 MiB total listing limit. RFC 1939 specifies 1–70 bytes; longer IDs are an explicitly bounded client compatibility extension, not a standards claim.

Do not split or truncate IDs, replace them with transient message numbers, skip malformed rows, or silently mark a partial listing complete. Duplicate numeric message positions, control characters, extra fields and over-limit identifiers remain errors. Identical-copy UIDL deduplication is unchanged. Error UI identifies parsing failure rather than asking users to change POP3 settings. Diagnostics contain only fixed codes, never raw IDs or server replies. TLS verification and no-DELE behavior remain unchanged.

Reuse existing node-pop3 transport; no replacement dependency. [RFC 1939 UIDL](https://www.rfc-editor.org/rfc/rfc1939#section-7) defines the identity and repeated-copy contract.

14 local tests passed including a TLS server, compatible rows, repeated synchronization without duplicate downloads, malformed row rejection, existing authentication/certificate errors and worker integration. Log: `verification/mail-uidl-compat-tests.log`. Real corporate POP3 and updated Windows installer are not verified.

Eight mail UI checks passed, including persistent error details at 440 px and sanitized diagnostic copying (`verification/mail-uidl-ui.log`).
