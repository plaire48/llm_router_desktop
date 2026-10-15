# Mail body images

The former text-only policy removed `img` elements and omitted MIME inline parts from agent evidence. Body images now remain separate from downloadable file attachments, but are eligible for question-time vision reading.

- CID images come from hash-verified original MIME parts. Data-URL raster images are resolved from the same verified EML, without rewriting manifests or creating fake file attachments.
- The reader replaces embedded image payloads before truncating HTML. DOMPurify, script-free iframe isolation, no-referrer and the existing style allowlist remain. Filesystem URLs, SVG and executable content are excluded. Failed image loads show a compact placeholder.
- HTTP/HTTPS linked images can render in the reader. Their bytes are **not yet collected for AI analysis**; the tool reports that limitation explicitly. Authenticated company image retrieval is not established by the local fixture.
- Questions read embedded images through the existing vision route of the active provider. A provider without a supported image model reports unavailable coverage. The main conversation/model selection remains unchanged.
- Verified extraction is cached under source and image hashes. Text evidence carries the analysis and citations, never raw base64. Existing source-opening and chat thumbnail paths accept body image references.
- Background wiki processing is unchanged; inline vision reading occurs on question. A displayed image is not treated as successful AI analysis.

Validation: MIME/data image integration tests exercise actual parsing, storage, preview, source validation, citation and cache paths with a simulated model response. Browser checks render CID and HTTP images, test isolation and 420px layout. These checks do not establish live model answer quality, company SSO image access or installed Windows behavior.

Artifacts: `verification/mail-body-images-2026-10-15/`.
