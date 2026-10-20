# 사용량 전체 초기화 — 별도 지정 업로드

사용자 추가 요청으로 만든 기능이며 W3-UI/W4/S1 59파일과 별도다. 사용량 모달 하단의 **전체 초기화**를 누르면 AI Pro/ChatGPT/FabriX/Claude의 앱 내부 오늘/주간/전체 토큰, 호출과 비용 집계를 새로 시작한다. 계정 잔여 한도와 실제 청구, 인증과 대화 기록/개별 실행 영수증/컨텍스트 도넛은 유지한다.

SQLite 저장 성공 뒤에만 화면 집계를 교체한다. 저장 실패는 기존 값을 보존하고 다시 시도 안내를 표시한다. 초기화 전 시작한 호출의 늦은 완료는 새 집계에 합치지 않으며 진행 중인 작업을 취소하지 않는다. 이후 새 호출부터 집계한다. 오래된 사용량 폴링 응답이 초기화 값을 복원하지 않도록 revision을 구분한다. 공유 UsagePanel은 선택적 속성을 사용해 Desktop만 초기화를 제공한다.

## 파일 확인

Claude가 물은 agent.mjs, usage.mjs, desktop-usage.test.mjs, shared-ui-fixture.jsx, usage-reset.test.mjs는 이 과제다. **check-chatgpt-usage.mjs는 원상복구돼 mainaefa2e13과 git blob SHA가 같으므로 업로드에서 제외한다.** 실제 연결을 위해 UsagePanel.jsx/Workbench.jsx와 전용 화면 검사도 필요하다. 아래 소스/시험8개와 이 보고서1개만 지정한다. 현재9파일 모두 main에는 없는 변경이며 사용량 초기화 명세와 일치한다.

요청하신6파일의 대조표는 아래와 같다. 이6개만 업로드하면 버튼/호출 연결이 빠지므로 실제 지정 묶음은 위 설명대로9파일이다.6파일 감사 SHA는 `.superpowers/sdd/2026-10-20-usage-reset/requested-six-files.json`에, 실제9파일 SHA는 `upload-inputs.json`에 둔다.

| 요청 파일(Desktop 기준) | 역할 | 지정 업로드 |
|---|---|---|
|runtime/agent.mjs|초기화 API 연결|포함|
|runtime/usage.mjs|영구 집계 초기화와 늦은 응답 경계|포함|
|scripts/check-chatgpt-usage.mjs|기존 검사, main과 같은 바이트|제외|
|tests/desktop-usage.test.mjs|저장/실패 보존과 경계 회귀|포함|
|tests/shared-ui-fixture.jsx|사용량 초기화 화면의 합성 연결|포함|
|tests/usage-reset.test.mjs|API 회귀|포함|

```text
extensions/aipro-chat/src/UsagePanel.jsx
packages/nubi-desktop/runtime/usage.mjs
packages/nubi-desktop/runtime/agent.mjs
packages/nubi-desktop/ui/Workbench.jsx
packages/nubi-desktop/tests/desktop-usage.test.mjs
packages/nubi-desktop/tests/usage-reset.test.mjs
packages/nubi-desktop/tests/shared-ui-fixture.jsx
packages/nubi-desktop/scripts/check-usage-reset.mjs
docs/USAGE-RESET-2026-10-20.md
```

## 검증과 비용

실패 먼저: reset 메서드/API 부재와 화면 버튼 부재. 수정 뒤 집중4/4(새 회귀3), 로컬 wall1.157초, 실제 Windows/COM 네이티브 시험 추가0. 기존 회귀가 포함된 시간이며 CI 증분으로 환산하지 않는다. 전체 npm test2468개 중2268통과/200제외/실패0,586.682초. Electron 빌드/design/게이트 집합 통과. 기존 CJS import.meta 경고는 남는다. 최신 기준17차 CI unit16분19초/ui6분50초(전체16분24초, 미판정unit0/ui16)이며 초기화 변경의 CI 추가 후 소요는 아직 미측정이다. 이 과제는 fast 체인에 별도 명령을 추가하지 않았다.

전용 화면 검사1280/440/360 exit0: 실패 안내와 기존 값 보존, 오늘/전체0, 재진입과 잔여 한도75% 유지, 가로 넘침0. 합성 API/실제 Workbench 구성 검사이며 실계정/Windows 성적이 아니다. 기존 check-chatgpt-usage의 문맥 도넛23.2K 대기 사전 실패는 로그에 보존했고 해당 제품 로직/기대값은 바꾸지 않았다. 업로드는 Claude, 아직 미업로드.

캡처 [1280](../packages/nubi-desktop/verification/usage-reset/reset-1280.png), [440](../packages/nubi-desktop/verification/usage-reset/reset-440.png). SHA/동일 바이트 스냅숏: `.superpowers/sdd/2026-10-20-usage-reset/upload-inputs.json`. 원본 실패/통과 로그도 같은 폴더에 보존한다.

추가 재검증(문서 정정 뒤): 사용량4개와 Q3/게이트16개를 함께 실행해20/20, 실패0, wall3.216초. 새 시험 추가0/제품 코드 변경0이며 기존 시험의 재실행이다. 요청6파일 SHA는 변경5/동일1, 실제9파일 업로드 SHA와 스냅숏도 재대조했다. 문서 정정은 다음 지정 업로드에 포함하며 이번에 푸시하지 않는다.
