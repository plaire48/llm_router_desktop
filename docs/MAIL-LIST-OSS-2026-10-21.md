# M1 목록 저장과 렌더링 OSS 선택

2026-10-21. 설계: `superpowers/specs/2026-10-21-nubi-wiki-scale-quality-design.md` M1/M3. 본문 FTS와 암호화 경계는 답 22 대기다. 새 본문 색인, 암호화 변경, 임베딩/리랭커는 포함하지 않는다.

| 후보 | GitHub 별 (gh api 실측) | 라이선스 | API의 pushed_at (UTC) | 누비 적용 판단 |
|---|---:|---|---|---|
| nodejs/node의 node:sqlite | 122,525 | Node 본체 MIT, 포함 의존성별 고지. API SPDX는 NOASSERTION이며 LICENSE 원문 확인 | 2026-10-20 17:07:15 | **채택하여 직접 사용**. 기존 Store와 동일한 SQLite 라이브러리, 별도 네이티브 설치 없음. 준비한 SQL, 인덱스, 트랜잭션, 디스크 임시 저장을 실제 실행 |
| TanStack/virtual | 7,152 | MIT | 2026-10-17 22:15:13 | 이번 범위 보류. 기존 메일 페이지는 최대 100행이고 300ms 안 전체 DOM admission과 선택/앵커 계약이 있다. 새로운 DOM windowing으로 그 계약을 임의 대체하지 않음 |
| bvaughn/react-window | 17,197 | MIT | 2026-10-19 01:00:27 | 이번 범위 보류. 같은 이유이며 두 가상화 엔진을 함께 넣지 않음 |

실측 명령: `gh api repos/<owner>/<repo> --jq '{repository:.full_name,stars:.stargazers_count,license:.license.spdx_id,pushed_at:.pushed_at}'`. 별은 품질 통과 근거가 아니다. pushed_at은 최근 커밋 작성 시각과 구분한다.

목록은 SQLite에서 최대 100개를 골라 IPC로 보내고 기존 `useProgressiveList`와 CSS `content-visibility:auto`를 재사용한다. 스레드 카드는 페이지당 20개, 고정 높이의 스크롤 영역으로 제한한다. 이는 페이지 경계와 브라우저 렌더 생략이며 **새 DOM 가상화 라이브러리 도입 완료로 표시하지 않는다**. 이후 무한 스크롤이 승인되면 TanStack Virtual을 직접 사용하고 기존 admission 계약 변경을 §8에서 먼저 확정한다.

Node 참고: [SQLite 공식 API](https://nodejs.org/api/sqlite.html), [Node 라이선스](https://github.com/nodejs/node/blob/main/LICENSE). 가상화 API: [TanStack Virtual](https://tanstack.com/virtual/latest/docs/api/virtualizer), [react-window](https://github.com/bvaughn/react-window).

브라우저 가르치기는 사용자 결정대로 Stagehand, @puppeteer/replay, node-window-manager를 라이브러리로 채택하는 별도 범위다. 이 메일 과제에서 직접 구현으로 대체하지 않는다. 제품 브라우저 구현은 이번에 시작하지 않았다.
