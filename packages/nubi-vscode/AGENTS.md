# Nubi VS Code host

- This host is how the main product, the VS Code (Code-OSS) fork `/Users/ganadi/Documents/nubi-code-work/nubi-code`, embeds Nubi (user decision 2026-10-01). It is an explicitly authorized adapter for `../nubi-desktop`, not a second agent implementation. Reuse its Workbench, runtime, OpenWiki-SDS, skill tools and approval flows.
- Support trusted local file workspaces. Refuse remote/virtual roots and do not interpret WSL/SSH paths as local Windows paths. Ask the user to choose one folder in multi-root workspaces.
- Run the shared runtime in the bundled checksum-verified Node sidecar. Never use the workspace's Node executable, settings or startup hooks. Keep provider credentials in sidecar memory and state in VS Code global storage.
- All webview RPCs pass the host allowlist and trust check. Native file pickers alone supply external file paths. Preserve dirty editor buffers, version/hash checks, VS Code undo and post-save readback. Never replay an uncertain edit or process request.
- UI/UX/CX MUST follow the root `사용자 UI/UX/CX 기준` in AGENTS.md: readability first, fewer steps, key text with its details, icon only when the icon alone is clear, no middle dots, the reference HTML tokens and the browser agent CX.
- Keep the supplied HTML identity and concise Korean copy. Reuse Desktop's design checks and public CX components. A2A is enabled (user decision 2026-10-01): a received request runs only after the user accepts it.
- Distinguish contract tests, actual VS Code extension-host/editor checks, webview UI, target-platform packaging, Windows GUI and real provider tests. Do not describe a development extension or a macOS VSIX as a verified Windows release.

- Readability and meaning take precedence over reducing character count. Lead with the key sentence and retain its decision-relevant details. Use bold for a few important phrases, deep brand blue for the leading conclusion, and text/icon labels alongside status colors. Prefer verified result images and unambiguous named icon actions; never remove approval scope or recovery instructions.

- 사용자 결정 2026-10-01: 누비 주 실행기와 OpenWiki/Computer Use 분담을 중심으로 한다. OpenMetadata와 해당 로컬 서비스 설치/계정 초기화는 현재 범위에서 제외한다. 기존 호스트 승인과 모델 인증을 유지하고 첫 실행은 LLM 연결과 프로젝트 열기를 재사용한다. 현재 설계와 미구현 경계는 docs/MANAGED-MULTI-AGENT.md 및 docs/FIRST-RUN.md를 따른다.

- Workspace parity (2026-10-01) enables personal mail through the trusted local-project RPC. Bundle mail-worker beside service-entry, keep POP3 credentials in host memory, and use the shared MailLibrary with its explicit connection and model controls. A blank status read never connects. See the main fork docs/WORKSPACE-PARITY-2026-10-01.md.

- Workspace design (user decision 2026-10-01): the product title is 누비 Workspace and the visible version is Beta. MUST review shared tokens, spacing, hierarchy, readable Korean copy, identical icons for identical actions, keyboard access and reduced motion. Connect the conversation to the native file/editor/Git/result flow while preserving user layout and drafts. Follow root docs/WORKSPACE-DESIGN-2026-10-01.md and validate the main fork, not only this source package.

- Workspace agent MUST be the central default surface, not a closable editor tab or a right-side helper. Keep conversation, planning, questions, approval and results together; reveal native files/diffs as supporting editors in the same window.

- Follow the user-provided Codex screenshot structure: Nubi tool rail, project/conversation list, central agent and supporting native documents/editors on the right. Remove generic startup shortcut instructions and VS Code branding from the product shell; preserve native editing, search, Git, terminal, debugging, keyboard access and user layout.

- The main agent MUST not expose Hide Panel/X or hide/move actions. Enforce this in the fork core, keep native output/debug/terminal and document tools in supporting areas, and never present stock VS Code development-host screenshots as a core-patched product runtime.

- 사용자 결정 2026-10-01: GHES 회사 계정과 SAML SSO 연계는 MUST 지원한다. 왼쪽 메뉴바 맨 아래는 원형 사용자 사진만 두고 E2E Report의 로그인/프로필 구성을 공통 CX 토큰과 모션으로 재사용한다. 알려진 보조 동작은 툴팁/접근성 이름을 갖춘 공통 아이콘으로 표시한다. 호스트 Device Flow와 검증된 사용자 ID, SecretStorage를 사용하고 암호/SAML assertion/Client Secret을 받지 않는다. 인증을 모델/웹뷰/프로젝트에 전달하지 않으며 만료/로그아웃 때 이전 요청과 개인 캐시를 폐기한다. 동일 계정으로 회사 스킬과 native Git을 연결한다. GHES Release의 기능 VSIX 업데이트와 Code-OSS/EXE 전체 갱신을 MUST 구분한다. 구현/실회사 SSO/Windows 검증 경계는 packages/nubi-vscode/docs/GHES-ACCOUNT-AND-UPDATES.md를 따른다.
