# Result review and GHES profile follow-up

The reported “요구사항과 결과 확인 실행 실패” has no confirmed live model/error code yet. The following reproduced failure classes were fixed without weakening result acceptance:

- A complete single JSON Markdown fence is parsed as JSON. Prose mixed with JSON, fabricated evidence, missing checks, unexpected tools and truncated output remain invalid.
- Provider `response_invalid` or `output_limit` during review can use the existing one structured format repair before the existing read-only actor recovery. Authentication/network/cancellation are not misclassified as JSON errors. No completed commands are replayed by this repair.
- Review trace stores only a fixed reason code (JSON, schema, envelope, output limit or sanitized transport code). The UI says review needs checking, rather than claiming an actual command failed.

GHES status uses a read-only viewer GraphQL query. Only a validated Unicode emoji is displayed over the avatar's lower-right corner; server HTML is never rendered. Optional unsupported/error responses do not invalidate the login. Cache is account-generation scoped, expires after one minute, and an expired status is hidden. Logging out prevents late responses from restoring the profile.

Validation: 67 focused source tests passed. Actual React fixture checks at 1100px and 440px covered badge placement/expiry, audience search/selection/chips/Enter/save, fixed review failure wording, modal bounds and console errors. Identity checks and local Electron build passed. GHES live directory/profile status, the user's reported model failure and Windows installation were not exercised. The published 1.1.6 installer is unchanged.
