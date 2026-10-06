# Theia 시작과 AI Pro 로그인 지연 진단

날짜: 2026-10-01. 사용자 결정: Theia IDE와 Electron 호스트를 유지한다.

사용자가 보고한 대상은 Windows 설치판이다. AI Pro 웹 로그인은 성공하고 프로그램에서 오류가 표시된다. 앞선 브라우저 접속 실패 답변은 이 설명으로 정정됐다. 실제 앱 오류 문구와 브라우저 성공 화면이 AI Pro 사이트인지 localhost 콜백인지 아직 확인하지 못했다.

## 변경 전 기준선

아래 측정과 코드 관찰은 Theia 전환 구현 전의 기록이다. 현재 반영 사항은 [Theia 전환](ELECTRON-WORKSPACE-2026-10-01.md)을 따른다.

### 첫 화면

현재 Mac 개발 산출물을 임시 설정/상태 폴더로 실행했다. 사용자 프로젝트/기존 상태를 열거나 설치판을 빌드하지 않았다.

| 관찰 | 결과 | 범위 |
|---|---|---|
| 첫 표본 창 생성 | 7.534초 | 누비 준비 화면까지 8.599초. 로그인 화면 완료 시각은 미측정 |
| 후속 유효 표본 창 생성 | 0.831초 | 재실행, 새 임시 설정 |
| 후속 누비 화면 DOM | 1.975초 | 입력 준비 완료와 구분 |
| 후속 제공자 준비 완료 | 2.145초 | 합성 계정이 아닌 미로그인 제공자 화면 |
| 후속 Theia 로딩 가림막 제거 | 2.305초 | Mac 개발 실행본 |
| 로딩 화면 전환 | 0.8075초 | 실제 Theia Stopwatch 로그, CSS transition 0.8초 |

첫 표본과 후속 표본의 차이는 확인했지만 디스크 캐시/보안 검사/CPU 대기 중 어느 원인인지는 프로파일링 전이다. 콜드 시작이라고 단정하지 않는다. 중간 한 표본은 숨김 선택자를 너무 일찍 확인해 빈 body가 나왔으며 준비 완료 성적으로 사용하지 않는다.

로컬 Electron frontend bundle은 약 25.37 MiB, CSS는 7.64 MiB다. electron-app의 bundle 스크립트는 development 모드다. 그러나 Windows package-windows.mjs는 production 모드를 명시한다. 로컬 개발 번들 크기를 사용자의 Windows 설치판 지연 원인으로 적용하지 않는다. npm start 경로는 시작 때 재빌드하지 않는다.

과거 2026-09-30 UI 로그에서 NubiContribution.initializeLayout 2.2569초가 기록됐지만 현재 후속 실행의 전체 레이아웃 초기화는 0.093초였다. 과거 값을 현재 병목으로 단정하지 않는다. 현재 위젯은 EditorManager 등 편집 서비스를 시작 시 주입하며 부하 분리는 후보이지 검증된 개선이 아니다.

## AI Pro 로그인

실행 경로: 브라우저 SSO → localhost /auth 콜백 → worker POST /auth/exchange → GET /api/models → session 연결 → 화면 갱신.

확인한 문제:

1. 토큰 교환 뒤 모델 조회가 끝나기 전까지 pending을 해제하지 않고 브라우저 콜백 응답도 끝내지 않는다. 두 네트워크 호출의 개별 제한은 각각 15초다. 30초는 강제 지연이 아니라 순차 호출에서 걸릴 수 있는 제한 합이며 전체 로그인 제한은 180초다.
2. Desktop Workbench는 pending.phase를 waiting으로 고정한다. 공통 로그인 UI의 인증 확인 중 표시가 연결되지 않아 교환/모델 조회 동안도 로그인 대기 중으로 보인다.
3. providers.status의 loginError에는 구체적 안전 코드가 있지만 Workbench는 모든 오류를 연결을 완료하지 못했어요. 다시 로그인해 주세요.로 표시한다. 콜백/교환/모델 조회 단계와 시간도 노출하지 않는다.
4. Theia Host의 fork와 service-entry에서 시스템 CA 사용을 명시하는 설정이 없다. Office native WorkerProcess는 --use-system-ca를 명시한다. Windows 회사 인증서/프록시 환경에서 앱 fetch와 브라우저의 성공이 달라질 수 있는 후보다. 실제 설치판 환경값과 기본 신뢰 동작을 확인하기 전 TLS 원인으로 확정하지 않는다.
5. 로그인 상태는 1초 간격으로 조회하며 document.hidden 동안 멈추고 visibilitychange에서 다시 조회한다. 정상 동작은 앱 복귀 시 갱신하므로 1초 주기만으로 긴 대기를 설명할 수 없다. 조회 실패는 빈 catch로 감춰져 worker 장애가 대기로 보일 수 있다.

합성 재현: 토큰 교환에 100ms, 모델 조회에 1800ms를 주입했다. 약 117ms에 교환이 끝나도 415ms에 pending=aipro, connected=false였고 약 1939ms에 모델 조회와 콜백 응답이 끝난 뒤 연결됐다. TLS 오류를 주입하면 내부 loginError=tls_untrusted, callback HTTP 400, connected=false가 됐다. 실제 사내 계정 결과가 아니다.

현재 Mac에서 인증 없는 /api/models 접근은 52ms 만에 network_dns로 실패했다. 이 환경에서는 실제 AI Pro 로그인 지연을 측정할 수 없으며 사용자의 Windows 네트워크 상태로 확대하지 않는다.

## 구현 전달 명세

아래는 최초 진단 때 작성한 구현 프롬프트다. 이후 사용자 전환 요청으로 구현을 진행했고 현재 반영 내용은 Theia 전환 문서에 기록한다.

Theia/Electron을 유지하고 시작 지연과 AI Pro 연결 실패를 각각 개선하라. 사용자 Windows 오류 코드와 설치판 버전을 우선 확인한다. 기존 UI/worker/provider 재사용 및 승인/편집/취소/미확정 실행 보호를 유지한다.

- 시작은 main 진입, backend 준비, frontend 로드, 누비 화면 준비, 로딩 가림막 제거를 별도 시간으로 남긴다. 새/복원 설정과 대표 프로젝트에서 반복 비교하고, Windows 설치판과 Mac 개발 모드를 분리한다. Electron 공식 지침의 측정/필요 시 로딩을 적용하고 production 경로를 먼저 검증한다.
- 실제 제공자 상태에 browser_wait, callback_received, exchanging, loading_models, ready, failed 단계를 연결한다. UI는 짧은 현재 단계와 실패 원인/다음 행동을 보여준다. 일반 진행 기록에 내부 네트워크 내용을 나열하지 않는다.
- 진단은 시각, 단계, 소요시간, HTTP 상태와 안전한 오류 코드만 기록한다. callback code/JWT/Authorization/쿼리 URL/원문 응답/개인정보를 화면이나 파일에 저장하지 않는다.
- 인증 성공과 모델 목록 사용 가능을 분리하되 모델 조회 전 추론을 허용하거나 가짜 성공을 표시하지 않는다. 교환 code는 한 번만 소비하고 실패/취소 시 재교환하지 않는다. 모델 목록 재조회는 유효한 현재 연결과 사용자 재시도 계약에 묶는다.
- 실행 Node/Electron 버전에서 Windows의 기존 인증서 신뢰를 사용하는 지원 방법을 검증한다. 브라우저/worker의 실제 연결 차이를 확인한 뒤 적용한다. 인증서 검증이나 보안 정책을 끄지 않는다. 승인되지 않은 프록시/인증서 변경을 요구하지 않는다.
- localhost IPv4/IPv6/콜백 도달, 느린 교환/모델 조회, TLS/DNS/403/시간 초과, 취소와 앱 복귀, worker 종료를 구분한다. 잘못된 외부 콜백은 성공이나 취소로 받아들이지 않는다.
- 공유 providers/aipro-auth 수정은 Office 회귀도 확인한다. Windows 실제 설치판 및 사내 SSO/모델 조회는 해당 환경에서 검증한 경우만 성공으로 기록한다. 최종 설치 파일 빌드는 별도 명시적 요청 전 수행하지 않는다.

새 SDK 도입보다 기존 createProviders의 의존성 주입과 NubiLogin의 진행 상태를 연결하는 방식을 우선한다. 공식 Node 시스템 CA 지원은 후보이며 실제 Electron worker 지원을 확인해야 한다. 별도 인증 런타임/라우터는 추가하지 않는다.

## 근거

- 소스: electron-app/package.json, scripts/package-windows.mjs, extension/src/node/nubi-backend-module.ts, extension/src/browser/nubi-frontend-module.ts, runtime/service-entry.mjs, ui/Workbench.jsx, ../nubi-office/worker/aipro-auth.mjs, providers.mjs, connection-errors.mjs, ../nubi-office/native/Nubi.Office.Host/WorkerProcess.cs.
- Theia 1.75 설치 소스의 frontend-application.ts revealShell과 index.css .theia-preload.
- 재현 시각/소스 해시: verification/startup-login-diagnosis-2026-10-01/.
- [Electron 성능 지침](https://www.electronjs.org/docs/latest/tutorial/performance): 측정과 지연 로딩.
- [Theia frontend lifecycle](https://theia-ide.org/docs/frontend_application_contribution/): 시작/레이아웃 초기화 계약.
- [Node CLI 시스템 CA와 프록시 지원](https://nodejs.org/api/cli.html): 기존 시스템 신뢰 사용 가능성과 버전 경계.
