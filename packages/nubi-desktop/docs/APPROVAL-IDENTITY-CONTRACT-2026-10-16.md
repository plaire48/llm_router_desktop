# Approval identity recovery

The supplied Desktop Message Portal Panel userscript was compared directly with the Desktop implementation. Mail authentication can succeed with an email address alone; approval list requests additionally require the portal EP user ID.

## Gaps fixed

- The userscript checks `GET /portal/user/rest/v1/get/session/token`. Desktop previously omitted this endpoint. It now checks it if mail user information and desktop policy do not provide the EP ID. The response is projected inside the reader to allowed identity fields; token fields, unrelated users and raw profile responses are not returned or stored.
- The userscript stringifies numeric user IDs. Desktop now normalizes numeric profile and own-message IDs too.
- The userscript uses sent folder ID 2. Desktop retains named sent-folder detection and falls back to ID 2 when its name is unclassified. A known mailbox address must match the sender before using its ID.
- A native Electron reproduction found a second failure after closing the login tab: the session request helper called `request.end('')` for GET. That creates an upload body and the GET never reaches the server. Bodyless requests now call `request.end()`.

## Request contract

| Step | Userscript contract | Desktop |
| --- | --- | --- |
| Mail profile | POST userinfo/read, `{}` | Retained |
| Desktop policy | POST auth/policy?svcSectCd=DM, empty body | Retained |
| Portal profile | GET portal/user/rest/v1/get/session/token | Added as fallback, no body |
| Own sent identity | Folder 2, simple response `from.userID` / `from.epID` | Numeric IDs supported, account match guarded |
| Approval list | POST getDeskTopApList, epid and pageNum query, X-EpUserID header | Verified |
| Approval document | POST getDeskTopApItem, `[{ap,ln}]`, first result | Verified |
| MIME | Preserve Latin-1 byte strings; UTF-8 encode actual Unicode | Verified against HTML body readback |

The userscript's broad cookie/storage scan is not copied. Existing Desktop policy keeps cookies inside the persistent Chromium session and does not extract credentials. A missing ID remains a specific user-confirmation failure, with retry while keeping mail connected; it is not reported as a mandatory new login. HTTP, list, document and parsing failures retain their existing distinct stages.

## Verification boundaries

Unit checks cover GET without body, numeric EP ID, identity-only projection, no-ID profile, service failure, account mismatch and sent-folder fallback. The native Electron fixture now reproduces email-only mail profiles, obtains EP ID through the portal endpoint, closes the login tab, re-identifies through the persistent session and reads the approval list plus rendered HTML content. The existing five expiry/relogin cases run afterward. UI checks cover 1100, 440 and 360px, retry without forced login and existing common font/spacing tokens.

This is a local protocol fixture, not a captured company response. Actual corporate approval service and the user's Windows 11 PC remain unverified. Windows CI evidence belongs to the new build that includes this change.
