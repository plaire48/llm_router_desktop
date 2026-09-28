# Office Copilot와 AI Pro 연동 검토

- 확인일: 2026-09-22
- 상태: `packages/office-copilot-aipro`에 Excel용 Copilot 스킬, AI Pro MCP 연결 서버, M365 패키저와 로컬 계약 테스트를 구현했다. 대상 Office 환경, 배포 채널, 인증 및 네트워크는 미확인. 테넌트 설치·실서비스·Excel 편집은 검증 전.
- 사용자 목표: 설치형 Excel의 **기존 Microsoft Copilot 대화 안에서** AI Pro를 호출하고 열린 문서에 작업한다. 별도 채팅 패널을 기본 결과물로 만들지 않는다.

## 지원 범위와 제안

기본 Office Copilot의 LLM endpoint를 AI Pro로 바꾸는 공개 설정은 확인되지 않았다. Copilot에 AI Pro 호출 도구를 제공하는 확장 경로를 검토한다. 이 경우 기본 대화와 작업 조정에는 Microsoft의 모델이 계속 참여한다. 사내 모델만 사용하거나 문서 데이터가 Microsoft에 전달되지 않는 구성으로 설명하면 안 된다.

목표 흐름은 다음과 같다. 이는 공식 기능을 조합한 **설계 후보**이며, Excel 안에서 전체 흐름이 실행되었다는 의미가 아니다.

1. 사용자가 Excel Copilot에서 AI Pro를 이용한 작업을 요청한다.
2. Excel용 스킬이 현재 문서에서 필요한 범위와 요청을 파악한다.
3. 인증된 원격 MCP 도구가 AI Pro를 호출해 분석 또는 구조화된 작업 제안을 반환한다.
4. Copilot이 해당 Excel 환경에서 제공하는 편집 도구로 제안을 반영한다.
5. 수정한 값을 다시 읽어 요청과 대조하고 결과를 알린다.

초기 검증은 AI Pro 호출 결과를 대화에 반환하는 것부터 시작한다. 이어서 선택 범위의 값·수식·서식 변경 중 하나를 실제 통합문서에서 검증한다. AI Pro 응답 성공과 Excel 편집 성공은 별도 판정한다.

## 현재 공식 문서의 제약

- Excel custom skills는 미리보기다. 문서는 version 2608, Build 20305.20002 이상과 Beta 또는 Current Channel (Preview)를 요구하며 production 사용을 권하지 않는다. 이 버전 표기를 Mac 지원 증거로 해석하지 않는다.
- Excel 스킬은 Copilot이 만든 Office.js runtime을 이용할 수 있다. 별도 task pane이 필수는 아니다.
- 현재 Office.js 기반 스킬 예제는 실행 함수에 매개변수 전달을 지원하지 않는다고 명시한다. 따라서 `applyPlan(plan)` 형태로 AI Pro가 반환한 임의 계획을 그대로 함수 인자로 넘길 수 있다고 가정하지 않는다. 기본 편집 도구와 스킬 간 결과 전달은 실제 대상 환경에서 먼저 입증해야 한다.
- 원격 MCP connector는 HTTPS Streamable HTTP를 요구한다. 사용자의 `localhost`를 Microsoft 클라우드에서 직접 호출할 수 있다고 가정하지 않는다. 회사에서 허용하는 접근 경로가 필요하다.
- Cowork plugin 문서는 OAuthPluginVault를 안내하며, API-key 인증은 아직 지원되지 않는다고 적고 있다. Excel에서의 지원은 별도로 확인한다. manifest나 SKILL.md에 AI Pro 토큰을 넣지 않는다.
- 일반 declarative agent의 API plugin도 외부 API 호출 대안이다. 그러나 M365 Copilot Chat에서 동작한다는 사실이 설치형 Excel의 직접 편집을 입증하지 않는다.
- 과거 `agent-and-add-in` 문서는 현재 일반 Office Add-ins 개요로, `build-api-plugins-local-office-api` 문서는 Excel skills 문서로 연결된다. 오래된 샘플을 현재 지원 계약으로 채택하지 않는다.

## AI Pro 연결 계약

기존 코드 `packages/openwiki/src/auth/aipro.ts`와 프로젝트 지침을 현재 읽어 확인했다.

- Browser SSO: `/auth/cli/login?port=...`, loopback `/auth` callback, `/auth/exchange`에 URL-encoded `code`를 한 번 보내고 JSON `token`을 사용한다. 모델은 `/api/models`의 `modelList`에서 읽는다.
- 추론: 프로젝트의 Browser SSO 계약은 Bearer 인증을 사용한 `/api/v1/chat/completions`다.
- AI Pro CLI: 사용자가 지정한 Base URL·토큰·Model ID를 쓰는 별도 연결이다. SSO의 모델 조회나 인증값과 섞지 않는다.
- 로컬 SSO 구현은 원격 MCP 서버의 사용자 인증을 자동으로 해결하지 않는다. Microsoft 사용자와 AI Pro 계정 연결, 서버 배포 위치, 토큰 수명은 따로 설계한다.
- 확장·OpenWiki의 기존 인증 저장소를 가져오거나 공유하지 않는다. 실서비스 호출을 검증한 것으로 표시하지 않는다.
- 기존 Python 라우터의 AI Pro/OpenCode 경로를 이 검토 때문에 변경하지 않는다.

## 테넌트 연결과 실제 Excel 검증에 필요한 사실

1. 실제 대상이 Windows Excel인지 Mac Excel인지, Copilot 사용 가능 여부.
2. Excel 버전·업데이트 채널, 사용자 지정 플러그인 업로드 허용 여부.
3. Microsoft에서 호출할 수 있고 AI Pro에도 접근할 수 있는 승인된 서버 경로.
4. 사용할 AI Pro 인증이 Browser SSO인지 AI Pro CLI인지, 사용자별 연결을 제공할 수 있는지.

현재 컴퓨터의 `/Applications` 목록에서는 Microsoft Excel을 확인하지 못했다. 다른 회사 PC의 설치·라이선스·정책은 이 사실로 판단하지 않는다. Office 채널을 자동 변경하거나 회사 테넌트에 앱을 등록하지 않았다.

## 첫 검증의 완료 기준

- Excel Copilot 안에서 확장 기능을 찾고 호출한다.
- 도구 호출이 실제 AI Pro 응답으로 이어지고 모델 식별자를 확인한다. 비밀값과 문서 본문은 진단 로그에 남기지 않는다.
- 사용자가 지정한 테스트 범위에 값 또는 수식을 실제로 반영한다.
- 적용 이후와 문서 재열기 이후에 셀 값·수식이 유지되는지 확인한다.
- 연결 실패, 권한 부족, 지원되지 않는 Office 환경에서는 AI Pro 호출 또는 문서 편집을 완료했다고 표시하지 않는다.

## 공식 근거

- [Excel Copilot skills 개요](https://learn.microsoft.com/en-us/office/dev/add-ins/excel/excel-skills)
- [Excel Office.js skill 구현 예제와 매개변수 제약](https://learn.microsoft.com/en-us/office/dev/add-ins/excel/excel-copilot-skill)
- [Copilot plugin 패키징, 원격 MCP 및 인증](https://learn.microsoft.com/en-us/microsoft-365/copilot/cowork/cowork-plugin-development)
- [Copilot agents와 API actions](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/ecosystem)

위 공식 경로가 사용자 테넌트에 활성화되어 있는지와 AI Pro를 포함한 결합 동작은 아직 확인하지 않았다.
