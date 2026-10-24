# Personal conversations and automatic Wiki reasoning

2026-10-24

## Behavior

Personal conversations have no project Wiki creation controls. Automatic initialization,
manual creation, regeneration, updates, task evidence recording and knowledge-map
export reject before source synchronization, model calls or Wiki writes. Status reads
report an unavailable project Wiki. `/wiki_update` shows a project-opening notice
without dispatching a model request.

The reserved storage `conversations` folder retains its personal identity when an old
catalog labels it as a project. It is excluded from WikiLibrary project roots, including
direct save requests. Existing files remain intact. The independent mail Wiki remains
available through its existing scope. This is the product Wiki boundary, not an OS
sandbox around general user file or shell commands.

Project Wiki settings now expose **자동 작성/갱신 추론** separately from the model.
An explicit choice is stored in the existing project `setting:wiki-generation` and
applies to initial generation, automatic generation/update and resumed updates.
It does not change the conversation's reasoning. `auto` retains compatible host
reasoning or the provider default. Unsupported models show an explanation instead
of unsupported choices. Changing settings during initialization admission, source
refresh preparation or an active Wiki run remains blocked.

Opening settings previously registered its short status-read progress as a queued
background job, hiding the entire dialog. That read-only loader now uses
`queue={false}`. Actual generation/update progress keeps the existing background queue.

## Implementation choice

Reuse the existing Wiki generation configuration, purpose-bound host provider request,
ReasoningPicker and common SettingsField components. Add one shared runtime scope guard
and apply it at dedicated Wiki write entry points. This preserves current model
catalogs, authentication, binding checks and write approval behavior without adding
another model loop or provider dependency. No new external SDK or source copy was
needed for this change.

## Verification

- Focused backend regression: 85 passed, including personal write rejection, legacy
  folder identity, update/resume, saved reasoning and initialization/refresh busy guards.
- The actual Wiki updater and host provider adapter sent `reasoning_effort: medium`
  to a synthetic compatible HTTP provider while conversation effort remained `xhigh`.
- Shared UI fixture: model/reasoning selection, save/reopen, rebuild binding and
  common dialog surfaces passed at 1280px and 440px.
- Actual macOS Electron with isolated SQLite: project to personal navigation,
  direct Wiki RPC/save rejection, slash command behavior, preserved legacy files,
  reload, project return and visible Wiki settings passed at 1280px and 440px.
  `scripts/check-personal-wiki.mjs` reproduces the full flow, including the status
  loader regression. Final artifacts are under ignored
  `verification/personal-wiki-2026-10-24/final-pass/`.
- Full suite before the final loader-only prop change: 2,955 total, 2,753 passed,
  202 skipped, zero failures. The final loader change was then verified in actual
  Electron. Build passed; existing CJS `import.meta` warnings remain.

The Electron connection fixture uses a keychain shim and a synthetic model. Its
credential-persistence warning is retained, not treated as successful secure storage.
This does not establish real provider quality, SSO, Windows, installer/update or
release readiness. Source main delivery, CI and installed-product validation are
separate outcomes.
