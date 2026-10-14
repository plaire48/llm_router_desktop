# 메일 위키 품질 (2026-10-14)

사용자 요청: 메일을 위키로 만들 때 Graphiti, LangExtract, Talon의 방식으로 품질을 올린다. 외부 Python 서비스는 들이지 않고, 같은 효과를 내는 부분을 누비 런타임(JavaScript)에 직접 둔다.

## 적용한 것

| 참고한 도구 | 누비에서 하는 일 | 위치 |
| --- | --- | --- |
| Talon (답장 인용 제거) | 요약과 사실 추출 전에 인용 답장, 서명, 전달 머리글을 벗긴다. 본문 전체가 인용이면 원문을 그대로 쓴다. | `runtime/mail-thread.mjs` `stripQuotedReply` |
| 메일 헤더 보존 | Message-ID, In-Reply-To, References, 발신, 수신, 참조, 날짜를 페이지 front matter에 쓴다. `thread` 키가 대화 묶음 열쇠다. | `runtime/mail-thread.mjs` `threadKey`, `mailFrontMatter`, `runtime/mail.mjs` |
| Graphiti (관계 확장) | 같은 `thread`의 페이지를 날짜순으로 이어 지도와 문서 화면에 사슬로 보인다. 본문이 서로 링크하지 않아도 된다. | `electron-app/wiki-frontmatter.cjs` `threadEdges`, `electron-app/wiki-library.cjs` |
| LangExtract (근거 있는 추출) | 사실마다 종류(`request`, `approval`, `deadline`, `decision`, `amount`, `contact`, `fact`)와 원문 인용(`quote`)을 받는다. 요청, 승인, 기한, 금액은 인용이 본문에 없으면 버린다. | `runtime/mail-facts.mjs` `groundFacts`, `STRICT_KINDS` |

## 페이지 형식

```
---
type: Mail
title: "Re: 일정 확인"
description: "첫 문장 요약"
tags: ["mail", "결재"]
thread: "<루트 message id 또는 정규화한 제목>"
message_id: "<2@x>"
in_reply_to: "<1@x>"
from: "홍길동 <hong@example.com>"
to: "a@example.com, b@example.com"
date: "2026-10-02T01:00:00Z"
---
# Re: 일정 확인
...
```

`describeWikiPage`는 `thread`가 있는 페이지에만 `thread`, `messageId`, `inReplyTo`, `date`를 붙인다. 다른 페이지의 모양은 그대로다.

## 대화 묶기 규칙

1. `References`의 첫 항목이 있으면 그것이 열쇠다.
2. 없으면 `In-Reply-To`, 그다음 자기 `Message-ID`.
3. 헤더가 전부 없으면 제목에서 `Re:`, `Fwd:`, `[외부]` 같은 접두어를 벗긴 정규화 제목을 쓴다.

## 하지 않은 것

- Graphiti, LangExtract 서비스 설치. 사내 PC에 Python 서비스를 추가로 띄우지 않는다는 제약 때문이다.
- 사람, 조직 노드를 따로 만드는 일. 지금은 `from` 헤더만 보존한다. 필요해지면 `wiki-library`의 `edges`에 `kind:'person'`을 더하는 방식으로 확장한다.
- 이미 만든 메일 페이지의 재작성. 새로 수집하는 메일부터 적용된다.

## 검사

- `tests/mail-thread.test.mjs` 인용 제거, 열쇠 규칙, front matter.
- `tests/mail-facts.test.mjs` 근거 없는 엄격 항목 제거.
- `tests/wiki-frontmatter.test.mjs` 헤더 읽기와 사슬 간선.
