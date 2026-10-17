# Installation opening scene

The old localStorage key tracked only the package version and was written on mount. Same-version reinstall therefore skipped the full scene, and a closed/crashed launch could consume it before it played.

The NSIS customInstall completion hook now rotates `nubi-installation.id` next to the executable. This runs for interactive installs, silent installs and updates, independent of whether the installer launches the app immediately. Electron reads the bounded GUID and exposes only this installation ID through its sandboxed preload. Existing installers without a valid marker use executable creation/change metadata as a fallback. Development/non-Windows runs retain the version fallback.

The scene's seen key combines package version with installation ID. It is recorded only after completion or a user skip. Ordinary relaunch keeps the existing brief opening. Reduced motion shows a static brief opening; non-installed automated fixtures keep their skip; installed apps still show the opening when automation is attached. First-run tour and user data are unaffected.

References checked: [electron-builder NSIS completion hooks](https://www.electron.build/nsis/), [NSIS GUID generation](https://nsis.sourceforge.io/Create_a_GUID,_a_Globally_Unique_Identifier). No new package dependency.

Validation: 3 state/marker tests passed; real React fixture verified first install, normal relaunch, same-version reinstall, silent-update identity and reduced motion. Electron bundle built successfully. `Test-WindowsInstaller.ps1` now asserts marker rotation after actual reinstall/update. Windows installer execution remains unverified in this Mac session; no installer/release was generated. Evidence: `verification/installation-cutscene-2026-10-15/result.json`.

Ending transition refinement: preserve the flight, fade to full white at 4.85 s, then fade in the fixed-size brand at 5 s and progress track at 5.2 s. Removed the final title zoom and exit scaling/translation. The progress track uses the shared line token for contrast on white. No new dependency.

Validation: the React/Chromium fixture now includes shared styles, fonts and real brand assets. It checks white-before-logo, intermediate opacity and unchanged title bounds at 4.9/5.4/6 s; installation lifecycle and reduced-motion checks passed. Visual evidence: `ending-white.png` and `ending-logo.png` in the verification directory above. Electron bundle build passed. Windows installed playback remains unverified.

## Startup cover (2026-10-15 follow-up)

The initial HTML supplies an opaque white cover and hides the app root before JavaScript loads. The intro is a body portal outside the app's transforms. A layout effect hands off the cover only after the intro is committed; the app root is revealed at the existing leave transition. Native browser views and page view transitions wait until the opening sequence is finished. The shell error boundary releases the cover to show recovery controls if rendering fails. This adds no fixed startup delay and preserves install-version selection, skip and reduced-motion behavior.

The opening-scene UI check now delays module loading by 700 ms and verifies the cover before React, hidden app content during the intro, and visible content after completion across first install, normal relaunch, same-version reinstall, update and reduced motion. Windows installed startup remains a separate check.

## Brief launch and project switching follow-up

Ordinary launches keep their opaque logo/progress surface until startup settles. The former six-second timer no longer declares the opening done; skipping while startup is pending advances to the title instead of exposing the workspace. The critical HTML guard suppresses root opacity and body-level portals, including descendants that explicitly set `visibility:visible`. The root is inert until hand-over, and the renderer error boundary restores interactivity. Brief mode has a white fallback independent of token loading. `NubiPreparing` covers a new not-ready state in the same render, rather than waiting for an effect.

Project navigation sets its guard before awaiting the host and commits the new Workbench synchronously before removing it. Pending view-transition snapshots are cancelled and no new snapshot starts during a project switch. A compact brand/progress cover fills the area below the toolbar; old workspace contents, portalled dialogs and native browser views remain hidden. Cancellation/failure restores the original UI and interactivity. Existing project drafts and view-state storage are retained.

Validation: opening React/Chromium fixture covers delayed JS, explicit visible descendants, high-z-index portals, first install, brief relaunch, reinstall, update, a startup beyond six seconds, early skip and reduced motion. Five opening/transition tests pass. Actual macOS Electron with two temporary local projects verifies the delayed switch frame-by-frame, new project after uncover, and original project on failure (`scripts/check-project-switch-cover.mjs`, `verification/project-switch-cover/result.json`). No company session or user project is used. Windows installed startup/switching remains unverified.

## Windows installed-app report (2026-10-16)

The reported environment is Windows, but the installed version and actual playback have not been observed. This change addresses identified reliability gaps rather than claiming a reproduced Windows root cause. The installer GUID is decoded with UTF-8/UTF-16 BOM support and combined with executable replacement metadata. This detects a replaced payload even when an older/custom installer preserves its marker. Ordinary launches retain a stable identity. The sandboxed preload is tested with the exact generated stamp.

A generic window click or ordinary key no longer skips the flight. Only the common-token Skip button or Escape skips it, and an unready app remains behind the opaque title surface. The in-memory completion flag is recorded after completion, matching the persistent seen key. A webdriver flag no longer suppresses the installed app's intro. Reduced motion retains its static opening.

Validation: six marker/state/preload tests, production React browser checks for first launch/relaunch/reinstall/update, accidental click/key input, attached automation, delayed readiness and reduced motion passed. Local Electron build and identity check passed. The existing Windows installer gate checks marker rotation; actual installed intro playback remains unverified and no installer was built or released in this session.
