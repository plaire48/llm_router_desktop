# Installation opening scene

The old localStorage key tracked only the package version and was written on mount. Same-version reinstall therefore skipped the full scene, and a closed/crashed launch could consume it before it played.

The NSIS customInstall completion hook now rotates `nubi-installation.id` next to the executable. This runs for interactive installs, silent installs and updates, independent of whether the installer launches the app immediately. Electron reads the bounded GUID and exposes only this installation ID through its sandboxed preload. Existing installers without a valid marker use executable creation/change metadata as a fallback. Development/non-Windows runs retain the version fallback.

The scene's seen key combines package version with installation ID. It is recorded only after completion or a user skip. Ordinary relaunch keeps the existing brief opening. Reduced motion shows a static brief opening; automation keeps its existing skip. First-run tour and user data are unaffected.

References checked: [electron-builder NSIS completion hooks](https://www.electron.build/nsis/), [NSIS GUID generation](https://nsis.sourceforge.io/Create_a_GUID,_a_Globally_Unique_Identifier). No new package dependency.

Validation: 3 state/marker tests passed; real React fixture verified first install, normal relaunch, same-version reinstall, silent-update identity and reduced motion. Electron bundle built successfully. `Test-WindowsInstaller.ps1` now asserts marker rotation after actual reinstall/update. Windows installer execution remains unverified in this Mac session; no installer/release was generated. Evidence: `verification/installation-cutscene-2026-10-15/result.json`.

Ending transition refinement: preserve the flight, fade to full white at 4.85 s, then fade in the fixed-size brand at 5 s and progress track at 5.2 s. Removed the final title zoom and exit scaling/translation. The progress track uses the shared line token for contrast on white. No new dependency.

Validation: the React/Chromium fixture now includes shared styles, fonts and real brand assets. It checks white-before-logo, intermediate opacity and unchanged title bounds at 4.9/5.4/6 s; installation lifecycle and reduced-motion checks passed. Visual evidence: `ending-white.png` and `ending-logo.png` in the verification directory above. Electron bundle build passed. Windows installed playback remains unverified.
