# Electron 전체 화면 가독성 검토

2026-10-17 후속: [전체 화면과 모달 토큰 점검](DESIGN-TOKEN-AUDIT-2026-10-17.md)에서 CSS 로드 순서, 글꼴/크기/굵기/색상/간격과 실제 렌더링을 다시 확인했다. 아래 기록은 각 작업 당시의 검사와 결정을 보존한다.

## Aligned answer sources (2026-10-12)

The source heading now sits above a single-column list instead of consuming space beside source 1. Each full-width row has fixed icon and number tracks, one truncated title, retained location/freshness metadata and an opening chevron. Mail uses an envelope; attachments and documents use the common file icon. “원문 출처”, full-title tooltips and explicit source/type/open accessible names identify the destination without adding explanatory paragraphs. Citation numbers and source identities remain unchanged.

Renderer build and identity check passed. In the running connected app, sources 1 and 2 shared icon/number/title starting positions. Opening source 1 displayed the corresponding original mail in the auxiliary reader; the source row remained usable in the narrower conversation pane. No model request, authentication change or mail mutation was needed.

## Conversation menus and visible work (2026-10-12)

Conversation actions now use Electron's native Popover top layer with fixed viewport placement, rather than changing the session row grid when details open. Pin/unpin and delete remain separate actions, deletion keeps its confirmation, and keyboard arrows/Escape, outside dismissal and focus restoration are retained. The same component serves skill actions without clipping within the modal. Native Popover was selected to avoid a new dependency and preserve the modal's DOM/focus ownership; MDN's [Popover guidance](https://developer.mozilla.org/en-US/docs/Web/API/Popover_API/Using) was checked against the running Chromium behavior.

Desktop opts into retaining completed operations in the shared browser AgentTrace. The browser/Office defaults are unchanged. The chronological list scrolls within 320px, while public progress notes and real waiting/error states remain. Personal-mail operations explicitly name personal Wiki lookup; these labels identify the requested operation, not proof that notes exist or that an answer is correct. Fully supported final checks become a compact “확인한 근거” disclosure. Missing evidence, approvals, omitted inputs and next actions retain their visible status. No private model reasoning or simulated stages were added.

The current mail tool passes includeKnowledge:true; exact-mail notes and original content travel together, and missing/edited/pending/unavailable/truncated states remain distinct. A read-only check of the actual prior two-mail result receipt found two current OpenWiki notes (885 and 870 characters), matching original source hashes, no truncation and original bodies in both model inputs. This verifies that saved real run, not a new inbox sync or a new AI completion. Five focused Personal-knowledge contract tests passed. The 29 modal checks and shared UI suite passed (33 recorded checks, with computer-use scenarios explicitly skipped because the feature is disabled), along with renderer build and identity check. The running app was reloaded without restarting its worker: ChatGPT remained connected. Native UI inspection confirmed the floating conversation menu, Escape focus return, two actual mail/Wiki read operations and the compact eight-check evidence disclosure. The app still reports mail connection required; this pass did not verify new mail reception.

## Calm bird motion follow-up (2026-10-12)

The welcome bird previously combined an outer 9-second swim with the shared 8-second liftoff and rotating mood animations. Desktop now keeps the outer wrapper and small toolbar/answer marks stationary. The large bird has one continuous 6-second breathing cycle limited to 2px vertically, with no rotation or scaling. Idle/working expressions use a brief blink instead of repeated full-body wing/flight swaps. Hover smile and idle sleep reuse the existing assets with a short opacity transition. The welcome background/aura stays still, and input focus, modal/hidden state and OS reduced-motion preserve motion suppression. No animation package or replacement artwork was added.

Renderer build, design check and all 103 screen checks passed. An additional live Electron animation check sampled a full breathing cycle: horizontal offset 0, vertical offsets 0/-1/-2/-1/0, unit scale, no outer/small-logo animation. Input focus paused the cycle and reduced-motion removed it. Evidence: verification/all-surfaces/bird-motion.json. Reloaded the actual application without a worker restart and opened its welcome screen for visual inspection; ChatGPT remained connected. Screenshot evidence shows appearance, while the dynamic check establishes the bounded motion.

사용자 요청: 일부 화면에 한정하지 않고 모든 화면과 모달을 같은 CX 기준으로 심플하게 정돈한다. 핵심 결과와 다음 행동을 먼저 읽도록 하되 승인 대상, 모델 전달, 미확정 결과와 복구 정보는 유지한다.

## 공통 적용

- Pretendard Variable/Pretendard와 번들 Noto Sans KR를 재사용한다. 본문과 입력 16px/1.75, UI 15px/1.6, 보조 14px/1.5의 상대 단위와 기존 누비 파랑을 유지한다.
- 전체 Electron 화면, CX 모달 및 body에 포털로 열린 작은 모달에도 같은 글자 위계와 행간을 적용한다. 정상/오류 상태의 대비 색상과 키보드 초점은 유지한다.
- 헤더는 넓은 창 48px, 좁은 창 88px 두 줄이며 기능명을 유지한다. 모달 본문 세로 여백 16px, 목록 세로 여백 12px, 버튼 간격 12px, 그룹 간격 20px로 정돈한다. 긴 목록/본문은 스크롤한다. 클릭 영역과 드래그, 스크롤, 입력 초안은 보존한다.
- 모델/스킬/메일 목록은 이름과 선택 상태를 먼저 보여준다. 스킬의 전체 설명은 정보 버튼으로 읽고, 설명을 펼치면 같은 설명을 중복하지 않는다.
- 위키의 최신 상태는 한 번만 표시하고 갱신 시각은 기록에 둔다. 갱신 제안은 모델 전달과 반영 경계를 기본 화면에 유지하며 호출 방식의 상세만 펼친다. 실패/반영 제외 파일은 접어 숨기지 않는다.
- 파일 편집기와 읽기 전용 변경 비교는 실제 계산된 공통 글자 크기/행간을 Monaco에 전달한다. 코드, 터미널은 고정폭 서체를 쓴다. 일반 문서 본문은 읽기 토큰을 쓴다.
- 회사 계정은 팀 스킬/저장소 연결의 실제 목적을 짧게 표시하고, 설치 요청/재시작/설치 확인을 구분한다. Git 변경 목록의 상태는 한국어로 표시한다.

## 전체 목록과 증거

| 영역 | 검토한 화면/모달 | 증거 |
|---|---|---|
| 시작 | 모델 연결, 프로젝트 선택, Git 입력, 시작 메일 안내 | all-surfaces + shared-ui + lifecycle |
| 대화 | 본문, 계획/실행 기록, 확인 질문, 큐/초안, 문서/역할 분석, 출처, 중단/복구, 변경 제안 | all-surfaces + shared-ui + agent-ui |
| 대화 보조 | 대화 검색, 대화 삭제 확인, 승인 방식, 추론 설정, 반영 파일 목록 | all-surfaces + modal-review + shared-ui |
| 모델 | 선택, 긴 목록, 제공자 연결 대기/오류, FabriX 연결, 컨텍스트, 사용량 | all-surfaces + modal-review + shared-ui |
| 메일 | 빈 목록/검색 결과/원문/첨부, 단계별 연결, 연결 후 설정, ON/OFF, 검색 조건, 저장한 검색, 태그/고정, 다운로드/오류 | all-surfaces + mail-ui + 단위 회귀 |
| 스킬 | 목록, 커스텀 관리, 등록, 휴지통/복원, 삭제 확인, 팀 목록/정보/설치/업데이트/삭제, 회사 로그인 | all-surfaces + modal-review + skills-ui |
| 프로젝트 자료 | 검색, 위키 문서/기록, 초기화 진행, 최신/갱신 제안/진행/반영 승인/실패 | all-surfaces + modal-review + 단위 회귀 |
| 설정/계정 | 기본 터미널, 회사 계정 미연결/코드 로그인/연결됨, 저장소/업데이트 | all-surfaces + modal-review + 단위 회귀 |
| 오른쪽 도구 | 파일 목록/개별 탭/편집, 저장/미저장, 검색, Git 변경/커밋/비교, 도구/셸 메뉴, 터미널, 브라우저/찾기, 보조 영역 확장/닫기 | native-surfaces + ui + live-web |
| 공통 상태 | 토스트/오류, 백그라운드 처리/메일 OFF, 위키 진행, 재시작/프로젝트 재연결, 좁은 창/모션 감소 | all-surfaces + lifecycle + shared-ui |

UI/모달 렌더링 경로는 `ui/Workbench.jsx`, `ui/*`, `electron-app/renderer.jsx`, 파일/브라우저/터미널/Git 컴포넌트와 실제 공유 ChatControls/UsagePanel/FabrixConnection/QuestionForm을 확인했다. 사용하지 않는 과거 KnowledgeMap/VOC/수동 패널과 꺼진 computerUse/A2A를 사용자에게 노출하지 않았다. OS 파일/폴더/저장 선택창과 외부 로그인/AI Workspace 사이트는 소유 앱의 UI이며 Electron 스타일로 덮어쓰지 않는다.

## 검사 결과

- `test:all-surfaces`: 91개 렌더링 상태 통과. 실제 production 컴포넌트와 최종 Electron CSS를 격리된 Electron에서 사용한다. 1280px/440px 화면과 주요 모달 글자 200% 확대, 보조 글자 최솟값, 페이지 가로 넘침, 모달 경계, 상단/입력 버튼 잘림과 모델/승인 이름 표시를 확인한다. 예시 데이터이며 실모델/계정 성공은 아니다.
- `test:gates`의 각 단계를 순차 검사하여 통과: 단위 586 통과/0 실패/195 기능 비활성 skip, design, forms 8, mail 7, modals 24, shared 30, Electron 빌드, native ui, skills 9, agent, live-web 9, lifecycle. 첫 sandbox 실행의 localhost EPERM 실패는 같은 검사를 허용된 로컬 환경에서 다시 실행해 해소했다.
- 실제 임시 프로젝트의 Electron 검사: 파일/저장 readback, Git 비교/커밋, 터미널 명령, loopback 브라우저/찾기, 좁은 창과 중앙 Agent 유지. native-surfaces에 실제 화면 캡처를 남겼다.
- `verification/all-surfaces/result.json`은 캡처별 검사 결과다. `verification/surface-gallery.html`은 영역/화면/크기를 선택하는 캡처 검토 화면이며 앱 기능을 대신하는 mock UI가 아니다.
- 빌드/로컬 성공을 Windows 설치판, Office/NASCA, 실제 제공자/회사 계정, 원격 AI Workspace 성공으로 확대하지 않는다.

## 방법 선택

기존 CX와 공유 누비 컴포넌트를 재사용하고 공통 CSS 두 파일을 최종 스타일 계층으로 확장했다. 별도 UI 프레임워크나 새 폰트 의존성은 추가하지 않았다. 상대 단위 및 단위 없는 행간은 글자 확대와 함께 커지도록 하고, 보조 설명은 기존 native details/summary와 정보 버튼을 재사용했다. 참고: [MDN line-height](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/line-height), [MDN details](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/details). 이 참고는 승인/복구 계약을 줄이는 근거가 아니다.


## 아이콘과 이름 후속 적용

사용자 후속 요청에 따라 모든 주요 동작은 기존 CX 아이콘과 짧은 이름을 함께 표시한다. 같은 아이콘/문구/간격을 전체 화면 및 모달에 적용하고, 좁은 창에서도 모델명과 승인 방식은 숨기지 않고 줄바꿈한다. 왼쪽 도구는 아이콘 아래 이름을 표시한다. 파일/Git/브라우저/터미널, 추론/스킬/사용량/문맥, 모달 닫기와 복사에도 이름을 보존한다. 파일 탭의 작은 닫기는 기존 요청의 X 계약을 유지한다.

스킬 정보/지침/삭제와 대화 고정/삭제는 native details 관리 메뉴로 묶는다. Escape로 관리 메뉴를 접으면 해당 트리거로 초점을 돌린다. 주요 설치/업데이트와 반영 승인은 기본 화면에 유지한다. Desktop 전용 WorkspaceAction은 기존 CX ActionButton의 접근성 이름, busy/ref/툴팁 계약을 재사용한다. 공유 ModelSelection/UsagePanel/ContextMeter/QuestionForm/CopyButton에는 선택적 showActionLabels를 추가하여 다른 호스트의 기본 동작을 유지한다.


후속 최종 확인: 전체 렌더링 91개 상태, 모달 24개, 공유 대화 30개, native 도구 14개, 스킬 9개, 에이전트 8개, live-web 9개와 lifecycle을 순차 통과했다. 단위 586 통과/0 실패/195 비활성 skip 및 디자인 검사, forms 8개, mail 7개, Electron 빌드도 통과했다. 각 UI 실패를 수정한 뒤 해당 단계부터 남은 검사를 이어 실행했다.

공유 검토 페이지가 이전 CSS만 불러오던 문제를 수정하여 실제 Electron style scope, 분할 레이아웃 및 최종 스타일을 함께 검사한다. 검사는 승인된 파랑 두 토큰과 UI/보조 위계를 사용하며, 모델명/승인 이름 숨김과 상단/입력 버튼 잘림을 실패로 처리한다. 실제 오른쪽 도구 검사에서 새 이름이 물려받던 12px 스타일과 줄바꿈 뒤 도구 메뉴가 영역 밖으로 잘리는 문제를 찾아 수정했다. 메뉴 위치는 보조 영역 크기 변화에도 영역 안으로 제한한다.


## Company account entry follow-up (2026-10-11)

- The company sign-in entry existed only at the bottom of the navigation rail. The Electron titlebar now shows one icon and `회사 계정` entry at the right, before or after opening a project. Hosts without a titlebar retain the rail fallback.
- Reused GhesAccount, the existing GHES Device Flow and CX modal lifecycle. No new authentication library or credential handling. The modal identifies `code.sdsdev.co.kr`; long profile names remain inside the modal.
- Compact titlebars place navigation/account on the first row and title/actions on the second. Rail overflow now scrolls so remaining navigation remains reachable at short heights.
- Validation: Electron build and design check passed. Modal suite passed 29 checks, including 1280x720, 800x600, 440x500, no-project and connected synthetic states. These checks establish UI visibility and modal/focus behavior, not real company SSO completion.
- Native Electron tool-flow check completed all 14 assertions; native screenshots include the titlebar account entry. Its Git comparison stage also logged `no diff result available`, so this run is not reported as free of runtime errors. Real SSO was not attempted.

- User follow-up: remove the company host from the login dialog and trigger tooltip. Place the 48px logo next to the service name and one-line guidance, with the sign-in button immediately below; remove stacked hero padding. Authentication endpoints and Device Flow are unchanged.


## Recognizable icons without redundant labels (2026-10-11)

The latest user decision supersedes the blanket icon-and-label rule. Copy, refresh, close, search, familiar navigation, send/stop and overflow controls use icons with accessible names and tooltips. Selected model/approval state, ambiguous actions, sign-in and committing actions retain concise labels. Existing typography, spacing, drafts, focus and approval contracts remain.

Desktop action wrappers now select icon-only utilities instead of forcing all labels on. The chat, all modal close controls, mail/skills utilities, navigation and native browser/pane controls share this rule. The common CX components and existing shared-host defaults are reused without adding dependencies.

- Validation: 91 Electron render states passed across wide/narrow windows and selected 200% text states. Modal checks passed 29 cases after respecting the existing CX Escape order (keyboard tooltip, then management group, then modal). Build and design-token checks passed. Git-history refresh and mail-search clear labels were also removed in the final build.


## Chat and composer first (2026-10-11)

Prioritize the conversation and composer using Codex-like hierarchy: white reading area, a subdued user bubble, unboxed assistant text and one thin composer outline. The existing 700px shared reading width, Nubi typography/blue accent and source references remain. Input tools stay inside the surface; approval state and context usage move to a compact footer beneath it. This supersedes the earlier chat-surround gradient only in the conversation area.

The existing Nubi input/bar, commands, draft, queue, stop/send and anchored modal implementations are reused. Minimum-width measurement includes the new inner surface insets. Synthetic chat-preview captures show example content, not a live model response.

- Chat-first validation: Electron build and design check passed; 93 render states, 30 shared-UI checks (including disabled-feature skip records) and 29 modal checks completed with no reported page errors. Draft restoration, input expansion, model selection, approval and same-window reload remain covered. The test app already open is not forcibly restarted during the user’s login/work.

- Toolbar follow-up: usage, wiki and new-conversation actions show icons only with hover/keyboard hints; shorten the wordmark by omitting the repeated Workspace suffix. Keep the conversation title, company-account entry and actual wiki preparation indicator.

## Composer flow and unified mail search (2026-10-11)

The search previously required every query term in one indexed chunk, so sender + body and distant body + attachment queries could miss the same email. Reuse MiniSearch and the existing evidence index, but intersect term coverage by mail ID after filters. Recipients, CC, date and current local tags are searchable metadata; source hashes, attachment locations, coverage limits and cursor resets remain. This adopts document-level AND retrieval without adding dependencies or a separate model/search provider.

`AI로 찾기` prepares an editable mail-search request with the current query and filters in the existing conversation. Preserve the current draft and selected model, focus the input and wait for Send. The existing personal_mail_query/read_personal_mail tools handle retrieval and source citations; their filter schema now includes metadata and local classifications. Natural-language requests are converted to concise keywords with explicit filters preserved. No mail is sent, no model starts from the handoff button, and no account credentials or local paths enter the request.

The composer now owns a single disabled gate for button and Enter submission, while preserving slash-command selection, Korean IME, Shift+Enter, expansion and queue/stop controls. A late mail-evidence read cannot attach to a different conversation draft after navigation.

Validation: 15 mail/search tests passed, including cross-location terms, isolation between emails, recipients/CC/date/tags, filter-first matching, pagination reset and draft overflow. Shared UI completed 31 checks (including existing disabled-feature skip records), covering search-to-chat handoff with an existing draft, conditions, model visibility, focus and no automatic send. Electron rendering completed 95 states including AI-search controls at 1280px and 440px. Build and token checks passed. Synthetic data establishes local behavior only; real mailbox retrieval, real provider search quality and Windows Office/NASCA are not claimed. The user's open app is not forcibly restarted.

## Mail reading and selected-source questions (2026-10-12)

Replace tall mail cards with aligned sender/title/preview/date rows. Show attachment metadata only when relevant. Keep range and previous/next page controls at the top; range disclosure contains direct page entry, page size, sorting and a remembered comfortable/compact density. The reading view has previous/next across page boundaries and a return action. Small windows show only the reader until returning; wide windows keep the list beside it. Preserve query, filters, page, scroll and selection in project-scoped UI memory across chat handoffs. Recent collection timestamps remain available in the collapsed collection details.

Selection is explicit per row or current page, bounded by the existing 20-source evidence contract. It persists across pages and clears when the search conditions change. A batch is validated in full against current source hashes, then appended atomically to the existing draft; a stale source or a changed conversation scope cannot partially attach the batch. Sending is still explicit. Multiple draft sources collapse to a count with per-source opening/removal when expanded.

Reuse MailReader for both the list reading view and the native auxiliary pane. The central agent retains its draft and selected model while exact mail originals can be switched in the right pane. Answer source actions open that same pane; attachment citations retain the native document reader. MailSourcePane revalidates hashes and guards late reads during switching. This reuses the existing source/approval pipeline and React/CX controls; no new retrieval or UI dependency was introduced. Gmail is a reference for scanning and navigation, not a copied UI or a claim of Gmail account/HTML rendering support.

Validation: 101 isolated Electron rendering states passed, including 47 synthetic messages exercising pagination, cross-page reader navigation, selection across pages, failed-source atomicity, no automatic send, exact references in the submitted request, draft/selection/page/scroll restoration and narrow reader/list transitions. Screenshots: verification/all-surfaces/mail-flow-{list,reader,selected,ai,reader-narrow,list-narrow}.png. These are production components rendered in Electron with clearly synthetic mail/provider data, not real-company-account or model-quality evidence.

Final checks: shared UI completed 31 checks (including disabled-feature skip records), focused search/draft tests passed 4/4, and Electron build/design checks passed. Two existing UI assertions now wait for responsive sidebar dismissal and the scheduled composer-focus frame before interaction/assertion. Interactive review is available through scripts/preview-mail-workflow.mjs using a separate temporary profile and 47 synthetic messages; it does not change the user's open app or authenticate an account.

## Real mailbox and provider walkthrough (2026-10-12)

The default Electron profile, rather than the synthetic preview, contained 21 previously collected real messages. With the user's ChatGPT reconnection, an actual sender search returned five messages. Two explicitly selected messages were attached together, sent to the current GPT-6.1-Sol model, and produced a completed response with two source citations. Clicking a citation reopened the corresponding original in the right pane. The app reported 42 seconds for this run. This verifies this real two-message path, not general model accuracy. After the user separately reconnected mail, the real background intake/organization counts advanced and the saved-at timestamp updated.

The walkthrough exposed long tracking URLs, invisible padding and excess blank lines obscuring the content. The display preview now removes URL/padding noise and uses the opening body for sender-only searches, while original indexing, bodies, hashes and model evidence remain unchanged. The reader collapses blank lines and renders explicit HTTP links with domain labels and original destinations; it never renders mail HTML or loads external images. The existing original-mail disclosure retains the exact text and download. Reuse the shared reader in both mail views. This adopts progressive disclosure and plain-text link rendering without a new dependency.

Git changes uses its existing icon and accessible name/tooltip in both the navigation rail and auxiliary header. History retains its distinct name. Mail spacing, typography and popup shadow now use shared CX/Nubi tokens; the design checker also covers the density stylesheet. The disconnected AI screen shows preserved mail evidence so reconnecting does not appear to discard the selection.

Validation: seven search/presentation tests and eleven existing mail intake tests passed. All 103 isolated Electron render states passed, including reconnect with two retained sources, exact original link destinations, raw-text availability, icon-only Git navigation, narrow screens and 200% text. These regression fixtures remain separate from the real mailbox/model observations above.

A further real query (`LinkedIn RAG`) exposed two false positives: tracking-URL parameters and the substring RAG in Storage. The search projection now masks URL query/fragment text before chunking (preserving original offsets), except when the user explicitly searches an HTTP URL. Short Latin terms require ASCII word boundaries while Korean adjacency such as AI업무 remains valid. A read-only replay against the same 26 real indexed messages reduced the query from three results to the one body that contains the requested RAG content; original source hashes were retained. Nine focused tests passed after this correction. No personal mail body or credentials were copied into repository evidence.

Final Electron build and the expanded design check passed. Native host regression passed 14 checks. The active app's renderer was reloaded, and real Gmail/ChatGPT connections remained active. The real answer and reformatted source body were visually inspected in the app. The search runtime correction is in the built application but requires the next app restart; the running worker was deliberately not restarted because its authentication is session-only. The remaining background attention item is an unsupported attachment format (`document_format`), not a failed selected-mail AI response. Pending collection follows the existing server polling interval.

## Restart verification and image attachment preview (2026-10-12)

With the user's explicit restart request, rebuilt and gracefully restarted the normal Electron profile. The native UI searched 36 actual stored messages for `LinkedIn RAG` and returned exactly the one relevant body, with both pagination arrows disabled. This supersedes the prior pending-restart limitation. Existing saved conversations remained available. Short Latin highlight boundaries now match retrieval boundaries; the native reader no longer highlights `is` inside `Disclaimer` or `visit`.

The remaining attachment was a 34,238-byte JPEG named `image001.jpg` in a hotel notification. Direct visual inspection identified a membership promotion banner. Added a bounded local raster preview to the existing attachment reader, reusing the verified original bytes, source hash and attachment hash. The actual native app displayed this image in the right pane. SVG/HTML are not raster previews. No OCR, provider upload or new dependency was introduced. Image preview does not mark attachment text as read, clear the attention record, or enable a text-only AI question for unseen image content; the UI explains that coverage. The original download action remains.

Validation: 11 focused search, preview and attachment tests passed, including stale source, changed bytes, SVG exclusion and refusal to submit unread image text. Electron build and token checks passed; 103 isolated screen checks passed before the final highlight-only adjustment, which was verified in the real reader afterward. The restarted app still requires mail and model reconnection, requested from the user; stored-mail search and image preview were verified without login. New collection and another real-model response after this restart are not claimed.

## Composer controls inside the input (2026-10-12)

User feedback supersedes the earlier outside-footer layout. The model trigger again uses the existing light-blue surface and deep-blue text. Model, reasoning, approval, context ring and send/stop are inside the same input border; narrow layouts wrap within that surface while retaining model and approval names. Reuse NubiComposerBar, ApprovalModeControl and ContextMeter with their existing behavior; no provider/authentication or approval mode change. No new package or color token is required.

Electron renderer build and design check passed. The 103-state screen regression now also checks model background color, approval/context containment and non-overlapping composer buttons at wide and narrow widths. Open popup contents are audited separately from the input row. Reloaded the real application renderer and visually verified the input. Opened and closed approval and context controls, including Escape focus return, without changing approval policy or sending a message.

## OpenWiki context for selected mail and compact composer (2026-10-12)

Audit found that project concept questions already advertise ask_openwiki first and mail search includes personal Wiki notes. However, read_personal_mail returned originals and attachment text without the corresponding Wiki note. The agent now explicitly requests that exact mail's existing OpenWiki note, with source ID/hash, note hash, state (current, edited, pending, missing, unavailable) and a 12,000-character coverage limit. Missing or unsafe notes do not prevent original-source reading. The prompt treats notes as supporting context and verifies against originals; selected-mail-only scope remains narrow. Direct attachment questions receive the same context. Existing OpenWiki storage/read and project research are reused, without adding a retriever, package or unnecessary Wiki generation call. No claim that every model follows guidance or that every question has a Wiki is made.

Real stored-mail readback: two saved mail sources returned current OpenWiki notes of 885 and 870 characters with matching source hashes. No mail body or private note is copied here. Scripted provider tests confirm the actual agent tool response contains Wiki context and original citations, and direct attachment model input includes both the document and corresponding notes. These are not live provider completions. Five new mail knowledge tests, two image tests, thirteen existing project Wiki tests and six search tests passed.

Composer rows now start at one, textarea is block-level, minimum empty input is 36px, outer vertical padding uses the shared 8px token, and the nested follow-up form no longer duplicates the dock margin. Input grows with text; labels, click targets, model color and inside controls remain. Build, token check and 103 screen checks passed. Empty composer measured 106px at 1280px viewport and 154px with wrapped tools at 440px; input itself remained 36px. Restarted the disconnected real app to apply worker and renderer changes. A new real-model response requires user reconnection and is not claimed.

After user reconnection, the real Electron app searched LinkedIn mail, selected two saved messages and sent an explicit question to the connected GPT-6.1-Sol. The response completed in 38.687 seconds with two original-source citations. Read-only inspection of this run's operation and result-review receipts confirmed exactly two completed read_personal_mail calls. Both evidence results contained the original mail and current OpenWiki notes (885 and 870 characters, matching source hashes, neither note truncated). The answer distinguished information present only in a title/Wiki note from content actually available in the original body. Clicking its second citation opened the corresponding original in the right pane. This verifies this specific live two-mail path, not general model accuracy or a fresh project-Wiki research run. No private mail body, note or credential was copied into repository evidence.

The real screenshot also confirmed the blue model trigger and approval/context controls inside the compact composer. The mailbox status still displayed connection required, so this run establishes stored-mail retrieval and a live AI answer, not newly received mail after the restart. The user may continue in the open app without another restart.

## Mail header hierarchy and integrated actions (2026-10-12)

Remove completed per-mail organization duration from the shared reader and the previous organization duration from the footer. Keep current running progress, saved counts and timestamps. Sender display names are bold, addresses and dates use the secondary text tokens, and the title occupies its own full-width heading. To/CC are visible definition rows when present rather than an accordion; absent CC creates no empty row. The original source data and download are unchanged.

Group the AI question entry with pin, tag and download in one understated toolbar between envelope and body. Use the short visible name AI에 질문, retaining its exact-mail accessible name, original evidence binding and explicit-send behavior. Familiar utilities show icons with accessible names/tooltips. Reuse MailReader in the mail list and source pane, shared CX tokens, and existing controls; no new dependency or mail-body rewriting is introduced.

Renderer build, design check and all 103 isolated Electron screen checks passed. Native renderer reload retained the connected GPT-6.1-Sol account. Opening a citation from the existing real two-mail answer displayed the revised header, visible recipient and integrated toolbar in the right source pane, with no organization-time label. The actual screen was visually reviewed; no new mail was sent or AI request made for this presentation change.

## Provider identity and composer legibility (2026-10-12)

The user's clarification supersedes the uniform blue model button: reuse the exact provider selection surface tokens for AI Pro, ChatGPT and FabriX, including hover/expanded states, while retaining the original provider icon and model name. The existing shared automation glyph supplies the requested lightning symbol for reasoning; its selected effort remains visible. No new asset or dependency was introduced.

Restore the context ring to its native 40px size with caption-size, dark, bold numerals and a 44px control. The previous 24px scaling made the SVG number too small. Preserve actual/estimated usage semantics, detailed popup, focus and approval behavior. Place team workspace beside the other upper navigation tools, before Settings, and restore the full Nubi Workspace Beta product title, including narrow layouts.

Electron renderer build and design check passed. All 103 isolated screen checks passed, including 440px layouts and existing large-text cases; composer checks now assert the native ring size and readable numeral font, plus non-overlap and provider surface presence. The real app was reloaded without restarting its worker: ChatGPT remained connected, the prior real-mail answer reopened, and the context popup showed estimated 8% (21,740 / 272,000 tokens). The actual screen confirmed provider styling, lightning glyph, upper team navigation and restored title. This UI-only follow-up made no additional model request.
