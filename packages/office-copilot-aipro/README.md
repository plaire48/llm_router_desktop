# AI Pro for Excel Copilot — 검증용 구현

**Excel에 있는 Microsoft Copilot 대화에서 AI Pro를 호출하는 플러그인과 연결 서버입니다.** 별도 채팅 UI는 없습니다. Microsoft의 기본 Copilot 모델은 계속 요청을 조정하며, AI Pro가 분석과 셀 변경 제안을 반환합니다.

현재 상태: 로컬 MCP·인증·AI Pro 요청 계약·패키지 테스트 통과. Microsoft 테넌트 등록, 실제 AI Pro 모델 응답, 설치형 Excel 편집은 미검증입니다. 이 컴퓨터에서는 Excel 설치를 확인하지 못했습니다.

## 사용 흐름

Excel에서 처리할 셀과 결과를 넣을 빈 셀을 함께 선택한 다음 Copilot에 다음처럼 요청합니다.

> AI Pro로 선택한 표를 분석하고 합계 수식을 넣어줘.

Copilot이 현재 선택 영역의 값·수식을 읽고 `aipro_excel_plan` 도구를 호출합니다. AI Pro의 제안이 범위·형식 검사를 통과하면, 해당 Excel 환경의 편집 도구로 반영하고 다시 읽어 결과를 확인하도록 스킬에 정의했습니다. 이 마지막 편집 흐름은 실제 Excel에서 검증해야 합니다. 도구만 호출되거나 분석 답변만 표시된 상태를 편집 완료로 취급하지 않습니다.

지원하는 제안은 선택 범위 내 값, 영어 A1 수식, 굵게, 숫자 서식, 채우기 색입니다. 최대 1,000셀·100 KB를 다룹니다. 데이터 전체를 자동 수집하지 않습니다. AI Pro 결과는 구조 검증을 거쳐도 계산이나 업무 의미가 틀릴 수 있으므로 Copilot이 적용 목적과 결과를 확인합니다.

## 연결 구조

`Excel Copilot → 인증된 HTTPS MCP → AI Pro → 작업 제안 → Copilot의 Excel 편집 도구`

서버에는 문서 편집 권한이 없으며 응답에 항상 `applied: false`를 표시합니다. 현재 서버 한 개는 지정된 Entra 사용자 한 명과 별도로 준비한 AI Pro 계정 한 개에만 연결합니다. 회사 전체에 배포하려면 사용자별 자격증명 연결을 구현해야 합니다.

Microsoft Copilot도 데이터와 요청 처리에 참여합니다. 사내 모델만으로 처리되거나 Microsoft에 문서 내용이 전달되지 않는 방식은 아닙니다.

## 개발 실행

Node.js 22.19 이상에서 이 디렉터리를 사용합니다.

```sh
npm ci
cp .env.example .env
npm test
npm run check
```

`.env`를 설정한 뒤 `npm start`로 실행합니다. Node의 `--env-file-if-exists=.env`를 사용하므로 이 디렉터리에서 실행해야 합니다. 로그에는 자격증명·문서 본문·모델 원문을 기록하지 않습니다. 사내 CA가 필요하면 실행 환경의 `NODE_EXTRA_CA_CERTS`를 설정합니다. TLS 검증을 끄지 않습니다.

### AI Pro 계정

- `AIPRO_MODE=cli`: `AIPRO_CLI_BASE_URL`, `AIPRO_CLI_TOKEN`, `AIPRO_CLI_MODEL_ID`를 설정합니다. Base URL은 `/v1` 등을 포함한 API 루트이며 서버가 `/chat/completions`를 붙입니다. HTTPS를 요구하며 `User-Agent: AIPROCLI`를 사용합니다. 자동 모델 목록 조회를 하지 않습니다.
- `AIPRO_MODE=browser-token`: 이 연결 서버용으로 따로 발급받은 SSO JWT를 `AIPRO_ACCESS_TOKEN`에, 모델 ID를 `AIPRO_MODEL_ID`에 설정합니다. 고정 AI Pro `/api/v1/chat/completions`에 Bearer 인증으로 호출합니다. 이 패키지에는 SSO 로그인 UI·토큰 발급·자동 갱신이 없습니다. 만료되면 재발급이 필요합니다. 이 모드를 기존 확장의 SSO 로그인까지 완성된 기능으로 설명하지 않습니다.

기존 Chrome 확장·OpenWiki·라우터 저장소에서 인증값을 읽거나 가져오지 않습니다. 두 모드의 자격증명은 섞이지 않습니다. 모델 ID는 운영자가 실제 사용할 수 있는 값으로 설정해야 합니다.

### Microsoft 계정과 연결 서버

1. 대상 테넌트의 Entra 앱에서 이 서버용 delegated scope `access_as_user`를 정의하고 v2 access token을 사용하도록 구성합니다.
2. `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_ALLOWED_USER_ID`를 설정합니다. 마지막 값은 해당 AI Pro 연결을 사용할 본인의 Entra object ID입니다.
3. Microsoft가 접근할 수 있는 승인된 HTTPS reverse proxy를 준비하고 `PUBLIC_ORIGIN`에 origin을 설정합니다. 서버는 `127.0.0.1:8789`에 바인딩하며 proxy가 `/mcp`, `/health`, `/.well-known/oauth-protected-resource/mcp`를 전달합니다. API 요청 본문·Authorization을 proxy 로그에 저장하지 않도록 설정합니다.
4. Microsoft Agents Toolkit에서 OAuth client를 등록해 `OAuthPluginVault` registration ID를 받습니다. 대상은 위 Entra 앱의 인증·토큰 endpoint와 `api://<ENTRA_CLIENT_ID>/access_as_user` scope입니다. Microsoft가 지정한 redirect URI를 Entra 앱에 등록합니다. `M365_OAUTH_REGISTRATION_ID`는 이 등록의 ID이며 tenant ID나 AI Pro token이 아닙니다.

서버는 서명·issuer·audience·만료·tenant·사용자·scope를 검사합니다. Microsoft access token을 AI Pro에 전달하지 않습니다. AI Pro는 서버에 따로 설정된 자격증명을 사용합니다. 서버를 인터넷에 공개하거나 회사 테넌트에 앱을 등록하는 작업은 실행하지 않았습니다.

## Copilot 패키지 만들기

`.env.example`의 `M365_*` 항목과 `PUBLIC_ORIGIN`을 실제 등록값으로 설정합니다. 개발자 이름, 서비스 홈페이지·개인정보 안내·이용약관 주소도 필요합니다.

```sh
npm run package
npm run validate:package
```

결과는 `dist/office-copilot-aipro.zip`입니다. 패키지에는 Microsoft 365 manifest v1.28, PNG 아이콘, Excel 스킬·참고 문서와 서버의 실제 `tools/list`에서 생성한 도구 설명만 들어갑니다. 토큰·서버 소스·`.env`는 포함하지 않습니다. 연결 주소와 등록 ID가 비어 있으면 패키징을 중단합니다. 로컬 코드 검증용 가짜 등록값으로 만든 ZIP을 사용자 설치본으로 배포하지 않습니다. `validate:package`는 Microsoft의 현재 v1.28 스키마를 내려받아 manifest와 도구 설명·스킬 포함 여부를 검사합니다.

개인 설치·테넌트 배포는 [Microsoft의 플러그인 설치 절차](https://learn.microsoft.com/en-us/microsoft-365/copilot/cowork/cowork-plugin-development)를 따릅니다. 패키징 성공은 설치, OAuth 연결 또는 Excel 동작 성공을 뜻하지 않습니다.

## 실제 Excel에서 남은 확인

- [Excel skills 공식 조건](https://learn.microsoft.com/en-us/office/dev/add-ins/excel/excel-skills): version 2608 / Build 20305.20002 이상, Beta 또는 Current Channel (Preview). 현재 미리보기이므로 production 배포 대상으로 다루지 않습니다. Mac 지원을 이 Windows 형식의 버전으로 추정하지 않습니다.
- 회사의 Copilot 이용 권한과 사용자 지정 스킬·연결 도구 허용 여부.
- Excel Copilot에서 스킬 및 원격 도구 발견과 호출, Microsoft 로그인 성공.
- 회사망 AI Pro의 실제 응답과 요청 제한 시간(22초) 적합성.
- 실제 통합문서에서 수식·값·서식 반영 후 readback, 저장·재열기 후 유지.

해당 환경에 편집 도구가 없으면 스킬은 분석 결과까지만 제공하고 미적용 상태를 알려야 합니다.

## 개발 검증 범위

테스트는 공식 MCP SDK 클라이언트와 로컬 HTTP 서버 사이에서 handshake, 도구 발견·호출, 서명된 테스트 JWT 검증을 수행합니다. AI Pro는 합성 HTTP 응답으로 대체합니다. 범위 초과·분석 요청의 쓰기·외부 수식·잘린 응답·인증 실패·취소를 검사합니다. Microsoft OAuth 계정 로그인과 Excel UI는 이 테스트에 포함되지 않습니다.

[상세 연동 검토](../../docs/research/2026-09-22-office-copilot-aipro-feasibility.md)
