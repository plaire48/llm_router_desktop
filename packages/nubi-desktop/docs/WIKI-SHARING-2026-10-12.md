# Shared wiki in Nubi Workspace

The AI Workspace page now has Skills and Wiki sections. The Wiki section uses the native GHES account and the fixed `Manufacturing-IT/nuri` repository. It does not require the separately hosted AI Workspace site to load. Code and Personal documents have separate lists and download roots.

## Repository contract

- Read the repository's current default branch. The catalog is `wiki/catalog.json`.
- Each wiki has a UUID directory, latest `manifest.json`, and immutable `versions/<version>/manifest.json` and `pages/` documents.
- Metadata records title, description, mode, semantic version, creator, managers, updater and timestamps. Native account identity stamps the author; the renderer cannot impersonate one.
- Create blobs and one tree/commit, check the expected head, then move the branch with `force:false`. Never retry an uncertain write automatically. Verify the saved catalog at the returned commit.
- Upload requires repository push permission; editing an existing wiki additionally requires its creator, manager, or repository admin. This is app policy, not a server ACL against direct Git writes.
- Archive/reopen preserves prior versions. Download re-fetches the catalog and verifies the selected immutable manifest and each document hash.

## Sharing and local files

A native folder chooser stages only UTF-8 Markdown. The user selects files, sees their paths, and confirms the precise native save request before publication. Personal documents are unselected by default. Hidden files, raw/cache/credentials/secrets folders and symlinks are excluded or rejected. Up to 500 documents, 20 MB total and 2 MB per file are supported. Selected files are re-read and checked before upload.

Downloading creates an exclusive `wiki-<uuid>-<version>` folder containing `openwiki/` (Code) or `personal/` (Personal) and a source receipt. Existing files are never overwritten. This shares documents, not connector credentials, raw mail, or a runnable clone of another user's Personal installation. Downloaded documents are not automatically activated as an agent project.

## UI and evidence

The existing common modal typography, semantic colors, controls and scroll/focus behavior are reused. The page uses a quiet Wiki registration button; the final modal action is Share. The page remains navigable while signed out and offers the existing native SSO flow.

Native unit tests use an in-memory GHES Git API. Electron rendering checks use the production component with clearly synthetic wiki records at 1000 and 440 px plus enlarged text. These do not establish real corporate GHES publication or Windows installer success. No user wiki content was published during development.

GitHub Git Data API tree/commit and non-forced reference update patterns were adopted from the existing marketplace and official GHES REST documentation. No new library or authentication mechanism was added.
