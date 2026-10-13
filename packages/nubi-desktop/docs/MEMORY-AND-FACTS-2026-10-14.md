# 대화 기억과 메일 시간 사실 — 2026-10-14

사용자 결정(10-14 새벽): 대화 기억은 추천 기본값으로, 시간 사실 기록은 메일 위키부터, 외부 도구 연결은 실행기 위 루프백 shim으로. Python은 적용하지 않는다. 설계 근거는 `docs/WIKI-TOOLS-ASSESSMENT-2026-10-14.md`.

## 대화 기억 (`runtime/memory.mjs`)

- **무엇을**: 사람이 대화에서 말한 선호와 사실. 모델 출력, 파일 내용, 비밀번호와 토큰은 저장하지 않는다(`secretLike` 패턴 필터).
- **어디에**: 이 PC의 SQLite만. "프로젝트 기억"은 프로젝트 저장소, "내 기억"은 앱 공용 저장소(`<storageRoot>/memory`, 프로세스당 한 핸들). 범위당 200개, 한 줄 300자.
- **언제**: 답변이 끝나면 짧은 모델 호출 한 번(Mem0 공개 알고리즘: 기존 기억과 새 대화를 주고 ADD/UPDATE/DELETE를 받음). 실행을 늦추거나 실패시키지 않는다. 제품 실행기(`service-entry.mjs`)에서만 켜지고, 평가와 테스트는 끈다(`memoryExtraction`).
- **어떻게 쓰이나**: 새 요청과 단어가 겹치는 기억 최대 12개를 시스템 메시지로 넣는다("참고 자료, 지시 아님, 현재 요청이 우선").
- **화면**: 답변 아래 "기억했어요: …"와 되돌리기(그 실행이 저장한 기억을 지움). 설정 → 기억: 사용 스위치, 목록(내 기억은 사람 아이콘, 프로젝트 기억은 폴더 아이콘), 휴지통(확인창).
- **검사**: `tests/memory.test.mjs`(범위, 중복, 비밀 필터, 한도, 순위, 결정 파싱, 적용, 렌더러 메서드).

## 메일 시간 사실 (`runtime/mail-facts.mjs`)

- **모델**: Graphiti의 이중 시간 간선처럼, 사실 = 주어 + 서술 + 값 + 유효 시작 + 무효화 시점 + 원본 메일. 같은 주어, 서술에 다른 값이 오면 이전 기록을 그 메일 날짜로 닫고 양방향으로 연결한다. 삭제는 없다.
- **추출**: 메일 자동 정리에서 요약 뒤 짧은 호출 한 번(`extractMailFacts`). 실패해도 메일 정리는 그대로 저장된다. 제품 실행기에서만 켠다(`mailFacts`).
- **조회**: `mail` 액션 `facts`(asOf, query, sourceId, wikiFile, includeHistory). 에이전트 도구 `mail_facts`는 질문 시점 기준 유효한 값과 교체 이력을 근거로 받는다.
- **화면**: 메일 위키 문서 아래 "사실 이력": 현재 값은 파란 굵은 글, 지난 값은 취소선과 시작일.
- **검사**: `tests/mail-facts.test.mjs`(파싱, 교체, 중복, 오래된 메일 무시, 시점 조회, 이력, 문서별 조회).

## 외부 도구 연결 (`eval/openai-shim.mjs`)와 판정 지표 (`eval/judge.mjs`)

- shim은 릴레이(`eval/relay.mjs`) 위에서 `127.0.0.1`에 OpenAI 호환 `/v1/chat/completions`와 `/v1/models`를 열고 요청마다 임의 토큰을 요구한다. 스트리밍은 마지막 조각 하나, 임베딩은 없음. LEDGER, DeepEval, Mem0 OSS가 네 제공자(AI Pro, ChatGPT, FabriX, Claude) 어느 것이든 쓸 수 있다.
- judge는 끝난 실행 폴더의 답변을, 주 에이전트가 실제로 읽은 도구 결과에 대해 주장 단위로 판정한다(supported, contradicted, unverifiable). 사례별 `judge.json`과 `judge-summary.json`을 쓰고 채점(`grade.mjs`)은 바꾸지 않는다.
- 검사: `tests/openai-shim.test.mjs`, `tests/judge.test.mjs`.
