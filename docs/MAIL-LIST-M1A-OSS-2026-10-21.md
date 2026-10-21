# M1-a OSS 선택

2026-10-21. 앞선 [M1 표](MAIL-LIST-OSS-2026-10-21.md)의 node:sqlite 채택을 유지하고, 목록/검색 분리에 실제 사용한다. 새 의존성은 추가하지 않는다.

| 후보 | 별(gh api 실측) | 라이선스 | pushed_at (UTC) | 결정 |
|---|---:|---|---|---|
| nodejs/node의 node:sqlite | 122,524 | Node MIT. API NOASSERTION은 기존 LICENSE 원문 확인과 구분 | 2026-10-20 17:07:15 | 채택. 기존 Store와 같은 SQLite, 준비된 쿼리, SAVEPOINT, 디스크 인덱스와 worker를 직접 사용 |
| WiseLibs/better-sqlite3 | 7,522 | MIT | 2026-08-10 03:10:10 | 보류. 현재 내장 API로 필요한 계약 구현 가능. 새 네이티브 의존성 반입 금지 유지 |
| sql-js/sql.js | 13,675 | MIT 원문 확인. API NOASSERTION | 2026-10-19 08:51:38 | 보류. 이번 Desktop 디스크 SQLite 경로에 별도 WASM 엔진을 추가할 필요 없음 |

명령: `gh api repos/<repo> --jq '{repository:.full_name,stars:.stargazers_count,license:.license.spdx_id,pushed_at:.pushed_at}'`. sql.js 라이선스는 `/license` 원문을 추가 확인했다. 별/최근 push는 품질 합격이나 최근 커밋 작성 시각이 아니다.

근거: [Node SQLite API](https://nodejs.org/api/sqlite.html), [SQLite 스크롤 커서 비교](https://www.sqlite.org/rowvalue.html#scrolling_window_queries), [LIKE와 ESCAPE](https://www.sqlite.org/lang_expr.html#the_like_glob_regexp_match_and_extract_operators), [sql.js LICENSE](https://github.com/sql-js/sql.js/blob/master/LICENSE).

구현은 날짜/ID keyset을 기본으로 하고 번호 페이지 직접 이동은 SQL에서 앵커 하나를 찾아 기존 UI를 유지한다. API 기본 50행이며 기존 UI의 명시적 10/20/50/100행 선택과 100행 admission 검사는 보존한다. 답31에 따라 큰 메일함의 임시 검색은 제목/보낸이/받는이의 SQL LIKE에 한정하고 `%`, `_`, `\`를 리터럴로 escape한다. FTS5/본문 평문 파일과 새 가상화 의존성은 포함하지 않는다.

주의: 현행 Node 웹 문서의 최신 버전과 실제 시험 Node v25.4.0은 다르다. 사용한 DatabaseSync/StatementSync API는 로컬 실행 시험으로 따로 확인했다. 실행 근거는 M1-a 보고서에 기록한다.


답31 후속: 작은 메일함은 기존 MiniSearch를 새 의존성 없이 재사용한다. 첫 비어 있지 않은 질의에서만 생성하며20,000통 또는 추정200MiB 이상이면 메타 검색으로 제한한다. 새 본문 캐시는 메모리에만 두고 디스크에는 본문을 쓰지 않는다. `node:sqlite`의 복합 인덱스와 [covering index](https://www.sqlite.org/queryplanner.html#covidx), [MATERIALIZED CTE](https://www.sqlite.org/lang_with.html#materialization_hints)를 실제 사용해 ID50개를 고른 뒤 원문 아닌 표시 메타만 읽는다. 메타 FTS5도 답31에서 허용됐지만 LIKE 경로로 목표 수치를 확인하므로 이번에는 추가하지 않았다. 본문 FTS5와 암호화 Q22는 대기한다.
