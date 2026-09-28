# 누비 for Excel 2016 — Windows 테스트판

Windows Excel 2016의 오른쪽 작업창에서 AI Pro에 요청하고 선택한 셀을 분석·수정하는 별도 Office 추가 기능입니다. Microsoft Copilot의 설치나 기본 모델 교체가 아닙니다. 최신 Microsoft 365용 `../office-copilot-aipro`와 별개로 동작합니다.

누비(`extensions/aipro-chat`)의 Pi 에이전트 실행기와 AI Pro JSON/SSE 응답 파서를 직접 재사용합니다. 뱁새·로고 PNG, `design/agent-deck.css` 테마와 캐릭터 모션도 원본에서 가져옵니다. 누비의 채팅·입력창·작업 과정·중지·새 대화·기록 이어가기 흐름을 Excel 2016 호환 화면으로 옮겼습니다. React 19와 Chrome 전용 저장소/브라우저 도구는 이식하지 않았으며 Excel용 도구 어댑터로 연결합니다.

## 가능한 작업

- 선택한 하나의 연속 범위 분석, 값 입력, 수식 입력
- 굵게, 배경색, 숫자 표시 형식 변경
- 요청 시점의 셀 내용을 다시 비교한 뒤 적용하고 값·수식·서식을 읽어서 확인
- AI Pro 브라우저 로그인 또는 AI Pro CLI의 Base URL·토큰·Model ID 직접 입력
- 누비의 순차 도구 실행: `read_selection` → `apply_changes` → 적용 결과 확인, 필요하면 `verify_selection`·`ask_user`
- 작업 과정 표시, 답변 스트리밍, 중지, 현재 창의 대화 기록과 초안 복원

최대 1,000셀·약 100KB, 변경 계획 하나당 20개 작업을 처리합니다. 한 요청의 실행 한도는 8회 모델 응답·12회 도구 실행·120초입니다. 대화 맥락은 최근 8개 메시지를 사용하며 기록은 현재 창에 최대 10개 대화만 유지합니다. 결과를 넣을 빈 셀도 선택 범위에 포함하세요. 차트·피벗·시트 생성·매크로·외부 참조 수식은 지원하지 않습니다. 값은 수식처럼 해석될 수 있는 문자열을 거부하고, 수식은 같은 시트만 참조하도록 제한합니다. 선택 범위 밖의 같은 시트 셀은 수식이 참조할 수 있습니다.

## Windows에서 사용

실제 Excel 2016과 회사 AI Pro에서의 실행은 아직 확인하지 않은 테스트판입니다. ExcelApi 1.1을 지원하는 Excel 2016, Node.js 22.19 이상을 실행할 수 있는 Windows, HTTPS localhost 추가 기능을 허용하는 회사 정책이 필요합니다. 구형 Windows에서 최신 Node.js 실행 가능 여부는 별도 확인이 필요합니다.

1. 배포 ZIP을 풀고 `Start-Excel-AIPro.cmd`를 실행합니다.
2. 처음 실행할 때 npm 의존성을 내려받고 Microsoft 개발 도구가 localhost 개발 인증서 신뢰 설정을 요청할 수 있습니다. 회사에서 허용한 PC에서 진행하세요.
3. Excel이 열리면 **삽입 → 내 추가 기능**에서 **누비 for Excel 2016**을 엽니다. 자동 등록이 제한되면 아래 수동 카탈로그 방법을 사용합니다.
4. 연결 설정에서 브라우저 로그인 또는 CLI 정보를 입력합니다. CLI 설정 저장은 실제 통신 성공을 뜻하지 않으며 첫 요청으로 확인합니다.
5. 셀을 선택하고 **분석만 / 셀 수정**을 고른 뒤 요청합니다. **셀 수정은 즉시 적용됩니다.** 중요한 파일은 복사본에서 시작하세요.

연결 서버는 Excel을 사용하는 동안 계속 실행되어야 합니다. 종료·등록 해제는 `Stop-Excel-AIPro.cmd`를 사용합니다. 개발 인증서 제거는 다른 Office 개발 프로젝트에 영향을 줄 수 있어 자동 수행하지 않습니다. 필요할 때 `npx office-addin-dev-certs uninstall`을 별도로 사용합니다.

자동 등록이 안 될 때는 `npm run dev-server`로 서버를 실행하고, `manifest.xml`을 회사에서 허용한 네트워크 공유 폴더 카탈로그에 배치한 뒤 Excel의 신뢰할 수 있는 추가 기능 카탈로그에 등록합니다. 이 방법은 Windows 파일 공유·Office 신뢰 센터 설정이 필요하므로 회사 정책에 맞춰 담당자와 진행하세요. 실행 파일 서명·MSI 설치·AppSource 등록·전사 배포는 이 테스트판 범위에 포함하지 않습니다.

## 연결과 데이터

```text
Excel 2016 작업창 (Office.js, ExcelApi 1.1)
  → 로컬 HTTPS 서버의 누비 Pi 실행기 (127.0.0.1:8790)
  ↔ AI Pro 도구 호출 / JSON·SSE 응답
  ↔ Excel 도구 어댑터 → 범위·충돌 검증 → 적용 → 결과 다시 읽기
```

선택한 셀의 값·수식과 요청만 AI Pro로 전송합니다. 서버는 인증값을 메모리에만 유지하며 로그나 파일로 저장하지 않습니다. 작업창 대화는 메모리에만 남습니다. 한 서버에 연결된 Excel 작업창은 동일한 AI Pro 연결 설정을 공유합니다. 기존 라우터·Chrome 확장·OpenWiki 인증 저장소는 가져오지 않습니다.

브라우저 로그인은 전용 임시 localhost 수신기와 `/auth/cli/login`을 사용합니다. callback의 Host·Origin(있을 때)·상태·일회성 사용을 확인하고 code를 `/auth/exchange`에 한 번 교환한 뒤 Bearer 토큰으로 `/api/models`를 읽습니다. callback 프로토콜에는 검증 가능한 별도 state/nonce 계약이 없어 해당 검증을 추가했다고 주장하지 않습니다. 토큰의 형태·만료 확인은 서명 검증이 아니며, 실제 모델 API가 인증을 판정합니다.

CLI 연결은 입력한 HTTPS Base URL에 `/chat/completions`를 붙이고 `User-Agent: AIPROCLI`를 사용합니다. 브라우저 SSO와 CLI 인증값은 섞지 않습니다. 기본 인증서 검증을 유지합니다. 사내 CA가 필요하면 실행 전 `NODE_EXTRA_CA_CERTS`를 회사 CA 파일 경로로 설정합니다.

## 호환성과 실패 처리

ExcelApi 1.1만 요구합니다. 클라이언트는 ES5로 변환한 뒤 구문 검사하고 필요한 표준 기능을 polyfill로 포함합니다. 스키마 검증의 동적 코드 생성도 비활성화했습니다. CX 0.5.4 CSS·토큰·로컬 Noto Sans KR을 사용하고 CSS 변수는 정적 값으로 변환합니다. 구형 웹뷰에서 폰트를 지원하지 않으면 맑은 고딕으로 표시합니다. 이 조치와 Chromium 합성 테스트는 실제 IE11/Excel 2016 호환성 증명이 아닙니다.

셀 내용이 바뀌었으면 적용을 거절합니다. Excel 쓰기는 트랜잭션이 아니므로 동기화 또는 결과 확인 실패 시 일부 변경이 남을 수 있습니다. 자동 재시도·자동 롤백은 하지 않으며 Excel 셀 상태를 먼저 확인하도록 표시합니다. 자동 저장이나 통합 문서 저장을 수행하지 않습니다.

## 소스 개발

저장소에서 공통 계획 검증·AI Pro 어댑터와 CX 자산을 재사용합니다.

```sh
cd packages/office-copilot-aipro && npm ci
cd ../../extensions/aipro-chat && npm ci
cd ../../packages/office-legacy-aipro && npm ci
npm test
npm run build
npm run design:check
npm run test:browser
npm run validate:manifest
npm run package
```

브라우저 검증에는 Playwright Chromium 설치(`npx playwright install chromium`)가 필요합니다. 이미 설치한 Chrome을 쓰려면 `PLAYWRIGHT_CHANNEL=chrome` 환경변수를 지정합니다. CX 스타일은 기존 사내 패키지의 이용 범위를 따릅니다. 번들에 포함된 외부 코드와 폰트의 라이선스는 `dist/web/licenses`에 보관합니다.

빌드 산출물은 `dist`, Windows 배포 ZIP은 `releases`에 생성됩니다. 배포 ZIP은 빌드된 서버·화면을 포함하므로 형제 패키지의 소스를 요구하지 않습니다. 개발용 `npm start`는 실제 Office 등록과 인증서 설정을 수행하므로 Windows 대상 PC에서만 실행하세요.

## 검증 범위

`verification/local-checks.json`은 mock Office.js·mock AI Pro를 사용하는 브라우저 검증 결과입니다. 단위/HTTP 테스트는 범위 위반, 셀 충돌, 부분 변경 안내, CLI 헤더, callback 일회성 교환과 취소·만료를 확인합니다. 실제 Windows 등록, 인증서 신뢰, 실제 Excel 2016 편집·저장·재진입, 회사 SSO·AI Pro 통신은 별도 실기기 확인이 남아 있습니다.

누비 Pi 실행기를 통한 순차 도구 호출과 실패 후 재실행 차단도 검사합니다. 기본 AI Pro 연결에 더해 선택한 실제 모델의 `tool_calls` 지원 확인이 필요합니다. 일부 모델이 도구를 호출하지 않으면 셀 수정이 수행되지 않을 수 있습니다. 첫 테스트는 작은 복사본에서 **머리글 서식 정리**로 진행하세요.

공식 기준: [Excel API 요구 사항](https://learn.microsoft.com/en-us/javascript/api/requirement-sets/excel/excel-api-requirement-sets), [요구 사항 선언](https://learn.microsoft.com/en-us/office/dev/add-ins/develop/specify-office-hosts-and-api-requirements), [Windows 공유 카탈로그](https://learn.microsoft.com/en-us/office/dev/add-ins/testing/create-a-network-shared-folder-catalog-for-task-pane-and-content-add-ins).
