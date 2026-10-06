# Desktop login and page routing

All Desktop HTTP/HTTPS page openers use the existing right WebContentsView browser. This includes AI Pro and ChatGPT login, GHES device login and profile links, explicit openBrowser/openWorkspacePage requests, app links with or without a new-window target, and remote-page popups. No system-browser fallback is used.

2026-10-04 follow-up: the trusted renderer now intercepts HTTP/HTTPS anchor activation, including portal dialogs, modifier clicks and middle clicks, and calls the same internal page bridge. This also prevents links in the optional localhost UI from opening a separate web tab. Native popup/navigation interception remains the fallback guard in Electron. Downloads now reveal the saved item in the OS file manager rather than invoking its default application, which could launch an external browser for an HTML file. Blob downloads and citation buttons keep their existing handlers. The retired Theia and VS Code hosts remain unchanged.

Model selector chips are explicitly stationary for hover, keyboard focus and press, including their labels. Provider colours, focus outlines and the existing folder/conversation marquee remain intact. The shared CX button is reused; no new browser or UI dependency is introduced.

The download change uses [Electron showItemInFolder](https://www.electronjs.org/docs/latest/api/shell#shellshowiteminfolderfullpath), while popup handling uses [setWindowOpenHandler](https://www.electronjs.org/docs/latest/api/web-contents#contentssetwindowopenhandlerhandler). The existing sandboxed WebContentsView remains the product browser.

2026-10-04 verification: `npm run build:electron` completed. In the localhost example-data UI, the model selector opened normally and Escape restored focus. With the pointer still hovering, its bounds stayed at x=131/y=1145, 32x44px; button and label transforms and animation were `none`. This checks the compact UI state, not a provider authentication result. No automated tests were run. The running real-account Electron host was preserved: automatic approval review rejected reload because memory authentication and unsaved state might be lost, so applying the new native-host build awaits explicit restart approval.

The existing page-opening IPC bridge and sandboxed browser host are reused. Provider construction accepts an optional opener; Desktop injects its bridge while Office retains its existing default. Authentication still uses the original loopback listener, one-use callback checks, PKCE/state where supported, token exchange and model loading. Remote pages receive no Node/IPC credentials or automated login permission. Computer Use remains disabled.

Opening a page dismisses the current Desktop modal without cancelling authentication. GHES user codes remain available beside the page with the existing copy action, disappearing when the device flow completes or expires. Auth tabs and their popups are excluded from application visit history. Browser address state strips code/token query values and token fragments; the native request still reaches the unmodified callback URL.

Build-only delivery follows the user's instruction. This does not establish live AI Pro, ChatGPT, GHES or Windows login success. An identity provider can restrict embedded browsers or require popup relationships; such a restriction must be diagnosed from the actual account flow instead of opening an external browser silently.

The mail connection entry also had a rendering fault: the Gmail helper used an unsupported CX icon name, `externalLink`. Clicking Mail connection mounted that helper and threw `Unknown icon: externalLink`, blanking the app before credential entry. It now reuses BrowserMark. The failure was observed through the localhost UI without entering credentials; POP3 authentication is a separate result.

After the Electron build and owned-app restart, opening Mail → Mail connection in the localhost renderer displayed the Gmail address, app password and connect controls normally. No credentials were entered and no automated suite was run. The captured view is `verification/mail-connect-render-fixed-detail-2026-10-02.png`.
