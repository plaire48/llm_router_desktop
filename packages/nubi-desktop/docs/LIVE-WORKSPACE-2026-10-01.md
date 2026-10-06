# 실제 화면과 실행기 연결

Electron 앱과 `http://127.0.0.1:4318/`은 한 owned worker에 연결된다. 웹은 모델 토큰을 받지 않으며 실제 native dispatch를 호출한다. `?conversation`은 예시 데이터를 만들거나 로그인 상태를 바꾸지 않는다.

`npm run build:electron` 후 `npm run start:web`으로 앱과 로컬 웹을 함께 연다. `npm run start:electron`은 앱만 연다. 예시 디자인 화면은 `npm run preview:mock`으로 별도 4320에서 연다. 기본 `preview:web`도 실제 실행기를 사용한다.

| 화면 기능 | 실제 경로 | 확인 경계 |
|---|---|---|
| AI Pro, ChatGPT, FabriX 연결 | 공유 providers와 자체 계정 메모리 | 실제 서비스별 검증을 구분 |
| ChatGPT 모델 선택 | 계정 models 카탈로그와 Pi Responses SSE | 고정 Pi 카탈로그를 계정 사용 권한으로 표시하지 않음 |
| 프로젝트 없는 대화 | 앱 저장소의 실제 대화 작업 기록 | 빈 개인 대화에 Wiki 초기화를 시작하지 않음 |
| 폴더, ZIP, Git | native dialog, 안전한 ZIP 가져오기, ElectronHost clone | 실제 선택과 결과 파일 확인 |
| 파일 읽기와 저장 | 프로젝트 read, Monaco, 해시 확인, 저장 readback | 미저장 파일과 충돌을 보존 |
| 변경과 커밋 이력 | 실제 Git diff/log/show | 읽기 이력과 커밋 발행은 구분 |
| 검색 | 실제 소스 검색 | 현재 프로젝트 범위 |
| 터미널 | owned process run/poll/stop | 출력과 실제 종료 상태 |
| OpenWiki | 기존 초기화와 갱신 실행기 | 처리 수 기반 단계 진행률, 기존 편집 유지 |
| 메일과 첨부 | 실제 POP3 이력, 본문 추출, 현재 모델 직접 질문 | 실제 계정/문서 검증은 별도 |
| 스킬, 회사 계정과 프로젝트 도구 | 기존 native/worker 경로 | 메뉴를 줄여도 기능과 승인 경계 유지 |

로컬 웹은 loopback에만 바인딩하고 Host, Origin, Fetch-Site와 페이지 메모리 capability를 검사한다. 외부 CORS, 임의 파일 endpoint, 인증값을 localStorage에 저장하는 동작과 RPC 자동 재전송은 없다. 기존 dirty/version/readback, native 선택 창, OS secret storage와 HITL을 재사용한다. 웹과 앱은 연결 상태를 조회해서 동기화한다. Desktop A2A는 계속 차단한다.

2026-10-01 실제 첫 ChatGPT 요청에서 브라우저 로그인은 성공했으나 고정 기본 Codex Spark 모델이 HTTP 400 `invalid_model`로 거부된 것을 관찰했다. 계정 카탈로그 사용으로 수정하며 실패한 대화와 오류 영수증을 보존한다. 최종 실모델 응답과 Windows 설치판 결과는 실제 확인 전 성공으로 표시하지 않는다.

검토한 BP: 기존 Electron contextIsolation/sandbox와 trusted frame dispatch, 외부 사이트 요청을 거부하는 loopback capability, 명시적 승인/충돌 검사, 공식 openai/codex models endpoint, 기존 Pi SSE transport. 새 인증 런타임이나 A2A를 도입하지 않는다. Codex CLI 계정 저장소는 읽거나 공유하지 않는다.

공식 카탈로그 계약 참고: https://github.com/openai/codex/blob/main/codex-rs/model-provider/src/models_endpoint.rs
