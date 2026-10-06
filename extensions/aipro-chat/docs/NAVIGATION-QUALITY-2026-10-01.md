# PDF, 새 탭 복구와 반복 분석 개선

## 반영

- `tabs.create` 직후 `url`이 없는 실제 Chrome 상태를 `page_restricted`로 잘못 처리했다. 생성한 탭 ID와 opener를 기록하고 실제 HTTP 문서가 확정된 뒤 연결한다. `pendingUrl`을 읽기 권한이나 문서 근거로 쓰지 않는다.
- 연결 대기가 만료되어도 생성한 탭을 잃지 않는다. 같은 URL을 다시 요청하면 그 탭을 연결하며 새 탭과 GET을 중복 발행하지 않는다. 닫힌 탭이나 다른 Workspace의 탭은 복구 대상으로 삼지 않는다.
- Chromium의 PDF 뷰어가 Playwright의 문서 이벤트나 평가에 응답하지 않을 때, 실제 isolated top document의 PDF 타입과 새 문서 ID를 확인한다. PDF 문서 관찰은 본문이나 뷰어 입력 참조를 생성하지 않는다. 원문은 기존 PDF.js 읽기, 해시와 페이지 구간 검증으로 읽는다.
- 같은 문서 버전의 짧은 근거 구간을 분석 모델의 최초 요청에 함께 전달한다. 규칙 뒤의 예외를 다시 조회하기 위한 모델 왕복을 줄인다. 다른 문서, content_hash, frame, source_key, page_view는 합치지 않는다. 최대 2개 출처, 6개 패킷과 기존 5000자 합계 제한을 유지한다. 실제 전달한 원문만 읽은 근거로 인정한다.

## 방법론과 오픈소스

[Playwright 문서](https://playwright.dev/docs/navigations)의 문서 확정과 로딩 구분, [Chrome Tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs)의 실제 url과 pendingUrl 구분을 적용했다. PDF 뷰어의 로딩 이벤트만 기다리지 않고 확장이 실제 문서 타입과 ID를 확인한다. URL의 `.pdf` 문자열이나 모델 주장을 PDF 판별 근거로 삼지 않는다.

기존 Playwright CRX 1.21.4와 [Mozilla PDF.js](https://mozilla.github.io/pdf.js/) 6.3.289를 재사용했다. 설치된 소스의 라이선스는 모두 Apache-2.0이다. 추가 런타임, OCR 서비스와 새 패키지는 도입하지 않았다. 모델 입력의 불필요한 왕복을 줄이는 설계를 적용하되 필수 인용, 단계 검토, 최종 요구사항 검토와 기존 HITL은 유지했다.

## 전후 증거

`verification/navigation-quality-2026-10-01/`에 실패 원인, 고정 소스, 후보 SHA-256과 실제 Chrome 결과를 보존한다.

| 검사 | 이전 후보 | 개선 후보 |
|---|---|---|
| 600ms 뒤 헤더가 도착하는 새 탭 | page_restricted | 생성한 탭의 실제 본문 확인 |
| 새 탭 연결 대기 만료 뒤 재요청 | 탭 정체성 보존/재사용 회귀가 없었음 | 동일 탭 ID, GET 1회, 추가 생성 없음 |
| HTML에서 native PDF로 이동 | browser_stale | 실제 PDF 문서 ID와 PDF.js 원문 확인 |
| 규칙, 정의, 예외의 짧은 3구간 분석 | 합성 모델 호출 2회 | 같은 근거와 인용 검증으로 1회 |

새 탭 대기 만료 복구까지 포함한 최종 후보를 새 Chrome 프로필에서 세 번 실행했다. PDF 이동은 356/308/304ms, 문서 관찰은 171/16/21ms였다. 중앙값은 각각 308ms와 21ms다. 이전 후보는 PDF 이동 자체가 실패했으므로 이 수치를 실모델 전체 작업의 속도 향상률로 계산하지 않는다. 같은 입력의 분석 모델 호출 2회→1회 결과도 합성 응답 모델의 회귀이며 Sol/Luna/5.6 실측이 아니다.

같은 출처처럼 보이는 다른 문서 ID, 해시, 프레임의 구간은 두 출처 경계를 넘겨 미리 읽은 것으로 인정하지 않는 반례도 검사한다. 원문은 부분 관찰이며, 분석 완료가 전체 페이지 열람이나 업무 완료를 증명하지 않는다.

## 검증 경계

실제 Chrome과 합성 사이트/모델의 실행 회귀다. Sol/Luna/5.6의 새 후보 30과제 실모델 정확도, 실제 사내 PDF와 서버 쓰기 성공은 이 결과로 판정하지 않는다. 과거 E-04의 15초 반복 관찰과 실패 패턴을 바탕으로 회귀를 만들었지만, 공개 사이트의 동일 실모델 과제가 해결됐다는 뜻은 아니다.

최종 후보는 한 번의 전체 `verify:browser` 실행에서 311/311단계를 통과했다. 단위 테스트 1699/1699와 디자인/빌드 3단계, 실제 Chrome 회귀 308회가 포함된다. 핵심 79개 검사는 새 프로필로 3회 반복했으며 native 창 포커스 검사도 3회 모두 통과했다. 별도 집중 계약 검사는 38/38 통과했다. 전체 보고서는 `verification/navigation-quality-2026-10-01/full-gate-passed/report.json`에 보존한다. 실행 종료 시 소스/검사/의존성 입력과 빌드 해시를 재확인했다.

이전 후보의 별도 전체 검사에서 다른 Chrome 검사와 겹친 시점에 native 창 포커스 검사가 실패했고, 그 기록은 `local-apply-2026-10-01/focus-overlap-gate-failure`에 보존한다. 이번 전체 통과 기록에 이전 실행의 성공 단계를 합산하지 않는다.

Chrome 설치는 전체 회귀와 후보 파일 해시 확인 뒤 별도로 기록한다. 설치, 화면 로딩, 모델 연결과 실제 업무 완료를 구분한다. Workspace Code-OSS 포크나 Windows Office 배포의 개선 증거로 사용하지 않는다.

전체 검사의 기존 company-widgets 테스트는 승인 없이 '확인' 버튼을 누르는 과거 동작을 기대했다. 실제 결과는 `approval_required`와 `actionIssued:false`였으며 이벤트가 발생하지 않았다. 제품의 승인 규칙을 유지하고 테스트를 실제 승인 요청→같은 실행의 승인 반영→이벤트 1회 확인으로 수정했다. 수정한 집중 검사와 동일 제품 코드의 전체 회귀 재실행이 통과했다. 실패 보고서는 `full-gate-stale-widget-fixture/`에 보존하며 서로 다른 실행의 통과 결과를 합산하지 않는다.

## Chrome 설치

- 확장: nubi 1.4.44 (Beta 1.0.0)
- 설치 폴더: `/Users/ganadi/Library/Application Support/Nubi/ChromeExtension`
- 후보 ZIP SHA-256: `07c3d6eb93c3b7adde572ea6b6e26710c8e889f347fff919e401dcbf1ee97f46`
- 전체 검사 빌드와 설치 폴더의 727개 파일 해시가 일치한다. 사용자 설치 승인 뒤 일반 Chrome '태경' 프로필에 설치했으며 `nubi`, 확장 ID `aoangnigbnmbccbdjoeiahkaikkcfhhl`, 켜짐과 설치 경로를 실제 Chrome 세부정보에서 확인했다.
- 사이드패널이 정상적으로 열렸으며 설정의 ChatGPT 로그아웃 버튼과 선택 모델 `GPT-5.6 Sol`을 확인했다. 인증값을 읽거나 다른 프로필에서 복사하지 않았다.
- 첫 전송에서 기존 `PAGE_ORIGINS = ['http://*/*', 'https://*/*']` 계약의 추가 Chrome 권한 요청이 나타났다. 사용자가 전체 웹사이트 권한과 실모델 검증을 명시적으로 승인했고, 후속 확인 시 권한 요청이 닫히고 작업이 완료돼 있었다. 이미 완료된 요청을 다시 전송하지 않았다.
- 일반 Chrome의 ChatGPT `GPT-5.6 Sol`로 합성 안내 페이지의 PDF 새 탭 읽기 1과제를 통과했다. 답변의 마감일 `2026-10-15`와 마감 이후 신청 제외 조건을 독립 정답과 대조했다. 실제 native PDF 탭에서 동일 원문과 1쪽 로드 완료를 확인했고, 원래 사용자 탭의 `보존할 입력` 값 `keep-original-data`가 유지됨을 직접 확인했다. 화면의 계획 2/2 완료와 최종 답변 표시도 확인했다.
- 근거: `verification/navigation-quality-2026-10-01/normal-chrome-real-model-pdf.json`. 이 실모델 집중 검사 1과제는 전체 30과제 점수, Luna/다른 모델의 정확도, 전체 작업 지연 시간이나 실제 사내 사이트 성능을 증명하지 않는다.
