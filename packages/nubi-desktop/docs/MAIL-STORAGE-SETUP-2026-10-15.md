# Mail storage setup after sign-in

After portal authentication, Desktop asks where to keep mail originals and attachments before background collection starts. The compact common dialog explains that accumulated originals can consume substantial disk space, displays the current path, and offers **현재 위치 사용** or **폴더 선택**. It uses the shared type, color, spacing, dialog and toolbar-scrim rules. No guessed mailbox size or free-space estimate is shown.

- A previously selected raw-root path counts as configured. Otherwise the explicit confirmation is persisted in the private mail store. Later logins/restarts reuse it.
- Closing the guide or cancelling the native folder picker does not approve the default path or begin collection. Mail settings exposes the guide again. Existing mail remains readable.
- Portal sync checks the storage gate before folder enumeration, summary or EML downloads, including manual sync. Authentication and reading the identity/folder information needed to verify login still occur first. A valid session is reused without a new credential prompt.
- The selected parent gets a private `nubi-mail-raw` subfolder. Wiki storage and credentials are not moved. Existing mail directories use the same account-independent raw-root location and account-scoped record identities.
- Relocation copies and verifies original file hashes before changing the stored pointer. Failure before the pointer commit removes only this attempt's copies and keeps the original path/files. Nested and non-empty destinations are rejected; canonical paths prevent symlink aliases bypassing the nesting check. The original copies are deleted only after pointer commit; cleanup failure may leave duplicate files at the previous location, while reads use the committed new location.
- Copy-first migration needs enough destination space for existing originals and can take time. A busy state with elapsed time is shown. Background reads/writes are held out of relocation; an active portal collection refuses a location change instead of racing the move.

## Validation and limits

- 35 focused tests passed: original relocation/readback, failure before path commit, first confirmation, restart persistence, prior chosen-path compatibility, no collection before confirmation, portal authentication and incremental collection regressions.
- Electron build passed, including initialization-order and shared icon checks.
- `verification/mail-storage-setup/check.mjs` passed in the real Electron renderer: login opens the guide, 1100×800 and 700×560 layouts fit below the toolbar, cancelling the picker keeps the guide, a rejected destination is actionable, selection/default confirmation closes it, and a reused session/location asks nothing again. Portal/picker replies are synthetic. This is not company SSO or native Windows folder-picker proof. Screenshots: `verification/mail-storage-setup/guide-1100.png` and `guide-700.png`.
- No Windows installer or release was generated for this change.
