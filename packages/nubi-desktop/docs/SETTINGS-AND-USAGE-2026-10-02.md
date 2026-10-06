# Core settings and shared usage

User decision: settings contains app behavior settings only. Mail, skills and
project tools keep their own existing entry points. The remaining setting is
the real default terminal selector; it keeps OS discovery and Windows PowerShell.

The upper-right home/conversation action opens the browser extension's
`UsagePanel` directly. Its today/total tabs, provider breakdown, cache/reasoning
subsets, missing-report counts and quota presentation share the original source
and CSS. Desktop changes only the scope label and supplies a native quota loader.
The context-window donut remains a separate current-conversation measurement.

Desktop model providers report start/finish to `DesktopUsage`. The browser's
`usage-ledger.js` and `normalizeUsage` validation compute each receipt. Independent
frames support concurrent chat/planning/review, Wiki, vision and mail calls.
Totals and 31 local-date daily buckets persist as numeric SQLite records outside
individual projects. A restart converts unfinished calls to unmeasured calls.
This begins with the new ledger and does not invent usage for older conversations.
One logical model invocation counts once; provider-rejected option retries inside
that invocation are not billed-token estimates. Partial/failed requests without
a valid provider usage report stay unmeasured. Receipt failures cannot fail inference.

ChatGPT quota uses the extension's existing account usage fetch/normalizer and
five-minute cache in the authenticated host. An unexpected 401 refreshes once;
403 does not disconnect a working inference session. Quota and inference share
an in-flight refresh to avoid rotating one refresh token twice. Results are bound
to the same in-memory login session, and only normalized limits reach the UI.
Quota, credentials and refresh tokens are never persisted by this feature.
All model and mail credentials still require login after restart.

Chosen: reuse existing UI, validation, receipt and TTL patterns. No new usage UI,
embedding service, SDK dependency or credential store is added. This provides
actual provider-reported tokens, not a cost or bill estimate.

Validation boundary: Electron build only, as requested. Real provider account
quota, live inference totals, Windows deployment and automated tests are separate.

Observed after the successful build and Electron restart: the same-worker web
screen shows only the default terminal in settings. The top-right usage action
opens the shared today/total/provider UI; ChatGPT expands to input/output counters.
The fresh ledger correctly shows zero calls and requires login for account quota.
Screenshots: `/private/tmp/nubi-settings-detail-2026-10-02.jpg` and
`/private/tmp/nubi-usage-detail-2026-10-02.jpg`. No live model call was made to create
usage data and no automated test suite was run.
