# Image inference wait repair — 2026-10-01

Released 1.4.45 uses the ordinary inference policy for images: 120 seconds without parsed model activity, 300 seconds per attempt and up to three retries. A completely silent image request can wait about eight minutes plus backoff. This is a source-confirmed mechanism, not a measurement of the user's AI Pro server.

Image-bearing requests now use a 30-second inactivity deadline, 8-second slow feedback and zero automatic retries. The existing 300-second ceiling for actively streaming inference stays unchanged. Text-only inference keeps its policy. Images and action receipts remain intact; the change does not silently replace visual evidence with DOM or replay a browser action. Large-context timeout handling does not resubmit the timed-out image through compaction. Existing task error/resume handling receives model_timeout.

User follow-up: remove the separate image_model progress operation. Images remain in the ordinary inference request, normal wait/error progress stays visible, and actual model routing remains in context metadata. Timeout and late-output handling remain in the existing inference boundary.

Method: retain the bundled MIT-licensed p-retry 8.0.1 and supported retries/signal controls, with the existing AbortController request race. No new dependency. Official reference: https://github.com/sindresorhus/p-retry . Reducing all model limits was rejected because ordinary long reasoning and actively streaming image answers should retain their existing behavior.

Focused verification: node --test tests/model-wait-api.test.mjs tests/model-routing.test.mjs tests/model-recovery.test.mjs — 18/18. Virtual-clock API tests reproduce a silent transport that ignores abort and prove one request, the 30-second boundary, closed progress and discarded late output; a separate active image stream exceeds 30 seconds and completes. Synthetic tests do not establish real Qwen latency or Windows Samsung Browser behavior. Full release gate was not rerun.
