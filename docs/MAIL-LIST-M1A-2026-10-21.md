# M1-a 완료 보고 — 2026-10-21

후속: main 7765864c 대조와 메일 평가 4묶음 복구, 최종 v5 측정 및 새 SHA는 `docs/MAIL-LIST-M1A-HANDOFF-2026-10-21.md`를 따른다. 아래 v4 기록은 당시 실행 이력이다.

**로컬 수용 통과, Claude 검토와 지정 업로드 대기.** 설계 §8 답31을 적용했다. 업로드/브라우저 패키지/Office 양식 코드는 변경하지 않았다. 기준 main은 작업 중405a4b48→0f945cc6→a4b9c7de로 진행됐으며 최종 명세의 base가 우선한다. 실제 main 후보 트리와 Windows는 미검증이다.

## 결과와 결정

- node:sqlite를 직접 사용하고 새 의존성은0이다. `mail_list`에 메타를 저장하며 수집/갱신과 같은 SAVEPOINT로 반영한다. 실패는 원본 행과 투영을 함께 롤백한다. 목록/개수/facets는 SQL, 목록 기본50행과 날짜/ID keyset, 기존 번호 페이지와 UI10/20/50/100 선택은 유지한다. 본문은 목록/필터 제안 때 읽지 않는다. 스레드는 계정/헤더로 묶고20행씩 제공하며 선택한 원문 ID/해시를 넘긴다.
- 답31: 작은 메일함의 첫 검색에서만 기존 MailSearch/MiniSearch를 사용한다. `setting:mail-search-max-count` 기본20,000, `setting:mail-search-max-bytes` 기본200MiB이며 설정은 이 안전 상한 아래로 조절한다. 추정은 메일당 최소16KiB와 알려진 원문/기존 캐시 직렬화 크기의6배 중 큰 값이다. 읽은 결과도 누적 재검사하고 넘으면 메타 검색으로 전환한다. 새 본문 캐시는 메모리에만 둔다. 기존3회귀 단언을 고치지 않고 통과했다.
- 큰 메일함은 제목/보낸이/받는이 LIKE와 **본문 검색은 준비 중**을 표시한다. 본문 위치 요청을 제목 검색으로 넓히지 않고, 명시적 제목 위치와 짧은 영문 단어 경계를 유지한다. 복합 인덱스에서 ID50개를 고른 뒤 표시 메타를 읽는다. SQLite worker 캐시는32MiB. 메타 FTS를 새로 넣을 필요 없이 목표를 통과했고 본문 FTS/암호화 Q22는 계속 대기한다.

## 같은 M6 30만 통

말뭉치 SHA `2f358cbab1d9ff257bcd0aa3c0ad5b69606229342432282ef413390fc85ed1ab` 동일. 새 DB에 동일 입력을 수집하고 닫았다가 다시 열어 첫 조회와35질의를 측정했다. 기존 말뭉치/DB/실패 기록은 보존했다.

| 측정 | 최초 실패 | 중간v2 | 최종v4 / 기준 |
|---|---:|---:|---:|
| 첫50통 |293.01ms|1,258.26ms|711.09ms / ≤1,000ms |
| 검색 p95 |5,878.68ms|2,227.56ms|406.49ms / ≤1,000ms |
| 최대 RSS |159.98MiB|155.81MiB|169.08MiB / ≤300MiB |

최종 sourceHashes10개 일치. 메타 저장102.52초는 조회와 별도이며 기존 전체 앱 시작/레거시 마이그레이션/실계정30만 통 성능으로 확대하지 않는다. 중간v3(359ms/330ms)도 남겼으나 최종값은v4다. 원본 `packages/nubi-desktop/verification/mail-list-m1a-20261021-v4/result.json`(환경/질의별loadavg 포함). v2는 회귀/화면 검사와 병행했고 실패로 보존했다. 최종판정의 한도를 바꾸거나 첫 표본을 제외하지 않았다.

## 검사와 남은 위험

- 기존 메일+Store **254/254,42.394초**, 실패0. 새 순수Node21건(내장SQLite/worker, Windows/COM 실행0), 집중25건(기존reset4건 포함) **833ms**. CI의 추가 비용은 다음 Actions에서 측정한다. 전체 `test:gates`는 이번 로컬에서 실행하지 않았고 분할 CI가 담당한다.
- `test:mail-ui`4스크립트 모두exit0.100행 표시1280/440 **172.6/154.6ms**, 선택/키/초안/스크롤 앵커/재진입 통과. design:check와 게이트 집합검사, runtime build exit0. 빌드의 기존 Windows Bash CJS `import.meta` 경고는 남아 있으며 Windows 성공으로 표시하지 않는다.
- 캡처(합성 UI, 실제 Beta/SSO 아님): `packages/nubi-desktop/verification/mail-thread-card/thread-{1280,440}.png`, `verification/mail-admission/mail-{1280,440}.png`, `verification/mail-metadata-scope/metadata-{1280,440}.png`(뒤 두 경로도 Desktop 아래). 좁은 표는 기존 가로 스크롤을 유지한다. 선택 범위 안내와 실제 DOM 비활성 속성도 확인했다.
- 공유 `scripts/build-runtime.mjs`는 이번 mail-list-worker 등록 외에 이전부터 있던 `typescript` external 변경을 보존했다. 그 기존 한 줄까지 포함된 파일을 Claude가 검토해야 한다. 공유 설계 문서는 답31을 읽었지만 업로드 목록에 넣지 않는다. 브라우저 가르치기/ordinal 결정/Windows 창 실험은 이번 범위 밖이다.

전체 파일과 SHA 동결본: `.superpowers/sdd/2026-10-21-mail-list-m1a-final/upload-inputs.json`. 테스트/측정/캡처 원본 위치는 같은 폴더 `evidence.json`에 있다. 아래 목록은 CI 분할6파일 묶음과 별개다.

## 지정 검토 파일

- `packages/nubi-desktop/runtime/mail-list-index.mjs`
- `packages/nubi-desktop/runtime/mail-list-worker.mjs`
- `packages/nubi-desktop/runtime/mail-list-client.mjs`
- `packages/nubi-desktop/runtime/mail-list-metadata.mjs`
- `packages/nubi-desktop/runtime/mail-search.mjs`
- `packages/nubi-desktop/runtime/mail.mjs`
- `packages/nubi-desktop/runtime/mail-reset.mjs`
- `packages/nubi-desktop/ui/MailThreadCard.jsx`
- `packages/nubi-desktop/ui/mail-thread-card.css`
- `packages/nubi-desktop/ui/MailReader.jsx`
- `packages/nubi-desktop/ui/MailHistory.jsx`
- `packages/nubi-desktop/ui/MailKnowledgeSearch.jsx`
- `packages/nubi-desktop/scripts/build-runtime.mjs`
- `packages/nubi-desktop/scripts/check-mail-thread-card.mjs`
- `packages/nubi-desktop/scripts/gate-baseline.json`
- `packages/nubi-desktop/package.json`
- `packages/nubi-desktop/tests/mail-list-index.test.mjs`
- `packages/nubi-desktop/tests/mail-list-client.test.mjs`
- `packages/nubi-desktop/tests/mail-reset.test.mjs`
- `packages/nubi-desktop/tests/mail-thread-card-fixture.jsx`
- `packages/nubi-desktop/eval/mail-corpus/measure-list.mjs`
- `packages/nubi-desktop/runtime/store.mjs`
- `packages/nubi-desktop/runtime/mail-list-service.mjs`
- `packages/nubi-desktop/runtime/mail-search-options.mjs`
- `packages/nubi-desktop/tests/mail-list-separation.test.mjs`
- `packages/nubi-desktop/eval/mail-corpus/measure-m1a.mjs`
- `docs/MAIL-LIST-M1A-OSS-2026-10-21.md`
- `docs/MAIL-LIST-M1A-2026-10-21.md`
- `packages/nubi-desktop/runtime/mail-search-budget.mjs`
- `docs/MAIL-LIST-OSS-2026-10-21.md`
