# 조회 절차 재사용 개발과 전후 검증

기준일 2026-10-01. NQ-59. 사용자가 선 개발과 시간/도구 호출/성공의 전후 비교를 요청한 범위다.

## 적용

Stagehand의 action cache 설계 패턴을 참고하고 기존 누비 Pi와 Playwright 실행기를 개선했다. 새 SDK와 설치 의존성은 추가하지 않았다. [Stagehand 공식 caching](https://docs.stagehand.dev/v3/best-practices/caching), [Playwright locator](https://playwright.dev/docs/locators). Stagehand는 MIT, Playwright는 Apache-2.0이며 소스 복사 대신 기존 실행 경로를 확장했다. 모델 자동 캐시의 단순 재생은 현재 문서/권한을 대체할 수 없어 채택하지 않았다. WebMCP와 복잡한 절차 그래프는 이번 단일 링크 범위에 도입하지 않았다.

완료 후 검토한 Wiki에 입력값 없는 단일 정보 링크를 선택적으로 연결한다. 첫 계획 문맥에서 시작 페이지의 관련 카드를 전달하며 모델은 `open_site_procedure`를 선택할 수 있다. 이름/role/문맥과 같은 origin의 정확한 목적지, 시작 URL/제목, Wiki 버전/원문 해시/신선도를 검사한다. 다중 프레임/불완전 관찰/같은 이름의 중복 대상/질의와 fragment/거래용 이름은 재사용하지 않는다. 이전 ref, 입력값, 승인과 실행 ID는 저장하지 않는다.

호스트는 준비와 단회 토큰 소비 때 새로 관찰한다. 일반 `click_element`의 승인/소유권/실제 문서/입력 발행/불확실 상태 계약으로 실행하며 hover 후에도 목적지를 클릭 발행 직전에 확인한다. wrapper가 실제 click과 실행 전 snapshot 근거로 확장되므로 최종 검토에서 행동을 숨기지 않는다. 페이지 열기만으로 요청 완료를 표시하지 않는다. 정상 원문 읽기와 검증/계획/최종 요구사항 검토를 유지한다. 불일치는 실행 전 거절하고 일반 Pi로 돌아간다.

검토 화면은 기존 CX checkbox와 modal을 유지하고 조회 절차와 입력 절차의 문구만 구분했다. Wiki 저장과 연결 영수증을 같은 local storage 갱신으로 보존한다. Office/Workspace 포크는 이번 변경 범위가 아니다.

## 검증과 비교 방법

이전 소스는 개발 전 별도 폴더에 고정했다. `verification/read-procedure-quality-2026-10-01/before-source.json`에 경로가 있다. 단위 검사, 실제 Chrome의 변경/중복/hover 교체/위키 버전/단회 토큰/값 보존/검토 저장을 검사한다. `site-link-procedures-browser`와 기존 입력 절차 검사를 고정 quality-baseline-v14 및 전체 gate에 추가해 각 3개 새 프로필로 실행한다.

`scripts/compare-read-procedures.mjs`는 같은 마감일/제외 조건 과제를 전후 각 3개 새 프로필에서 실행하고 실행 순서를 교차한다. 완료 답변이 화면에 렌더링된 뒤 5초를 둔다. warm 재사용과 cold/mismatch 복구를 분리한다. 모델 API는 결정적 합성 전송이며 실제 Chrome과 extension/Pi/계획/최종 검토/클릭/페이지 검증은 그대로 실행한다.

측정값은 전송부터 최종 렌더링까지의 시간, 계획과 검토를 포함한 전체 모델 요청, 실행 모델이 요청한 도구 수, durable task.steps에 기록된 실제 호스트 primitive, native 클릭 수, 입력 이벤트 수와 독립 페이지/답변 성공이다. 호스트 내부로 호출을 옮긴 효과와 모델 왕복 감소를 분리한다. 모델 서버 지연을 인위적으로 더하지 않는다. 이 결과는 Sol/Luna/Qwen 실모델 속도나 30과제 전체 정확도의 증거가 아니다.

결과는 동일 후보 gate와 비교가 종료된 뒤 별도 영수증에 기록한다. 이전 설치판은 그 후보의 설치/실모델 근거이며 새 소스의 정상 Chrome 반영을 자동 인증하지 않는다.
