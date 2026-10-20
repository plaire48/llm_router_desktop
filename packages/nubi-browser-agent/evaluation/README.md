# 범용 모듈의 업무 예시 평가

후속 실제 공개 사이트의 새 요청 재사용 평가는 `transfer-cases.mjs`의 고정 과제와 `transfer-score.mjs`의 채점을 사용한다. 패키지 디렉터리에서 다음을 실행한다. 기존 화면 위키와 별도 자격 검증한 절차 경로는 호스트가 제공하며 측정 중에는 갱신하지 않는다.

```sh
node scripts/naver-transfer-live.mjs /absolute/report.json /absolute/screen-wiki /absolute/procedure.json measure
node scripts/score-transfer.mjs /absolute/report.json /absolute/score.json
```

3과제/2군/3회의 18회 교차 비교다. 과거 화면 안내와 검증 절차의 합성 재사용을 일반 실행과 비교한다. 실제 과제 완료는 절차 사용 여부와 독립적으로 판정한다. 누락/중복/미완료/학습 오염은 채점하지 않고, 정상 접수한 과제의 실패/느린 실행은 분모에 유지한다. 사이트별 선택자와 정답은 평가 호스트에만 있으며 배포 진입점에는 포함되지 않는다. Codex/Claude/논문/BrowserGym의 방법론 적용과 실제 두 제품 실행기/공식 benchmark 점수를 구분한다.

아래 기록은 최초 로컬 fixture 단계의 과거 범위다.

사용자 확인: JSM과 사내 그룹웨어의 메일 읽기/쓰기는 범용 Browser Agent를 검증하는 사례다. JSM/그룹웨어 특화 제품 또는 전용 실행기를 개발하는 범위가 아니다.

- `site.mjs`: 회사 계정/URL을 사용하지 않는 로컬 합성 화면. JSM 검색/상세와 메일 검색/읽기/새 초안/회신 초안을 제공한다.
- `workflows.mjs`: 첫 개발 사례 5개와 runner 전용 검사. 핵심 모듈은 이 데이터나 정답을 import하지 않는다.
- `tests/workflows.test.mjs`: 정답 검사 자체가 잘못된 수신자/회신 대상/근거와 누락을 거절하는지 확인한다.

실행은 패키지 디렉터리에서 `npm run fixture:workflows`다. 프로세스마다 독립 loopback 주소와 메모리 상태를 사용한다. 종료하면 시험 초안/세션은 사라진다. 전송 경로는 제공하지 않으며 실제 사내 메일을 보내지 않는다. 로그인 버튼은 사용자 개입 화면의 시험 장치이며 실제 SSO/MFA를 검증하지 않는다.

실행기는 화면 관찰과 범용 브라우저 도구로 동작해야 한다. 정답/seed 직접 조회, 사례 ID별 고정 실행 분기나 평가 oracle의 모델 전달은 금지한다. 정답 검사는 runner가 실제 서버 상태를 별도로 읽어 수행한다. 현재의 필수 문구 검사는 제한된 자동 검사이며 자연어 사실 정확도/불필요한 주장 전체를 보장하지 않는다. 의미 검토는 추가로 필요하다.

이 5개는 개발용 사례다. 향후 평가에는 동일 업무의 다른 화면 구조와 전혀 다른 종류의 사이트를 별도 고정 세트에 포함한다. 첫 사례 통과를 범용 품질이나 고정 평가 40과제 통과로 표시하지 않는다. fixture 코드는 패키지 공개 진입점과 배포 files에 포함하지 않는다.

현재 확인: core/fixture/oracle 자동 검사 23개 통과. Playwright CLI로 합성 로그인 → JSM 필터 검색 → 이슈 상세 → 같은 제목/이름의 메일에서 정확한 원문 선택 → 회신 화면의 수신자/대상 연결을 확인했다. 초안 저장과 잘못된 대상 거절은 HTTP/서버 상태 자동 검사로 확인했다. core와 실제 브라우저의 연결, 모델의 자율 업무 수행, Codex/Claude 실성능 비교, 사내 서비스와 Workspace 연결은 아직 미수행이다. CLI 호출 왕복 시간은 제품 성능으로 집계하지 않는다.

새 요청 전이 결과를 확정한 뒤 다른 시작 화면을 별도로 학습하려면 `scripts/naver-results-learning.mjs`의 prepare와 measure를 새 절차 파일로 실행한다. 기존 학습 자료를 갱신해 전이 점수에 섞지 않는다. `scripts/naver-scope-quality.mjs`는 표 범위를 명시한 별도 3회 요약 품질 확인이며 18회 비교군에 합치지 않는다. 초기 학습/qualification 비용과 범위는 [새 요청 재사용 결과](../../../docs/research/2026-10-16-browser-memory-transfer-results.md)를 따른다.
