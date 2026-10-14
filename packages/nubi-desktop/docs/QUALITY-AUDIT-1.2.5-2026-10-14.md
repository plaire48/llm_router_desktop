# 누비 Workspace 1.2.5 품질 감사

2026-10-14. 현재 소스와 최신 Windows 빌드를 구분해 검사했다. 제품 구현과 기존 검사 소스는 수정하지 않았다.

**판정: 기본 기능 회귀는 통과했으나, 같은 번호 수정판 업데이트와 Wiki 재생성의 원본 보존 문제가 있어 전체 정상으로 승인할 수 없다. 캡처 키보드 접근, 보안 의존성 유지보수, 검사/안내 갱신도 필요하다. 사내 실서비스 품질은 미측정이다.**

## 버전과 검사 대상

- package.json, electron-app/package.json은 모두 1.2.5다. 같은 번호의 설치본이 3개 있으므로 설치 파일 해시로 구분해야 한다.
- 현재 로컬 소스의 최초 감사 해시: `887d27525b0d576181cc658ffb8dcf84b004d0ad52c89ec767c576b9e0481e17` (검사/화면/런타임과 기존 bundle 입력 1,045개 파일). 감사 전후 해시 변경 0개.
- 새로 빌드한 실제 bundle 입력 686개 전부가 최신 배포 커밋 `5810c1c11ae326a936c962b666831c06d398b7d8`의 Git blob과 일치한다. 원격 tree는 truncated=false다.
- 로컬 Git HEAD는 오래된 Router 커밋이고 Desktop은 untracked다. HEAD만으로 버전을 판단하지 않고 파일 내용을 비교했다.
- 모델 평가용 runtime candidateIdentity: `f24c5e9d1790bd29815787626b8c03f159aeafafc19e0dcfcf0ce7043a2ff20e` (699개 파일). 전체 감사 해시와 범위가 다르다.

| Windows 실행 | 상태 | 설치 파일 SHA-256 |
|---|---|---|
| [38547888136](https://github.com/plaire48/llm_router_desktop/actions/runs/38547888136) 최초 | CI 성공, 공개 릴리즈 | `09411dcc978c743b7ad2e10724af6881a0f2cc9d9d31a3c64fc601dba7e9bf92` |
| [38553668765](https://github.com/plaire48/llm_router_desktop/actions/runs/38553668765) 다시 올림 | CI 성공, 초안 | `1240c771f302578a07299ceb27aa2af6ba0f0126568448a4b921e7465721f454` |
| [38560111691](https://github.com/plaire48/llm_router_desktop/actions/runs/38560111691) 다시 올림 2 | CI 성공, 초안, 현재 소스와 일치 | `27617d92dcfbd6dc576bfd1160b587271ee1e082954049c0c5e739613f7b49bd` |

이번 감사는 사용자의 회사 PC에 어느 해시가 설치됐는지와 사내 nuri/latest 배포 여부까지 확인하지 못했다. 초안의 CI 성공은 공개나 사내 배포 성공을 뜻하지 않는다. EXE를 이 Mac에 설치하지 않았다. GitHub에 있는 검사 JSON 8개는 내려받은 bytes의 SHA-256이 각 asset digest와 일치한다.

## 이번 실행 결과

- 로컬 macOS 15.6 arm64, Node 25.4.0, Electron 42.11.10, Chrome/Playwright. 합성 프로젝트와 격리 저장소를 사용했다.
- npm test: **1,226개 중 1,030 통과, 실패 0, 건너뜀 196**. A2A 비활성 19, Computer Use 비활성 176, 이 Mac의 실제 Windows PowerShell 검사 1개다. 건너뜀을 통과로 계산하지 않는다.
- design:check, 초기화 전 참조 322개 파일, 아이콘 70개 및 Electron 빌드 통과.
- 37개 검사 명령: **32 통과, 5 실패**. 이 수치는 검사 실행 결과이며 제품 정확도/사용자 작업 성공률이 아니다. 원래 실패를 보존했다.
- 전체 화면 115개 및 짧은 창/확대 모달 검사 통과. 실제 앱 이미지도 별도로 검토했다.
- 실제 Electron에서 제안 → 승인 전 원본 보존 → 비교 → 반영 → 저장 readback → Git 반영, 모델 장애와 재개, 질문 응답, 스킬 등록/사용/재시작 복원, 프로젝트 전환/초안/미저장 파일 보호, worker 장애/재시작, 브라우저 팝업을 검사했다. 모델은 loopback 합성 모델이다.
- 새 캡처 UI: Esc 취소, 실제 창의 280×180 영역 crop, 미리보기, 3장 제한을 통과했다. 아래 키보드 초점 문제는 별도로 실패했다.

## 재현된 문제와 우선순위

### Q01. Wiki 재생성 전에 기존 자료를 먼저 삭제함 — 높음

**재현:** 임시 일반 폴더에 사람이 작성한 openwiki/home.md를 만들고 모델 연결을 끊은 뒤 실제 ProjectService의 wikiInitialization({action:"reset"})를 호출했다. 기존 파일은 ENOENT, 새 작업은 waiting_model이었다. 실제 사용자 폴더는 사용하지 않았다.
**원인:** `runtime/desktop-features.mjs:41-49`에서 모델/Git/자료 준비 확인과 생성 성공보다 `rm(openwiki)`가 먼저 실행된다. 사용자는 삭제를 선택했으나 “다시 만들기”가 가능한지도 확인하지 못한 상태로 자료를 잃으며 이 경로에 복구 사본이 없다. 모델 오류 중 전 과정의 UI와 NASCA는 이 재현 범위가 아니다.
**수정 계약:** 모델/실행기/소스/용량과 미저장 Wiki를 먼저 확인한다. 기존 Wiki의 해시를 고정하고 복구 가능한 상태로 보존한 뒤 격리된 새 결과가 검증됐을 때 명시적인 교체로 이어간다. 사람의 동시 편집, 취소, 생성 실패, 프로젝트 전환 시 원본/복구 수단을 유지한다.
**통과 조건:** 모델 없음, Git 없음, 생성 오류, 취소, 동시 편집의 각 경우에 기존 파일이 보존되거나 확인 가능한 복구 사본이 남고 실패를 완료로 표시하지 않는다.

### Q02. 같은 1.2.5 수정판을 자동 업데이트로 받을 수 없음 — 높음

**재현:** 현재 버전 1.2.5인 실제 WorkspaceUpdater에 다른 asset/hash를 가진 합성 1.2.5 manifest를 제공했다. 결과는 current였고 다운로드는 update_not_ready였다. 3개의 실제 설치 자산이 서로 다른 해시인 것도 확인했다.
**원인:** `electron-app/workspace-updater.cjs:7,29,35`는 semver 세 숫자만 비교한다. 기존 1.2.5는 같은 번호의 후속 수정판에 업데이트 아이콘이 나오지 않고 앱에서 다운로드할 수 없다. 사내 channel을 후속 파일로 바꿔도 버전이 같으면 이 조건에 걸린다. 수동 EXE 설치는 별개다.
**수정 계약:** 후속 수정판은 증가한 버전으로 배포하는 방법이 가장 작고 명확하다. 동일 번호 유지가 제품 요구라면 manifest/앱 metadata에 검증 가능한 build revision을 추가하고 downgrade 방지, hash/서명 검증 및 설치/재실행까지 별도 계약으로 정한다.
**통과 조건:** 최초 1.2.5 사용자에게 실제 후속 후보가 표시되고 검증된 파일로 업데이트/재실행되며 오래된/같은 빌드의 불필요한 설치는 없다.

### Q03. 캡처 영역 선택 중 키보드 초점이 뒤로 샘 — 중간

**재현:** 실제 Electron의 화면 캡처 dialog를 연 뒤 Tab을 누르자 뒤쪽 알림 닫기 BUTTON이 초점을 받았다. focusInside=false였다. Esc와 마우스 선택 자체는 정상이다.
**원인:** `ui/CaptureOverlay.jsx`는 dialog 역할만 선언하고 modal 초점 이동/트랩/배경 inert/초점 복귀를 구현하지 않는다. 기존 일반 모달 수명주기를 재사용하지 않는 별도 body portal이다.
**수정 계약과 통과 조건:** 공통 모달의 초점/배경 차단을 재사용한다. Tab/Shift+Tab이 선택 UI 안에 머물고 키보드 전체 창 선택/취소가 가능해야 한다. 취소/완료 뒤 원래 캡처 버튼 또는 입력칸으로 복귀하며 초안과 캡처를 보존한다.

### Q04. 440px 설정 모달이 원래 설정 버튼을 덮음 — 낮음, UX 제한

1280px에서는 같은 설정 아이콘 재클릭 닫기가 통과했고 440px에서는 닫히지 않았다. 화면 캡처에서 모달이 원래 버튼 좌표를 덮는 것을 확인했다. `useModalDismissalPolicy.js`는 클릭이 dialog 내부 좌표인 경우 trigger toggle을 실행하지 않는다. X/Escape는 다른 모달 검사에서 정상이다.
이 위치의 재클릭도 반드시 지원할지 UX 계약을 확정한 뒤 가시적인 trigger를 유지하거나 기대를 명시해야 한다. 전체 설정 사용 불가 또는 X/Escape 고장으로 확대하지 않는다.

### Q05. 실행 의존성의 알려진 보안 항목 — 중간, 공격 성공은 미재현

`npm audit --omit=dev`: **moderate 4, low 2, high 0, critical 0**. 이는 의존성 항목 6개이며 독립된 공격/CVE 6개라는 뜻이 아니다. DOMPurify/Monaco, ExcelJS/UUID, tedious/sprintf-js가 포함된다.
- DOMPurify 3.4.15의 IN_PLACE 관련 두 advisory는 3.4.16 패치를 명시한다. 근거: [hook 제거 advisory](https://github.com/advisories/GHSA-p98j-92pf-mc4p), [root 재파싱 advisory](https://github.com/advisories/GHSA-6688-9rhm-gjv2). 확인한 메일/Talk/Monaco 호출에는 IN_PLACE 사용을 찾지 못했으며 메일 iframe도 script-src none이다. 현재 Workspace에서 실행 가능한 XSS를 확인한 것은 아니다.
- sprintf-js의 형식 정밀도 DoS는 tedious를 통해 표시된다. 검토한 tedious formatter는 고정 형식 문자열을 사용한다. 외부 입력이 format string을 직접 제어하는 경로는 이 감사에서 재현하지 않았다.
- ExcelJS 내부 UUID 버전과 v3/v5/v6 호출/사용자 제공 buffer 조건도 구분해야 한다. npm의 제안된 major downgrade를 무조건 적용하지 않는다.
기존 라이브러리의 지원 API/라이선스를 유지하는 패치/override와 재번들 후보를 검토하고 sanitizer, Office 추출, DB 연결 회귀를 확인하는 후속 명세가 필요하다. 새 프레임워크를 도입할 근거는 없다.

### Q06. 검사와 안내가 현재 구현을 따라가지 못함 — 중간

원래 실패 5개의 분류는 다음과 같다. 재검사에서 바꾼 내용은 임시 검사 사본에만 적용했다. 원래 검사와 성적은 변경하지 않았다.

| 실패 명령 | 확인한 원인 | 진단/재검사 결론 |
|---|---|---|
| check-claude-ui | --live 또는 --connect-only 없이 실행하면 검사 자체가 거부함 | 호출 조건 문제. Claude CLI 2.1.296은 설치돼 있으나 공식 auth status는 loggedIn=false. CLI 연결/응답 품질은 미측정 |
| check-chat-proposals-ui | fixture의 mutable initial snapshot 때문에 갱신을 놓침. nubi-diff-counts가 nubi-proposal-counts로 변경됨. 옛 최대 너비 1121 기준 | 불변 snapshot/현재 selector로 제안 표시, 취소, 미확정 보존과 정렬/overflow 조건까지 진행. 마지막 옛 최대 너비 assertion 실패를 유지함. 현재 CSS는 clamp(700px,94cqi,1480px)로 달라졌으므로 기대 규격을 명시해 검사 갱신 필요 |
| check-mail-portal-login | 옛 persist:nubi-mail-portal와 https 주소를 가정. 현재 company 세션과 기본 http 주소/로그인 진입 변경 | 회사 주소를 전부 example.invalid로 바꾸고 동일 세션에 모의 응답을 등록한 오프라인 재검사에서 POST/opener/연결/소유 탭 정리 통과. 배경 root 요청은 3회였으며 옛 정확히 2회 조건도 불일치. 실회사 SSO는 미검증 |
| check-message-footer | 초기 전송의 표시가 nubi-launch-progress/진행에서 outgoing/시작하는 중으로 변경됨 | 현재 선택자와 불변 snapshot의 임시 검사에서 1280/440/360px 시간/복사 정렬, 재생성, 시작 대기, 다른 대화 전송 모두 통과 |
| check-interaction-controls | 1280px 통과 뒤 440px 원래 설정 trigger가 모달에 가려짐 | Q04의 실제 화면 제한. 37개 전체 통과로 표시하지 않음 |

첨부 읽기는 `runtime/beta-features.mjs`에서 true이며 Windows package 보고서도 attachmentReaders=packaged다. 그러나 AGENTS.md와 일부 WINDOWS-RELEASE/README에는 여전히 비활성 또는 1.1.1/1.2.0 설명이 있다. 지원 범위/버전/검사 책임을 현재 결정과 일치시켜야 한다. 문서만 보고 현재 기능을 비활성이라고 판정해서는 안 된다.

## 확인한 정상 기능과 미검증 경계

| 기능 | 이번 증거 | 남은 경계 |
|---|---|---|
| 파일/편집/저장/검색/Git/커밋 | 실제 Mac Electron과 최신 Windows 설치본 smoke 보고서 | 회사 프로젝트와 사용자 정책은 별도 |
| 대화/계획/승인/반영/복구/질문/스킬 | 실제 Electron + 합성 모델, readback/호스트 기록 | AI Pro/ChatGPT/FabriX/Claude 실모델 성능은 별도 |
| 프로젝트 복원/초안/미저장 보호 | Mac 재실행/전환, Windows 설치본 fixture 보고서 | 사용자의 기존 회사 저장소/대용량 데이터는 별도 |
| 화면 캡처 | 실제 창 crop/미리보기/3장 제한 정상, 초점 실패 | 이미지 모델이 인증 카탈로그에 있어야 분석 가능. 실제 이미지 답변 정확도 미측정 |
| 메일/Talk/문의/위키 공유 | 합성 상태 UI와 오프라인 포털 protocol, 소스 계약 | 회사 SSO/메일 API/실제 Talk/문의 읽기 및 쓰기, GHES 권한은 미검증 |
| Office 첨부 | 기능 flag 활성, Windows 패키지에 읽기 파일 존재, 합성/native contract 검사 | 실제 Windows Office 2016/NASCA 읽기와 파일 내용 정확도 미검증 |
| A2A/외부 컴퓨터 조작 | release flag false 및 노출/실행 거부 정상 | 의도적 미지원. 고장이나 통과 기능으로 세지 않음 |
| 설치/업그레이드/재설치/제거/재실행 | 최신 CI JSON은 모두 true, bundled Git/시스템 Git 없음도 확인 | Windows Server 2025 Datacenter, unsigned(NotSigned). 회사 Windows 11/실사용 DPI/UAC/보안 정책은 미검증 |
| 내부 업데이트 channel | 해시/자산/진행/작업 보호 소스 검사 | nuri/latest의 실제 최신 상태와 회사 PC 자동 설치 미검증. Q02 존재 |

## 실모델 결과를 이번 버전에 재사용하지 않은 이유

기존 평가 세션은 사용할 수 없었고, 공식 Claude CLI auth status가 loggedIn=false였다. 인증 저장소/쿠키를 가져오지 않았으며 모델을 임의로 정해 새 실계정 로그인이나 장시간 평가를 시작하지 않았다.
이전 easy80 보고서(79/80, 1회)의 candidate hash는 dc65df78…이고 이번 runtime hash와 다르다. 중간 난이도 최종 비교도 전체 40문항 중 12문항만 실행한 별도 후보이고 28문항은 미실행이었다. 그 부분 성적과 보정 점수를 이번 1.2.5의 전체 품질이나 3회 반복 성공률로 표시하지 않는다.
실모델 후속 검사는 실제 사용하는 제공자/모델의 전체 카탈로그 한도를 그대로 쓰고, 고정 과제를 각 3회 수행한다. 답변 전달, 독립 정답/원문/실행 영수증, 3회 모두 성공, p50/p95 및 중단/미실행을 분리한다. 회사 메일/문서는 별도 승인된 범위에서 재현해야 한다.

## 선택한 검증 방법과 다음 순서

- [Anthropic agent evals](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents): 고정 과제, trace와 최종 환경 상태, 반복 신뢰도를 분리하는 공식 방법론을 재확인했다. 이번 결과는 공식 인증이나 공개 benchmark 순위가 아니다.
- [Playwright assertions](https://playwright.dev/docs/test-assertions): 실제 렌더링/상태 변화와 재시도 assertion을 재사용했다. 고정 대기나 화면만으로 성공을 만들지 않았다.
- 기존 Pi, SQLite, OpenWiki, 실제 ProjectService/Updater, 기존 합성 provider/protocol을 재사용했고 새 실행/평가 프레임워크나 의존성을 도입하지 않았다.
- 후속 수정 1순위는 Q01 원본 복구와 Q02 버전/빌드 식별이다. 다음은 Q03 모달 초점과 Q06 실제 계약에 맞춘 검사/안내 정리, 보안 패치 후보 재검증이다.
- 해당 수정 뒤 전체 자동/실제 앱 검사와 Windows 설치/업데이트를 같은 후보로 검증하고, 회사 Windows 11의 로그인 → 메일/Talk/문의 → Wiki → 모델 응답 → 재시작/업데이트를 확인해야 한다.

## 원본 검사 명령과 로그

| 명령 | 원래 결과 | 시간(초) | 로그 |
|---|---|---:|---|
| npm test | passed | 226.7 | [log](/Users/ganadi/Documents/llm_router/packages/nubi-desktop/verification/quality-audit-1.2.5-2026-10-14/unit.log) |
| npm run design:check | passed | 0.2 | [log](/Users/ganadi/Documents/llm_router/packages/nubi-desktop/verification/quality-audit-1.2.5-2026-10-14/design.log) |
| npm run build:electron | passed | 4.66 | [log](/Users/ganadi/Documents/llm_router/packages/nubi-desktop/verification/quality-audit-1.2.5-2026-10-14/build.log) |
| node scripts/check-electron-shell.mjs | passed | 17.84 | [log](/Users/ganadi/Documents/llm_router/packages/nubi-desktop/verification/quality-audit-1.2.5-2026-10-14/check-electron-shell.log) |
| node scripts/check-electron-agent.mjs | passed | 14.65 | [log](/Users/ganadi/Documents/llm_router/packages/nubi-desktop/verification/quality-audit-1.2.5-2026-10-14/check-electron-agent.log) |
| node scripts/check-electron-skills.mjs | passed | 28.96 | [log](/Users/ganadi/Documents/llm_router/packages/nubi-desktop/verification/quality-audit-1.2.5-2026-10-14/check-electron-skills.log) |
| node scripts/check-electron-projects.mjs | passed | 10.63 | [log](/Users/ganadi/Documents/llm_router/packages/nubi-desktop/verification/quality-audit-1.2.5-2026-10-14/check-electron-projects.log) |
| node scripts/check-project-direct-navigation.mjs | passed | 4.77 | [log](/Users/ganadi/Documents/llm_router/packages/nubi-desktop/verification/quality-audit-1.2.5-2026-10-14/check-project-direct-navigation.log) |
| node scripts/check-electron-wiki-library.mjs | passed | 4.98 | [log](/Users/ganadi/Documents/llm_router/packages/nubi-desktop/verification/quality-audit-1.2.5-2026-10-14/check-electron-wiki-library.log) |
| node scripts/check-electron-lifecycle.mjs | passed | 16.5 | [log](/Users/ganadi/Documents/llm_router/packages/nubi-desktop/verification/quality-audit-1.2.5-2026-10-14/check-electron-lifecycle.log) |
| node scripts/check-live-web.mjs | passed | 7.5 | [log](/Users/ganadi/Documents/llm_router/packages/nubi-desktop/verification/quality-audit-1.2.5-2026-10-14/check-live-web.log) |
| node scripts/check-shared-ui.mjs | passed | 46.28 | [log](/Users/ganadi/Documents/llm_router/packages/nubi-desktop/verification/quality-audit-1.2.5-2026-10-14/check-shared-ui.log) |
| node scripts/check-form-clarity.mjs | passed | 1.76 | [log](/Users/ganadi/Documents/llm_router/packages/nubi-desktop/verification/quality-audit-1.2.5-2026-10-14/check-form-clarity.log) |
| node scripts/check-mail-ui.mjs | passed | 2.44 | [log](/Users/ganadi/Documents/llm_router/packages/nubi-desktop/verification/quality-audit-1.2.5-2026-10-14/check-mail-ui.log) |
| node scripts/check-mail-background-ui.mjs | passed | 1.87 | [log](/Users/ganadi/Documents/llm_router/packages/nubi-desktop/verification/quality-audit-1.2.5-2026-10-14/check-mail-background-ui.log) |
| node scripts/check-modals.mjs | passed | 44.53 | [log](/Users/ganadi/Documents/llm_router/packages/nubi-desktop/verification/quality-audit-1.2.5-2026-10-14/check-modals.log) |
| node scripts/check-all-surfaces.mjs | passed | 32.53 | [log](/Users/ganadi/Documents/llm_router/packages/nubi-desktop/verification/quality-audit-1.2.5-2026-10-14/check-all-surfaces.log) |
| node scripts/check-claude-ui.mjs | failed | 0.26 | [log](/Users/ganadi/Documents/llm_router/packages/nubi-desktop/verification/quality-audit-1.2.5-2026-10-14/check-claude-ui.log) |
| node scripts/check-chat-send.mjs | passed | 8.21 | [log](/Users/ganadi/Documents/llm_router/packages/nubi-desktop/verification/quality-audit-1.2.5-2026-10-14/check-chat-send.log) |
| node scripts/check-chat-proposals-ui.mjs | failed | 48.23 | [log](/Users/ganadi/Documents/llm_router/packages/nubi-desktop/verification/quality-audit-1.2.5-2026-10-14/check-chat-proposals-ui.log) |
| node scripts/check-conversation-scroll.mjs | passed | 1.39 | [log](/Users/ganadi/Documents/llm_router/packages/nubi-desktop/verification/quality-audit-1.2.5-2026-10-14/check-conversation-scroll.log) |
| node scripts/check-review-failure-ui.mjs | passed | 2.11 | [log](/Users/ganadi/Documents/llm_router/packages/nubi-desktop/verification/quality-audit-1.2.5-2026-10-14/check-review-failure-ui.log) |
| node scripts/check-reasoning-ui.mjs | passed | 6.49 | [log](/Users/ganadi/Documents/llm_router/packages/nubi-desktop/verification/quality-audit-1.2.5-2026-10-14/check-reasoning-ui.log) |
| node scripts/check-agent-input.mjs | passed | 3.28 | [log](/Users/ganadi/Documents/llm_router/packages/nubi-desktop/verification/quality-audit-1.2.5-2026-10-14/check-agent-input.log) |
| node scripts/check-release-flow-ui.mjs | passed | 4.03 | [log](/Users/ganadi/Documents/llm_router/packages/nubi-desktop/verification/quality-audit-1.2.5-2026-10-14/check-release-flow-ui.log) |
| node scripts/check-browser-popup.mjs | passed | 1.72 | [log](/Users/ganadi/Documents/llm_router/packages/nubi-desktop/verification/quality-audit-1.2.5-2026-10-14/check-browser-popup.log) |
| node scripts/check-mail-portal-login.mjs | failed | 16.07 | [log](/Users/ganadi/Documents/llm_router/packages/nubi-desktop/verification/quality-audit-1.2.5-2026-10-14/check-mail-portal-login.log) |
| node scripts/check-wiki-portal-ui.mjs | passed | 2.89 | [log](/Users/ganadi/Documents/llm_router/packages/nubi-desktop/verification/quality-audit-1.2.5-2026-10-14/check-wiki-portal-ui.log) |
| node scripts/check-wiki-repository-ui.mjs | passed | 4.77 | [log](/Users/ganadi/Documents/llm_router/packages/nubi-desktop/verification/quality-audit-1.2.5-2026-10-14/check-wiki-repository-ui.log) |
| node scripts/check-git-history-ui.mjs | passed | 5.59 | [log](/Users/ganadi/Documents/llm_router/packages/nubi-desktop/verification/quality-audit-1.2.5-2026-10-14/check-git-history-ui.log) |
| node scripts/check-source-highlight.mjs | passed | 4.89 | [log](/Users/ganadi/Documents/llm_router/packages/nubi-desktop/verification/quality-audit-1.2.5-2026-10-14/check-source-highlight.log) |
| node scripts/check-dialog-bounds.mjs | passed | 3.77 | [log](/Users/ganadi/Documents/llm_router/packages/nubi-desktop/verification/quality-audit-1.2.5-2026-10-14/check-dialog-bounds.log) |
| node scripts/check-community-wiki-ui.mjs | passed | 6.35 | [log](/Users/ganadi/Documents/llm_router/packages/nubi-desktop/verification/quality-audit-1.2.5-2026-10-14/check-community-wiki-ui.log) |
| node scripts/check-profile-wiki-ui.mjs | passed | 4.99 | [log](/Users/ganadi/Documents/llm_router/packages/nubi-desktop/verification/quality-audit-1.2.5-2026-10-14/check-profile-wiki-ui.log) |
| node scripts/check-wiki-inventory.mjs | passed | 1.64 | [log](/Users/ganadi/Documents/llm_router/packages/nubi-desktop/verification/quality-audit-1.2.5-2026-10-14/check-wiki-inventory.log) |
| node scripts/check-message-footer.mjs | failed | 46.53 | [log](/Users/ganadi/Documents/llm_router/packages/nubi-desktop/verification/quality-audit-1.2.5-2026-10-14/check-message-footer.log) |
| node scripts/check-interaction-controls.mjs | failed | 44.87 | [log](/Users/ganadi/Documents/llm_router/packages/nubi-desktop/verification/quality-audit-1.2.5-2026-10-14/check-interaction-controls.log) |

추가 재현과 source/Windows/보안 JSON은 같은 evidence 폴더에 있다. `reproduction/`에는 감사용 사본이 있으며 실제 회사 주소를 사용하지 않는 portal-offline.mjs를 포함한다. 임시 검사 수정의 의미와 원래 실패는 위 표대로 유지한다.

[전체 근거 파일](/Users/ganadi/Documents/llm_router/packages/nubi-desktop/verification/quality-audit-1.2.5-2026-10-14)
