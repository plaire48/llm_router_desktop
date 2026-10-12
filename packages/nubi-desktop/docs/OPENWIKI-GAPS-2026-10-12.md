# OpenWiki 품질 점검과 수정 (2026-10-12)

사용자 요청: 누비 Workspace(Electron)의 OpenWiki 관련 기능 전체에서 부족한 점을 찾아 적극적으로 개선한다. 기준은 현재 main(작업 폴더). 같은 날 14:19에 OpenWiki-SDS가 0.6.0에서 0.7.2(upstream 27b3c76)로 올라갔고 번들도 다시 만들어졌으므로, 아침의 S29 측정(0.6.0)은 기준이 아니다. 16:56 스냅숏(후보 `03ce699b…`, 443 파일)으로 다시 쟀다(S30, `docs/LIVE-EVAL.md`).

방법: 읽기 전용 탐색으로 기능 지도를 만들고 보고된 결함을 코드로 하나씩 확인했다. 확인된 것만 고쳤고, 각 수정에 단위 검사를 붙였다. Codex가 같은 폴더를 실시간으로 고치므로 정확한 문자열 치환으로만 반영했다.

## 확인한 결함과 수정

| # | 결함 | 원인 | 수정 | 검사 |
|---|---|---|---|---|
| A | `openwiki/`가 .gitignore에 있으면 에이전트가 위키를 못 봄. 화면은 문서 N개를 세는데 `ask_openwiki`가 안 주어지고 `wiki_query`도 비고 오래됨 판정도 안 됨 | `wikiPages`, `queryWiki`가 Git 목록(`--exclude-standard`)만 씀. 화면(`listWikiPages`)은 폴더를 읽음 | `wikiPages`와 `queryWiki`의 위키 부분을 폴더 목록(`listWikiPages`)으로. docs/openspec은 그대로 Git 목록 | `tests/wiki-folder-pages.test.mjs` |
| B | 생성 중 네트워크, TLS, 시간 초과가 전부 `wiki_failed`로 표시 | 실행기는 `network`, `model_timeout`을 던지는데 안전 코드 목록은 `network_error`, `timeout`을 기다림. TLS/DNS/거부/권한 코드는 목록에 없음 | 코드 이름 대응표와 코드 추가, 화면 문구 추가. 페이지 작업자 실패가 "빈 위키"(`wiki_empty`)로 숨는 것도 마지막 모델 오류(`model_error` 이벤트)로 대체 | 같은 파일, `tests/wiki-update.test.mjs` |
| C | 갱신 중 앱 종료나 프로젝트 전환 뒤 카드가 영원히 "갱신 중" | 저장소를 닫은 뒤 중단해 기록이 `running`으로 남음. 재시작 때 정리하는 코드가 없고 중지도 안 먹음 | `wikiUpdate` 호출 때 닿을 수 없는 `running` 기록을 `failed/wiki_update_interrupted`로 끝내고 사본 제거 | 같은 파일 |
| D | "위키에 기록"만 한 프로젝트를 "위키 있음"으로 판정해 생성이 영영 안 됨 | `hasWikiPages`, `listWikiPages`가 `openwiki/nubi-evidence/`도 셈 | Nubi 기록 폴더(`nubi-evidence`, `nubi-map`)는 위키가 아님. 검색(`wiki_query`)은 `includeNubi`로 계속 포함 | 같은 파일 |
| E | Git 없는 폴더에서 프로젝트 자료를 열 때마다 "위키 기록을 확인하지 못했어요" | `git rev-parse HEAD` 무방비 호출 | 커밋 없는 폴더는 기준 커밋 없음으로 기록 | 같은 파일 |
| F | 위키 페이지 하나가 1 MB 초과나 비UTF-8이면 `ask_openwiki` 전체 실패 | `documentSnapshot`이 첫 오류에서 멈춤 | 위키 질문의 스냅숏은 못 읽는 페이지를 건너뛰고 `sourceComplete:false`. 문서 분석(`analyze_documents`)은 그대로 거부 | 같은 파일 |
| H | 한글이나 공백이 든 파일 이름이 `git status`에서 따옴표와 8진수 이스케이프로 나와 커밋 안 한 변경 목록, 갱신 사본 덮어쓰기, 결과 변경 목록에서 빠짐 | `--porcelain` 줄 파싱 | `-z`(NUL 구분)로 읽고 이름 바꾸기 원본은 건너뜀 | 같은 파일 |
| G | 에이전트는 위키가 오래됐어도 경고 없이 답함. 실행 영수증(`wikiChangeSummary`)이 커밋만 보고, Git 없는 폴더에서는 늘 비어 있음 | 체크포인트를 안 봄 | 커밋 변경에 더해 커밋 안 한 수정과 Git 없는 폴더의 파일을 마지막 실행의 체크포인트와 비교(3,000 파일까지). Claims 해석은 비싸서 영수증에는 넣지 않음 | 같은 파일 |

| I | Wiki 전체 검토 질문이 20분을 넘김(S30 D2: 위임 158회, 평가 한도 초과) | OpenWiki 조사에 상한이 없음. 실측하니 조사자 호출 92~97회는 4분에 끝나고 11~12분이 보고서 57개를 4개씩 합치는 종합 호출이었다 | 질문 하나가 8분을 넘으면 그 질문의 모든 위임 호출(조사자, 종합)을 거절(`research_budget`). OpenWiki는 종합이 실패하면 그때까지의 보고서를 이어 붙여 부분 답으로 돌려준다(코어의 기존 경로). 조사자 호출은 실행 전체 120회까지(질문을 나눠 물어도 합산). 답에 호스트 메모를 붙여 모델이 사용자에게 부분 답임을 말하게 함. 문서 분석은 영향 없음(`wiki-` 질문만). 사용자 결정: 부분 답 허용. 실측(D2 3회, `docs/LIVE-EVAL.md` S30): 조사자만 세는 상한은 발동 안 함(1,037초, 1,141초), 종합까지 거절하는 상한은 8.4분에 끊고 768초에 정답 4/4 | `tests/wiki-research-budget.test.mjs` |

## 사용자 결정 2건 (2026-10-12)

**커밋하지 않은 수정도 갱신에 들어간다.** 전에는 Git 프로젝트의 갱신 사본이 HEAD 체크아웃이라 커밋 안 한 수정이 위키에 영영 반영되지 않았다. 상태는 작업 트리 기준으로 "갱신 필요"인데 갱신은 HEAD 기준으로 "바뀐 페이지 없음"으로 끝나 되돌아오는 고리였다. 이제 `wikiUpdate run`은 HEAD 작업 트리 위에 `git status`가 말하는 변경 파일을 작업 트리 내용으로 덮어쓴다(훅 비활성, 비공개 경로와 못 읽는 파일은 커밋본 유지). 실행 뒤 사본에 체크포인트(`openwiki/.nubi-sources.json`, 읽은 원본의 해시)를 쓰고, 상태는 체크포인트와 다른 커밋 안 한 파일을 바뀐 파일로 센다. 사용자의 수정은 실행기가 바꾼 "반영하지 않는 파일"에서 뺀다. 추적된 비공개 파일(`.env`, 키, 자격 증명)은 초기화 스냅숏처럼 사본에서 뺀다(전에는 HEAD 체크아웃 그대로 모델에 노출될 수 있었다). 카드 문구: "커밋하지 않은 변경 N개도 현재 파일 그대로 갱신에 들어가요." 검사: `tests/wiki-initialization-flow.test.mjs`(작업 트리 내용이 사본에 있고 반영 뒤 최신), `tests/wiki-update.test.mjs`. 실모델 확인(`eval/wiki-update.mjs --change uncommitted --keep`, `docs/LIVE-EVAL.md` S30): 수정 전에는 갱신이 11회/63초에 기록 파일만 고치고 반영 뒤 다시 오래됨이었고, 수정 후에는 46회/488초에 페이지 10과 Claims 5를 다시 써 반영 뒤 최신, 새 금액이 7쪽에 들어갔다.

**생성 중 원본이 바뀌어도 결과를 버리지 않는다.** 전에는 8분짜리 생성이 저장 한 번에 `source_stale`로 버려졌다. 이제 스냅숏 기준으로 발행하고 체크포인트가 그 스냅숏을 가리키므로 갱신 카드가 바뀐 파일을 보여 준다. 작업 기록에 `changedDuringRun`(생성 중 바뀐 파일 수)을 남기고 완료 줄에 "생성 중 바뀐 파일 N개, 갱신 필요"로 표시한다. 완료 줄에는 제외된 파일 수(비UTF-8, 1 MB 초과, 이진)도 보인다. 검사: `tests/wiki-initialization-flow.test.mjs`, `tests/electron-features.test.mjs`.

## 측정 (S30, gpt-5.6-sol, OpenWiki 0.7.2)

갱신 흐름(`eval/wiki-update.mjs`, 16:57~17:22): 생성 10쪽, 51회, 819초, 거절 7번(모두 재요청으로 넘김), 생성 직후 최신. 원본 변경 뒤 바뀐 파일 2, 오래된 쪽 4. 갱신 50회, 692초, 17 변경, 거절 7번, 반영 뒤 최신. 새 금액(5,500)이 8쪽에 들어갔고 옛 금액(4,500)도 7쪽에 남아 있다(이력 서술인지 오래된 서술인지는 다음 측정에서 작업공간을 보존해 확인한다).

프로젝트를 열 때 자동 생성(제품 경로, 새 `eval/wiki-init.mjs`): 일반 폴더 10쪽/571초, Git 프로젝트 12쪽/759초, 둘 다 Claims와 기록 발행, 생성 직후 최신, K1 정답. OpenWiki 과제 10건: 9건 통과, D2(Wiki 전체 검토)는 위임 158회에 20분 한도 초과. 상세는 `docs/LIVE-EVAL.md`의 S30 절.

## 남은 것

- 화면의 추론 선택기(`ui/ReasoningPicker.jsx`)에 `claude` 항목이 없어 Claude CLI 연결에서는 effort가 늘 `medium`이다. Codex가 Claude 어댑터를 고치는 중이라(19:20, 모델 ID와 effort 범위) 그쪽에 맡긴다(사용자 결정).
- 관계 지도와 DB 연결 화면이 README에는 있는데 Electron에 붙어 있지 않다(`ui/KnowledgeMap.jsx` 고아). 붙이거나 README에서 뺄 결정이 필요하다.
- Git이 없는 PC에서는 위키를 만들 수 없다(번들하지 않음). 사내 PC 기준으로는 설치돼 있다고 보지만, 아니라면 MinGit 번들이 후보다.
- 20,000 파일 상한이 `.openwikiignore`보다 먼저 적용돼 큰 단일 저장소는 초기화할 수 없다.
- 웹 호스트는 `127.0.0.1`만 받는다(`localhost:4318`은 빈 화면). 로컬 전용이면 의도된 제한이다.
- Codex의 검토 모듈 검사 2건(`tests/review-turn.test.mjs`, `tests/review-user-text.test.mjs`, 지시문 길이 4,056 > 3,700)이 실패 중이다. 이 작업과 무관하며 Codex가 만지는 중이다.
