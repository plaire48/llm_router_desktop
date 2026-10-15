# Mail collection and list stability

Background collection no longer replaces a mail list the user is reading. The existing portal importer already checks persisted account-scoped IDs before requesting summary or EML. This change separates that server check from refreshing the local search view.

- **새 메일 확인** checks the portal and imports unknown IDs. It does not force a search refresh.
- **목록 업데이트** appears when the local data revision changes. It queries local storage only, retaining the open reader, checked IDs, current numbered page and scroll position.
- Search, filter and page changes explicitly request the latest local results. The numbered UI does not send an old accumulation cursor that would reset the page when new mail arrives. Agent cursor invalidation remains unchanged.
- A failed refresh preserves the usable previous table. Background progress never disables its row or checkbox targets.
- Account scope uses the existing hashed account ID together with identity revision. A different account clears the prior reader and selection even when its identity revision has the same value.
- Portal checks still enumerate lightweight headers, so an older missing item is not skipped merely because a newer item is known. This is not a new remote deletion or same-ID draft revision synchronization mechanism.

## Evidence

`scripts/check-mail-stability.mjs` renders the real MailHistory components in Chrome with synthetic mail and timed arrivals. Before the change, arrival disabled the row, reset page 2 to page 1 and moved scrollTop from 200 to 0. After the change, background arrival causes zero extra searches and preserves page, reader, selection and scroll. Explicit local refresh makes zero portalSync requests; a server check makes no extra search request. Failed refresh and account replacement are also exercised.

`tests/mail-incremental.test.mjs` verifies persisted-ID skipping, repeated and overlapping checks, restart reuse, older missing mail discovery and failed-new-import retry. The portal and mail search regression suites are included in the 28 passing tests.

Artifacts: `verification/mail-stability-2026-10-15/`. The Electron bundle, initialization-order check and icon check pass. Local synthetic UI and protocol checks do not establish live company portal or Windows installer success. No installer or release was generated for this change.
