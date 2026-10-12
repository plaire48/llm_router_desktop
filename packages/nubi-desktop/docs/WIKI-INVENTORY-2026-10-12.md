# Wiki inventory and ordinary folders — 2026-10-12

Ordinary folders already initialize Git in a private analysis copy, not the user's source folder. The existing test verifies a real temporary Git HEAD, generated pages/Claims and unchanged absence of `.git` in the source. No initial source commit is required from the user.

The overview previously counted Wiki files using Git's source inventory, which excludes ignored generated pages. It now enumerates actual Markdown pages under `openwiki/`, excluding internal/private entries and refusing symlinks. Workbench reloads the page inventory when generation finishes or project materials opens; the update card rechecks initialization transitions and ignores stale requests.

Absent pages now return `no_wiki_pages`. The view distinguishes generation in progress, interrupted generation, cancellation, model connection and not-yet-generated pages. Existing pages without metadata still offer recovery through the ordinary approved update path. A prior `wiki_source_missing` failure can leave no generated pages: this change does not fabricate a successful generation.

Validated with 29 source/init/update/view regressions and a browser-rendered empty → running → failed → completed flow without closing the project-materials dialog. The browser uses synthetic data; the Windows installed app and the user's failed repository generation are not retested here.
