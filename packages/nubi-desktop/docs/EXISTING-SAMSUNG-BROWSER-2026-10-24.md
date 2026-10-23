# Reuse the running Samsung Browser

## Problem and behavior

An unconnected MCP `browser_open` still called the selected browser executable.
This could open another window or tab before any automation connection existed.
The direct connection separately required `DevToolsActivePort`, so a running
fixed-port Chromium server could be missed. The model instruction also assumed
that the person could allow the connection in Chrome's permission UI.

External-mode address and MCP open requests now return `opened:false` and
`connectionRequired:true` until a work tab is connected. They publish the current
connection surface and its actual error without invoking an executable, system
browser, settings URL, shell repair or an internal work page. Connected requests
retain the original window ID/session. Provider authentication retains its own
protected internal path.

## Existing endpoint discovery

The trusted connect action performs a fixed read-only PowerShell query. It
identifies current-session Samsung processes by executable name and manufacturer
or product metadata, then projects their existing loopback TCP listeners. This
also preserves an explicitly selected executable: the fixed helper receives its
literal path through private environment input and matches only that process.
An inherited environment value cannot override the saved selection. The default
Samsung target still requires Samsung product metadata. Listener absence means
the bounded discovery found no usable endpoint, not proof that every debugging
feature is disabled. Discovery does not inspect command lines, cookies, browser
databases or page content.
It does not search installation folders before connection.

Only these owned listeners are considered. A valid Samsung discovery file can
provide the WebSocket route without requiring an HTTP endpoint. An unowned stale
port file is ignored. For fixed-port servers, the resolver requests only
`/json/version` from the owned listeners, two at a time, with at most eight
listeners. Each request is bounded to 750ms, 8KiB headers and 16KiB body. It never
follows redirects, resolves another host or scans a port range. The returned
WebSocket must use the same loopback address/port and a browser endpoint path.
Cancellation stops the helper or metadata request and cannot adopt a late tab.

The existing direct CDP host still lists public candidate titles before
attachment, attaches only the chosen work tab, protects authentication documents
and detaches without closing the browser. Missing endpoints do not launch any
browser's settings window. Samsung absence and a running Samsung process without
a usable web-control endpoint have separate errors. MCP receives this current
state and does not instruct the model to wait for an assumed permission dialog.

## Capability boundary

Chromium compatibility does not mean that an ordinary already-running process
exposes a CDP endpoint. This change discovers endpoints that already exist; it
cannot enable a disabled server inside a running Samsung process. It does not
install an extension, relaunch the browser, inject flags, change enterprise
policy, copy a profile or fall back to a different browser. Window display and
Windows UIA computer control remain distinct from DOM/CDP and portal API access.

The [Samsung remote debugging policy](https://developer.samsung.com/browser/policy/remote-debugging-allowed.html)
documents debugging switches and enterprise restrictions. It does not establish
Chrome's permission flow for Samsung. The [Chrome announcement](https://developer.chrome.com/blog/chrome-devtools-mcp-debug-your-browser-session)
specifies Chrome 144+ for that flow. The [CDP endpoint documentation](https://chromedevtools.github.io/devtools-protocol/)
distinguishes fixed-port HTTP discovery from the file written for a dynamically
selected port. These references inform the implementation; no external engine
or source copy was added.

## Validation boundary

Regression tests first reproduced the unwanted launch and the failure to connect
without a discovery file. Additional checks exercise real loopback HTTP/WebSocket
servers, forbidden destinations, redirect rejection, stale metadata, cancellation,
the trusted connection port and the actual MCP registry. Injected PowerShell
results validate framing, error propagation and bounded listener metadata.

The Electron journey uses a test-owned Chromium process, removes its discovery
file, supplies listener ownership as a fixture and then exercises the real
endpoint resolver, original authenticated tab and host/rendering/input flow.
That fixture does not prove Windows process discovery or Samsung compatibility.
Actual Windows PowerShell, the user's Samsung version, company SSO, native IME,
installation/update/relaunch and real-model work remain unverified.

Local executed results are recorded below after validation. The earlier broad
UI gate failures recorded in `UI-RESPONSIVENESS-2026-10-24.md` remain open; this
change does not declare those gates passed or repeat their performance benchmark.

## Executed local checks

- Final focused browser/connection/mirror/docking/MCP/PowerShell/UI regressions:
  113 passed, zero failed, two Windows-only checks skipped.
- Actual Electron and test-owned existing Chromium journey: 17 checks passed,
  including no executable launch before connection, connection without a port
  file, original HttpOnly session, original-tab input and protected login pages.
  `verification/existing-browser-2026-10-24/report.json` and its screenshots retain
  the bounded evidence. The Windows process-listener result is a fixture.
- `npm run build:electron` passed. Existing CJS/import.meta and package module-type
  warnings are not resolved by this change.
