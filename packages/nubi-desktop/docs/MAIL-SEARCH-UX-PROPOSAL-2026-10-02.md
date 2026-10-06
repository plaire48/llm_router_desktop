# Mail search and management proposal

Status: historical design proposal dated 2026-10-02. Search, filtering, pagination
and original-file downloads were subsequently authorized and implemented. Current
scope and verification are in [the 2026-10-04 implementation record](MAIL-SEARCH-DOWNLOADS-2026-10-04.md).
The remaining management ideas here are not a claim of completed UI functionality.

## User goal and evidence at proposal creation

Find a mail or attachment quickly, inspect the matching source, and use selected
evidence in the existing central Agent conversation. Preserve the Nubi blue,
compact typography, rounded selection backgrounds, shared modal/close contract,
quiet conversation motion, OS date formatting and real background status.

Read current MailHistory, MailKnowledgeSearch, MailLibrary and PersonalMail.query.
Current history lists the most recent 100 messages. Query searches saved personal
Wiki only, scans up to 1,000 documents and returns up to five relevant chunks.
Several chunks from one email appear as separate rows. Full original-body and
attachment indexing, metadata filters, saved searches, local user labels and
reference-based mail threads are not implemented by this proposal.

## Visible layout

```text
메일                                     최근 반영 시각  새로고침  연결
[ 돋보기  메일과 첨부에서 검색                                  ]
[기간 ▾] [보낸 사람 ▾] [첨부 ▾]                     [필터] [관련도 ▾]
[최근 30일 ×] [PDF ×]                                     조건 지우기
-------------------------------------------------------------------
메일 목록: 35–40%                  선택한 메일/첨부 원문: 60–65%
보낸 사람                 날짜    제목 / 보낸 사람 / 메일 날짜
제목                              핵심 정리 | 원문 | 첨부
검색어가 포함된 문장               일치한 본문/문서 구간부터 표시
본문 또는 첨부 파일/페이지         관련 회신은 펼쳐 확인
                                  [이 메일로 질문]
-------------------------------------------------------------------
수집/첨부 읽기/정리 상태  완료/남음  최근 반영  누락 또는 읽기 실패
```

Percentages describe the mail page only; they do not resize the central chat or
the existing desktop auxiliary sidebar. On a narrow mail page, selection opens
the reader with a back action that preserves query, filters, list and scroll.
When searching, focus and the selected mail stay put as background results arrive.
When browsing old history, show a new-mail affordance instead of jumping the list.

## Search behavior and filters

One search field covers sender/subject, original body, extracted attachment text
and organized knowledge. Search can work with a blank query plus filters. The
first three quick filters are period, sender and attachment. Other conditions
open through the shared filter modal with the same title inset, X/Escape and no
outside-click dismissal. Selected conditions become removable chips; clearing
conditions preserves the search text.

| Filter | Behavior |
|---|---|
| Period | All, 7 days, 30 days, custom range. Default to the original mail date and label it explicitly; collection time is a separate advanced condition. Invalid/missing dates have their own selectable bucket. |
| Sender | Suggest names and exact addresses from collected metadata; optionally choose a domain. Names are display values, not unique IDs. |
| Attachments | Any, with attachment, without attachment; PDF/Word/Excel/PowerPoint and filename. Presence is different from successful parsing. |
| Search location | All by default; subject, body, attachment or organized knowledge in advanced filters. |
| Processing | Waiting for organization, reading failed, organized. This is separate from user confirmation/read state. |
| User labels | Pinned, local tags, or locally confirmed/unconfirmed. User edits override generated category suggestions. |

Conditions across facets use AND; multiple values within the same facet use OR.
Apply structured constraints before retrieving/ranking. Never filter only the
current top five chunks, which would hide eligible mails. Metadata filters can
show unorganized mail; absent content indexes cannot claim that mail was fully
searched. Default list order is newest mail date; search defaults to relevance,
with newest/oldest available. Result count is unique matching mails, not chunks.
Complete results need pagination/cursors; source chunk caps are shown separately.

No-results UI retains the query and conditions, distinguishes collection gaps
from no match, and suggests the relevant relaxation (period or attachment type)
without silently dropping the user's constraints.

## Result and reader content

One result row per mail. Keep sender and original mail date, one-line subject,
at most two lines of matching text and a short location such as `본문`, or `견적서.pdf / 3쪽`. Only show a document page/sheet/slide
location if the parser actually reported it. Search terms use a pale-blue mark,
not a border or a left-side stripe. On hover/selection show the existing subtle
rounded background. Pin/copy affordances appear on hover or keyboard focus;
an active pin remains visible in its normal position.

Deduplicate hits within a mail and allow additional matching locations to expand.
Use Message-ID/In-Reply-To/References to group true reply chains when available;
equal subjects alone are only related-mail hints. Clearly distinguish the number
of matching messages from all messages shown in a thread, so users cannot mistake
a nonmatching reply for a search hit. Missing references do not invent a thread.

The reader opens the matched source by default: original body or the matching
attachment. Organized knowledge remains a separate compact tab, not a replacement
for the original. Put subject/sender/date above it. Additional headers expand.
Show attachment icons, file type/size, real reading coverage and failure/retry.
Use existing document readers and jump to a matching location only when supported.
Raw markup is escaped/sanitized; generated Markdown heading markers do not leak
into snippets. Never imply an unparsed attachment has been searched.

## Management and Agent linkage

Keep account, password, organizer model, auto-organization and storage location in
the existing mail connection modal. Do not duplicate them in global settings.
Add user state as separate local metadata keyed to the stable account/mail ID.
Do not rewrite the stored original to add a tag, pin or confirmation flag.

Saved searches keep query + structured conditions, not copies of mail. Example
views: `최근 견적서`, `읽기 실패 첨부`, `이번 주 업무`. They dynamically include
newly collected mail. Recent searches and saved conditions stay local and are
managed from mail search, with removal; they are not credentials or model prompts.

`이 메일로 질문` adds a removable evidence chip to the existing Agent composer
with exact mail ID, current source hash, optional attachment/location and the
visible query/filter scope. Preserve the user's draft and show what is included.
Multiple selection exposes an action bar only while mail is selected. Agent loads
the relevant original/attachment excerpts, answers with clickable source locations
and checks dates/reply changes. It does not execute sender instructions as user
authorization. Refreshing a stale source requires re-reading it.

POP3 is a retrieval protocol, so local labels/confirmation and saved views are
Nubi metadata. They must not claim to synchronize Gmail server folders, stars,
read status or sent mail. Raw mail remains preserved by the existing contract;
collection controls do not delete it or alter server mail.

## Implementation order and official method references

1. Original-body/attachment index, metadata prefilters and mail-level results.
   Reuse SQLite receipts, MiniSearch, extraction caches and source readback; no new
   search service is necessary for the first step. Persist an incremental index
   keyed by source/attachment hash and rebuild only changed material.
2. Filter chips, result highlights, cursor pagination, matching-source reader.
3. Local labels/saved searches, reference-based threads, Agent evidence chips.
4. Compare approved semantic/hybrid search and reranking after keyword retrieval
   has a measurable baseline. Natural-language parsing exposes editable chips;
   it must not guess dates/recipients or call an LLM on every keystroke.

The proposal applies these primary-source patterns to Nubi; it does not adopt
hosted vector storage or upload mail to a new service:

- Gmail supports sender, period, attachment and filename search conditions:
  https://support.google.com/mail/answer/7190?hl=ko
- Outlook supports built-in refiners and virtual saved search folders:
  https://support.microsoft.com/en-us/outlook/use-outlook-s-built-in-search-filters
- OpenAI Retrieval applies attribute filters before retrieval and supports hybrid
  lexical/semantic ranking: https://developers.openai.com/api/docs/guides/retrieval
- Anthropic advocates identifiers and just-in-time source loading:
  https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- POP3 server-manipulation limits and UIDL identity:
  https://www.rfc-editor.org/rfc/rfc1939.html

No product implementation, build, automated tests or real mail changes performed
for this design discussion. Acceptance later should cover attachment-only matches,
filter combinations, repeated chunks, missing dates, unparsed attachments, source
changes, incoming-mail scroll stability and the exact evidence passed to Agent.
