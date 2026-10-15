# Answer presentation

Newly delivered answers now reveal in reading order with a short ink fade (up to 980 ms). Existing conversations, questions and reduced-motion mode remain immediate. This is presentation of the reviewed answer; it does not expose the actor's raw intermediate stream or change review/approval boundaries, provider latency or stored messages.

The shared MessageBody has an opt-in post-sanitization Markdown transform. Paragraph text is split at grapheme boundaries, up to 160 presentation units; lists, tables, code and citations appear as intact units. Layout, selectable text and code-copy payload remain complete. Very large or structurally dense documents skip the effect. No character timers or per-frame Markdown parsing; the hook drops presentation spans after 1100 ms. History/navigation do not replay it.

Evidence: seven unit checks including code highlighting, the real React/Chromium fixture (`node scripts/check-answer-reveal.mjs`), and Electron bundle build passed. Browser coverage includes reading order, constant height, exact text/code, working citations, repeated rendering, conversation changes, questions, empty state, reduced motion and 440px viewport. Screenshots/results are in `verification/answer-reveal-2026-10-15/`. Fixture content is synthetic; Windows installer and live-provider latency were not measured.
