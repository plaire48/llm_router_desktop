# 기존 위키 갱신의 실패 원인과 단계 보존

사용자 보고: 기존 위키를 갱신할 때 `wiki failed`가 반복됨. 작업 중지 요청 뒤 변경을 보관했고, 사용자의 이어서 진행 요청으로 검증을 재개했다.

## 확인한 결함

1. `wiki-initialization-error.mjs`의 허용 코드에 Claude 연결/실행/응답 오류가 빠져 있었다. 예를 들어 실제 `claude_cli_timeout`도 `wiki_failed`로 바뀌었다.
2. 프레임워크 예외의 `cause`를 읽지 않아, 감싸진 네트워크/모델 오류를 잃었다.
3. `defaultWikiUpdater`가 모델 실패를 관찰한 후에도 native runner가 다른 예외로 종료하면 기존 `terminalModelError` 확인에 도달하지 못했다. 원래 로그인 오류 대신 runner의 대체 예외가 전달됐다.
4. 기존 위키 갱신의 마지막 catch는 실제 진행 단계와 관계없이 항상 `planning`으로 분류했다.

위 결함은 주입한 오류로 실제 ProjectService/갱신 저장소/공개 UI를 실행해 재현했다. 로컬 사용자 저장소에 남은 `wiki_failed`는 2026-10-07의 계획 단계 기록이었고, 이번 사용자의 현재 Windows 갱신 실패를 입증하는 최신 로그는 없었다. 사용 중인 모델과 실제 실패 원인은 확정하지 않는다.

## 수정

- 알려진 Claude 오류와 `invalid_model`을 고정 코드로 보존한다.
- 최대 다섯 단계의 cause를 확인하되 순환 참조를 중단한다. 원문 예외, 서버 본문, 경로, stack과 인증값은 기록/화면으로 전달하지 않는다. 알 수 없는 예외의 `wiki_failed` fallback은 유지한다.
- runner가 다른 예외로 종료해도 이미 관찰한 terminal model error를 반환한다. 새 모델 호출이나 도구 재실행을 추가하지 않는다.
- 갱신의 실제 progress 단계와 저장 준비 단계를 실패 기록에 저장한다. 준비 전 실패는 `snapshot_git`으로 구분한다.
- 위키 초기화와 기존 갱신이 같은 Claude 오류 설명을 사용한다. 갱신의 접힌 `중단 이유` 안에 해결 행동, 단계, 고정 코드를 표시한다.
- 원본/사본/완료 문서와 명시적 이어쓰기, 반영 승인 계약을 유지한다. 상태 조회나 설정 재진입은 작업을 자동으로 재실행하지 않는다.

## 재현과 검증

새 `tests/wiki-failure-recovery.test.mjs` 네 검사는 수정 전 모두 실패했다. 실제 갱신 사본을 만든 뒤 wrapped Claude timeout으로 실패시키고, 명시적 resume에서 보관 파일을 재확인하고, 반영 승인 전 원본이 유지되는지 검사한다. runner 대체 예외, 고정 코드/cause/순환 참조와 비공개 텍스트 차단, UI 행동/단계 표시도 포함한다.

첫 수정에서는 공유 `safeError`의 일반 `request_failed` fallback이 구체적인 cause보다 먼저 `model_failed`로 분류되는 문제가 나왔다. 일반 fallback으로 cause 탐색을 중단하지 않도록 고친 뒤 최초 관련 검사 76개가 통과했다. 재개 후 최신 소스에서 실제 native repository bundle 검사까지 포함한 관련 검사 87개도 통과했다.

`scripts/check-wiki-resume-ui.mjs`는 실제 React/CX와 Electron CSS를 사용해 1280px과 440px, 확대 글자에서 네 오류의 여덟 표시 사례를 확인한다. 기존 resume/원본 충돌/cancel/discard 동작도 확인한다.

`scripts/check-electron-wiki-failure.mjs`는 실제 ProjectService에서 실패를 저장하고 종료한 뒤 빌드한 Electron으로 같은 저장소를 다시 연다. `claude_login_required`, `내용 검토`, 이어쓰기 버튼, 설정 닫기/재진입과 원본 보존을 확인했다. 초기 검사의 동명 버튼 selector 충돌은 실제 `.nubi-wiki-settings-link`로 범위를 좁혀 수정했고 초기 실패 로그를 보존했다.

산출물은 `verification/wiki-failure-2026-10-16/`에 있다. 초기 red/green/focused 검사, 중지로 불완전한 전체 검사, 재개한 전체 검사와 빌드/UI/native 로그를 구분한다. 재개한 전체 회귀 검사의 완료 결과는 아래에 기록한다.

## 확인 경계

- 최신 소스 Electron 빌드는 성공했다. macOS에는 PowerShell이 없어 Windows Office reader의 native 파서 검사는 skip이다.
- 공통 디자인 검사는 이번에 변경하지 않은 `ui/native-excel-preview.css`의 고정 px 글자 크기에서 실패했다. 위키 수정과 별도인 기존 검사 실패이며, 검사 우회나 관련 없는 CSS 수정은 하지 않았다.
- 실제 회사 모델/Windows 설치판에서 사용자의 반복 갱신 오류가 사라졌다고 표시하지 않는다. 이 변경은 재현한 오류 손실과 단계 오기록을 고친 것이다. 실제 실패를 특정하려면 해당 실행의 모델과 중단 단계/고정 코드가 필요하다.
- 사용자 위키를 삭제/초기화하거나 실계정의 실패 작업을 임의로 재개하지 않았다. 배포/설치 파일은 만들지 않았다.

## 재개 후 최종 검사

- `npm test`: 전체 1,735개 중 1,538 통과, 197 skip, 실패/취소 0. `full-tests-resumed.log`와 중지한 과거 로그를 구분한다.
- 관련 native bundle 포함 회귀: 87/87.
- 실제 React/CX 오류 표시: 8개와 넓은/좁은 화면의 이어쓰기/충돌/중지/폐기 흐름 통과.
- 최신 소스 Electron 빌드 및 저장 실패 재열기 검사 통과.
- 디자인 검사: 기존 `ui/native-excel-preview.css` 위반으로 실패. 실제 Windows/회사 모델은 미검증.

현재 소스 해시와 검사 요약은 `verification/wiki-failure-2026-10-16/summary.json`에 보관했다.
