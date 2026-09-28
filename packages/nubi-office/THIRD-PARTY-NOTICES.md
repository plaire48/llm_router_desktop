# Source provenance and modifications

## Office AI Agent — Apache-2.0

- Source: https://github.com/it235/office-ai-agent
- Pinned revision: `1fd78d345b9444720f6589f1264c80028729a9f0`
- Source snapshot: `vendor/office-ai-agent`; original license and notices retained.
- Modified files: `ExcelAi/NubiIntegration.vb` (new Nubi ribbon/task pane), `ExcelAi/ThisAddIn.vb` (lazy Nubi entry, no original XLL startup), `ExcelAi/ExcelAi.vbproj` (host references, bundled resources, product identity), `ShareRibbon/Common/LLMUtil.vb` (remove authentication-prefix logging).
- New Nubi source outside `vendor` is separate from the upstream project. Inclusion of upstream's Apache license does not grant rights to unrelated Nubi branding.
- `native/Nubi.Office.Word.AddIn/ThisAddIn.Designer.*` and `native/Nubi.Office.PowerPoint.AddIn/ThisAddIn.Designer.*` adapt the corresponding pinned upstream VSTO-generated entry points. Native ribbon/host integration is Nubi-specific. The source snapshot's Apache license remains bundled.

## Open XML SDK — MIT

- Source: https://github.com/dotnet/Open-XML-SDK/tree/v3.3.0
- Native package: `DocumentFormat.OpenXml` 3.3.0 (with its Framework package). Used by `WordContentDocument` for in-memory Office 2016 element validation, not file editing or rendering.
- Original license and notices: `licenses/openxml-LICENSE.txt`, `licenses/openxml-NOTICE.txt`, copied from tag v3.3.0 and included by the normal distribution script.
- Windows restore and compilation passed in release 0.8.3. Actual Office 2016 document execution remains unverified; see the current release verification report.

## Pi — MIT

- Source: https://github.com/earendil-works/pi
- Packages: `@earendil-works/pi-agent-core` and `@earendil-works/pi-ai`, pinned to `0.86.1` in package-lock.json.
- MIT notice: `licenses/pi-MIT.txt`; transitive package licenses retained with bundled dependencies.

## Pi for Excel — MIT, design reference

- Source: https://github.com/tmustier/pi-for-excel
- Inspected revision: `fd6c9e3c3b206d6e2e39a2957c70714fdc879727`
- Inspected files: `src/workbook/coordinator.ts`, `src/workbook/recovery-log.ts`, `src/tools/write-cells.ts`, `src/tools/get-workbook-overview.ts`, `DECISIONS.md`.
- Reimplemented the document-bound coordinator, readback and guarded recovery principles for a C# COM port. No upstream Office.js runtime is included.
- MIT notice retained at `licenses/pi-for-excel-MIT.txt` for attribution.

## Existing Nubi source

Build-time inputs from `extensions/aipro-chat`: `agent-runtime.js`, `goal-review.js`, `completion-reader.js`, `core.js`, `chatgpt-auth.js`, `chatgpt-api.js`, `fabrix.js`, shared React surfaces/components, full UI theme and brand assets. Office-specific SSO inputs from `packages/office-legacy-aipro`. The distribution bundles these inputs and does not read extension storage. Nubi branding remains subject to its existing project terms.

## Shared frontend (0.4.0)

React/React DOM 19.2.8, react-markdown 10.1.0, remark-gfm 4.0.1 and the existing Nubi code highlighter are bundled into the WebView2 frontend. Package license files for the actual frontend dependency graph are retained in `dist/licenses/ui/`; bundle legal comments are also retained. Full source/style provenance is in `verification/ui-reuse.json`. The original user-provided HTML deck is not redistributed.

## Other bundled components

- Node.js: official Windows x86/x64 22.23.2, pinned archive hashes in `runtime-lock.json`; each runtime's original LICENSE retained.
- Newtonsoft.Json 13.0.3: MIT notice in `licenses/newtonsoft-MIT.md`.
- Microsoft WebView2 SDK 1.0.3240.44: Microsoft license and notices in `licenses/webview2-LICENSE.txt` and `licenses/webview2-NOTICE.txt`. WebView2 Evergreen runtime is a separate Windows prerequisite.
- Noto Sans KR: SIL OFL notice copied to `dist/licenses/noto-sans-kr-OFL.txt`.
- CX design system is an existing repository dependency, not relicensed by this package.

## Engineering references

- Anthropic harness/subagent/context/evaluation methods and additional open-source comparisons are recorded in `docs/EXCEL-2016-AGENT.md`. The new worksheet reader and bounded analysis supervisor are original integration code; no Claude Agent SDK, Deep Agents, LangGraph, Qwen-Agent or p-queue runtime was added. `anthropics/cwc-long-running-agents` is an Apache-2.0 reference demo, described by its authors as unmaintained; its hooks are not installed or redistributed here.

- Office COM threading: https://learn.microsoft.com/en-us/visualstudio/vsto/threading-support-in-office?view=visualstudio
- WebView2 message and navigation boundaries: https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/security
- Broader selection rationale: `docs/research/2026-09-22-office-ai-agent-adoption-bp.md` in the parent repository.

This snapshot does not imply endorsement by Microsoft or the upstream projects. Signed Windows installation and real provider operation have not been verified.

## Planning and evaluation references (0.3.0)

- Deep Agents (MIT): https://github.com/langchain-ai/deepagentsjs — task planning/progress pattern only; runtime not bundled.
- LangGraph planning/evaluator workflows: https://www.langchain.com/blog/planning-agents and https://docs.langchain.com/oss/javascript/langgraph/workflows-agents — design references; no LangGraph runtime or copied implementation.
- Microsoft UFO (MIT): https://github.com/microsoft/UFO — Windows observation/action BP; no UFO code bundled.
- Promptfoo (MIT): https://github.com/promptfoo/promptfoo — optional evaluation integration via an original custom provider adapter. Promptfoo itself is not bundled or live-validated.
- SpreadsheetBench-2: https://github.com/RUCKBReasoning/SpreadsheetBench-2 — recalculation/output evaluation methodology only. No upstream code or dataset is included; its redistribution terms were not established in this review.
- Evaluation fixtures are original synthetic data. LibreOffice/openpyxl are developer-side fixture checking tools, not runtime dependencies in the Windows add-in.

## ExcelJS — MIT (0.7.0 document authoring)

- Source: https://github.com/exceljs/exceljs
- Version: 4.4.0, pinned with npm integrity in package-lock.json.
- Used to write and reopen new multi-sheet XLSX documents; it does not calculate formulas. Excel performs production calculation.
- License retained in `dist/node_modules/exceljs/LICENSE`. Its uuid dependency is overridden to 11.1.1; the used CommonJS API is covered by actual file generation tests.
- LibreOffice is used only for local artifact verification and PDF examples; it is not bundled or substituted for production Excel 2016.

## Windows installer (0.8.1)

- Inno Setup: https://jrsoftware.org/ — installer compiler and setup runtime. Registry registration follows Microsoft's VSTO deployment model.
- Minimal VSTO entry: `native/Nubi.Office.AddIn` reuses the pinned upstream generated startup files and the existing Nubi integration; host/agent/UI implementations are unchanged.
- Microsoft VSTO runtime and WebView2 bootstrapper: official Microsoft downloads, Authenticode publisher/chain verified before packaging; source URLs and hashes recorded in `installer-build.json`.
- Windows installation and uninstall checks are recorded separately from real Excel 2016 and live provider execution.

## Existing-template design references

xlsx-template (https://github.com/optilude/xlsx-template, MIT) and JSON Forms (https://github.com/eclipsesource/jsonforms, MIT) were reviewed as template/data and schema/form design references. No source code or package from either project was copied or bundled by this change. Existing Pi/Nubi dependencies remain in use. See docs/TEMPLATE-FILLING.md.

Open XML SDK (https://github.com/dotnet/Open-XML-SDK, MIT) and Docling (https://github.com/docling-project/docling, MIT) were also reviewed; neither is bundled. Microsoft CustomXMLParts/SaveCopyAs APIs and Anthropic evaluation guidance inform the native persistence and evidence/unknown/HITL design. No source code was copied from these reference projects.

## Formula preflight (0.8.2 source)

- **excel-formula-tokenizer 3.0.0 — MIT**: https://github.com/psalaets/excel-formula-tokenizer. Actual runtime dependency, exact version and npm integrity pinned. Original license retained in `licenses/excel-formula-tokenizer-MIT.txt` and copied by the existing build process. Tokenization only; our grammar subset, reference validation and dependency graph are separate integration code. No formula evaluation by this package.
- **SheetCopilot — GPL-3.0**, https://github.com/BraveGroup/SheetCopilot: closed-loop observation/action/feedback design reference only. No source, Python runtime, dataset or package copied or bundled.
- Microsoft Excel Agent engineering, Anthropic tools/context guidance and evaluation selection are documented in `docs/AGENT-QUALITY-BP.md`. Microsoft Copilot binaries/services are not included.

## Error recovery (0.8.2 source)

- **p-retry 8.0.1 — MIT**, https://github.com/sindresorhus/p-retry: actual inference/read retry-loop dependency. Node >=22, exact version/integrity in package-lock.json. License retained at `licenses/p-retry-MIT.txt`.
- **is-network-error 1.3.2 — MIT**, https://github.com/sindresorhus/is-network-error: p-retry dependency, lockfile pinned. License retained at `licenses/is-network-error-MIT.txt`.
- Microsoft/AWS retry and idempotency guidance, Office COM error definitions, LangGraph error categories and MCP tool error guidance are design references in `docs/ERROR-RECOVERY-BP.md`. No LangGraph/MCP server runtime is newly bundled.
- Publication's pinned Nubi parser snapshot receives only the stream-completion and Retry-After fixes already present in the source workspace: `completion-reader.js`, `chatgpt-api.js`, `usage-stream.js`, `fabrix.js`, plus `http-retry.js`. Unrelated shared UI/provider changes are not imported.

## Harness state testing (0.8.2 source)

- **fast-check 4.10.2 — MIT**, https://github.com/dubzzz/fast-check: adopted as an exact dev dependency for generated state/receipt/cancellation sequences. Not imported by the product runtime. License in `licenses/fast-check-MIT.txt`.
- **pure-rand 8.4.2 — MIT**, https://github.com/dubzzz/pure-rand: fast-check transitive dev dependency, lockfile pinned. License in `licenses/pure-rand-MIT.txt`.
- LangGraph interrupt/checkpoint and Anthropic evaluation patterns remain design references. No second agent runtime, cloud telemetry service or new model/provider dependency is installed. Existing Promptfoo provider integration is extended through external workbook graders and a human-review import workflow; Promptfoo itself remains an external evaluation tool.

## Task-pane usability testing (0.8.2 source)

- **axe-core 4.13.0 — MPL-2.0**, https://github.com/dequelabs/axe-core: exact dev dependency, unmodified accessibility engine used in DOM/source-preview tests. Main and embedded third-party notices retained in `licenses/axe-core-MPL-2.0.txt` and `licenses/axe-core-THIRD-PARTY.txt`. No product runtime import.
- **React Testing Library 16.3.3 — MIT**, https://github.com/testing-library/react-testing-library: exact dev dependency exercising actual React components by accessible role/name. License in `licenses/react-testing-library-MIT.txt`.
- **jsdom 27.4.0 — MIT**, https://github.com/jsdom/jsdom: exact dev dependency for an in-memory DOM under Node 22.19+ / local Node 25; license in `licenses/jsdom-MIT.txt`. Newer jsdom 30 requires a different Node floor and excludes local Node 25, so it was not selected. Transitive versions/integrities are pinned in package-lock.json and upstream notices remain with installed dependencies.
- These three dev dependencies add 56 installed packages to this checkout, not a second agent runtime or telemetry service. Existing Playwright drives static source-component layout previews. The product bundler does not import these test modules.
- Shared Nubi `src/QuestionForm.jsx` receives only an optional `maxLength` prop; its default browser-extension limit remains unchanged. W3C status-message and Anthropic agent transparency principles are design references. See docs/USABILITY-IMPROVEMENTS-2026-09-23.md.

## Automatic request flow and shared Nubi UI

- Existing Pi (MIT) and p-retry (MIT) remain the runtime dependencies. The read-only intent dispatcher and same-run clarification handoff are original integration code; no additional agent framework or model is installed. See `docs/AUTOMATIC-FLOW-2026-09-23.md` for the Anthropic routing/feedback design reference and evidence boundaries.
- The reviewed browser Nubi interaction/trace surfaces and full UI cascade are synchronized to the publication snapshot. `design/shared-ui.json` records reviewed UI hashes. Authentication and provider state are not copied. See `docs/UI-PARITY-2026-09-23.md`.

## MiniSearch

- MiniSearch 7.2.0, https://github.com/lucaong/minisearch, MIT. Copyright 2022 Luca Ongaro. Full license: `licenses/minisearch-MIT.txt`. Included as a runtime dependency for per-run conversation and captured Word/PowerPoint text retrieval; no external service or embedding model.
- Context engineering and LangGraph memory are design references, not additional agent runtimes. See `docs/CONTEXT-MANAGEMENT-2026-09-23.md` for adoption boundaries and tests.

## Canonical tool input fingerprints (0.8.2 source)

- **fast-json-stable-stringify 2.1.0 — MIT**, https://github.com/epoberezkin/fast-json-stable-stringify: exact runtime dependency for deterministic object-key serialization before in-memory SHA-256 comparison. No additional runtime dependencies. Full unmodified license: `licenses/fast-json-stable-stringify-MIT.txt`.
- OpenCode `doom_loop` and Anthropic tool-result/evaluation guidance are methodology references; no OpenCode runtime or source implementation was copied into this feature. Existing Pi, p-retry and fast-check remain in use. See `docs/TOOL-PROGRESS-BP-2026-09-23.md`.

## Coding SDK and analysis scheduling (0.8.2 source)

- **@earendil-works/pi-coding-agent 0.86.1 — MIT**, https://github.com/earendil-works/pi/tree/v0.86.1/packages/coding-agent. Copyright (c) 2025 Mario Zechner. Runtime dependency; read/find/edit/write, skills discovery/prompt formatting and truncation are called directly. Full upstream license from the pinned tag is in `licenses/pi-coding-agent-MIT.txt` (the published SDK tarball omitted this file). Transitive packages and integrities are pinned in package-lock.json and retain upstream notices with the npm distribution.
- **p-map 7.0.4 — MIT**, https://github.com/sindresorhus/p-map: exact runtime dependency replacing the custom analysis dispatch loop. License in `licenses/p-map-MIT.txt`.
- The three bundled Office authoring skills are original Nubi integration guidance, not copies of Anthropic's separately licensed document skills. Agent Skills, OpenCode SDK/agents and Anthropic context engineering are methodology references. See `docs/CODING-SDK-ADOPTION-2026-09-23.md`.

## Document calculation runtime (0.8.2 source)

- **quickjs-emscripten-core 0.32.0 — MIT**, https://github.com/justjake/quickjs-emscripten. Runtime SDK actually executes the per-invocation QuickJS contexts. Full license: `licenses/quickjs-emscripten-core-MIT.txt`.
- **@jitl/quickjs-wasmfile-release-sync 0.32.0 — MIT**, same upstream. Includes the unmodified WebAssembly QuickJS runtime and its upstream notices (Fabrice Bellard and Charlie Gordon). Full distribution license: `licenses/quickjs-wasmfile-release-sync-LICENSE.txt`.
- **@jitl/quickjs-ffi-types 0.32.0 — MIT**, transitive dependency. Full license: `licenses/quickjs-ffi-types-MIT.txt`. Versions and integrities are pinned in package-lock.json.
- Anthropic code-execution/context guidance is a design reference; no Anthropic SDK, MCP runtime, remote execution service or Python runtime is added. Original Nubi calculation references explain the supported contract. See `docs/DOCUMENT-SCRIPT-RUNTIME-2026-09-23.md`.

## Calculation quality checks (development only)

- **@jitl/quickjs-wasmfile-debug-sync 0.32.0 — MIT**, https://github.com/justjake/quickjs-emscripten. Instrumented WASM evaluator tests use the existing core SDK `TestQuickJSWASMModule` with the release and debug variants. Full distribution license: `licenses/quickjs-wasmfile-debug-sync-LICENSE.txt`. Pinned in devDependencies and the lockfile; not added to runtime dependencies. See `docs/QUALITY-REVIEW-2026-09-23.md` for the 0.32.0 test-wrapper bookkeeping limitation and assertions.

## Reproducible UI dependency correction (development only)

- **patch-package 8.0.1 — MIT**, https://github.com/ds300/patch-package. The committed `patches/@e2e+cx-design-system+0.5.4.patch` adds `role="region"` to the existing named toast container. It changes no CSS, branding or toast behavior. Installed as a development dependency and applied before tests and builds; the product consumes the patched frontend bundle. Full license: `licenses/patch-package-MIT.txt`.

## TypeBox schema admission and shared validator

- Existing locked dependency: `typebox` 1.3.27 (MIT), https://github.com/sinclairzx81/typebox. No dependency version changed. Original license retained in `licenses/typebox-MIT.txt`.
- `worker/tool-response.mjs` reuses Nubi `extensions/aipro-chat/tool-validation.js` without modification; the publication snapshot includes that exact file at `vendor/nubi-shared/tool-validation.js`. Its SHA-256 is recorded in `verification/tool-schema-recovery-review.json`. Existing Nubi project terms continue to apply to this adapter.
- Pi and the shared browser runtime remain unchanged. MCP error-channel guidance is a design reference, not an added MCP transport or SDK.

## Approved local Python skill runtime

- **Astral uv 0.12.18 — MIT OR Apache-2.0**, https://github.com/astral-sh/uv. Official Windows x64 and x86 archives are SHA-256 pinned in `python-tool-lock.json`. Only `uv.exe` is bundled. Full licenses: `licenses/uv-MIT.txt` and `licenses/uv-Apache-2.0.txt`. Python 3.12 and skill wheels download only after approval; their runtime distributions retain their own license files.
- **proper-lockfile 4.1.2 — MIT**, https://github.com/moxystudio/node-proper-lockfile. Environment installation lock and stale heartbeat handling. Full license: `licenses/proper-lockfile-MIT.txt`.
- **Jinja2 3.1.6 — BSD-3-Clause**, https://github.com/pallets/jinja. Declared example skill dependency, not an eagerly installed/bundled interpreter package. uv installs its wheel and transitive dependencies with license metadata after approval. See `docs/PYTHON-SKILLS.md` for boundaries.


## Dynamic document delegation (2026-09-25 source)

- **dependency-graph 1.0.0 — MIT**, https://github.com/jriecken/dependency-graph. Runtime `DepGraph` validates dynamic specialist dependencies and rejects missing nodes/cycles. No transitive runtime dependencies. Exact version and SHA-512 integrity are pinned in package-lock.json. Original notice: `licenses/dependency-graph-MIT.txt`.
- Anthropic orchestrator-workers and OpenAI manager/tool orchestration are design references, not copied SDK implementations. Existing Pi, p-map and p-retry provide execution and recovery. Adoption boundaries: `docs/DYNAMIC-DELEGATION-2026-09-25.md`.

## Office structure navigation references (2026-09-25)

- Office Agents (`hewliyang/office-agents`, `95fb654491a9d394dc85ea2b8c93dee2ca4546b9`) declares MIT in package.json; no root LICENSE was found. OfficeCLI (`thomasfuk/officecli`, `b5d0ad354bfc1255f54c26ee3b6cdab84f9cace9`) includes Apache-2.0. Both were read as design references only. No code was copied, executed, installed or redistributed from these downloads.
- `inspect_document_structure` is original Nubi integration code using the existing Pi execution path. Codex/OpenCode and Anthropic tool/context guidance are methodology references. No additional runtime dependency. Exact source provenance and adoption boundaries: `docs/OFFICE-AGENT-BENCHMARK-2-2026-09-25.md`.

- Search continuation additionally references Office Agents' `search-data-pagination.ts`, OpenCode grep and Codex tool-search definitions at the commits recorded in `verification/search-source-review.json`. No external code copied or executed. Existing MiniSearch 7.2.0 and Pi are the actual reused libraries. Scope: `docs/SEARCH-CONTINUATION-BENCHMARK-2026-09-25.md`.

## Simulated evaluation host (development only)

- **@ironcalc/nodejs 0.8.3 — MIT**, https://github.com/ironcalc/IronCalc (`bindings/nodejs`). Exact dev dependency with prebuilt native binaries. It calculates formulas for `eval/sim`, the simulated Excel host used to run the worker with a real model where no Windows Excel exists. Chosen after running both candidates: it evaluated 60 of 60 probe formulas, including Korean sheet names, MATCH and SUMIFS. `fast-formula-parser` 1.0.19 was rejected because MAX, MIN, COUNTA, MATCH, SUMIFS and 14 other functions are not implemented. Not imported by the worker or the product bundle. Its results are not Excel 2016 results. License in `licenses/ironcalc-MIT.txt`.

## Registered template lookup

- **es-hangul 2.4.0 — MIT**, https://github.com/toss/es-hangul. Copyright 2024 Viva Republica, Inc. Exact runtime dependency without further dependencies. `worker/template-match.mjs` uses `getChoseong` so that a template can be called by its initial consonants (`/ㅊㅈㅅㅊㅅ`). Existing MiniSearch 7.2.0 ranks registered templates for a sentence. Both run in the worker process on the names and summaries of the catalog; no external service or embedding model. Full unmodified license: `licenses/es-hangul-MIT.txt`.
