# Mail attachment reading and chat images

Attachment reading was enabled already. The remaining Windows cache gate incorrectly discarded successful Word/Excel/PowerPoint parser results unless their reader was `office_com`. Background attachment selection also excluded local-folder mail when no portal account was connected.

## Changes

- Consume successful attachment records with matching original and attachment hashes, consistently with the parser-first, Windows Office-fallback policy of 2026-10-14. Retain the COM reader's ACL, ReadOnly, hash, macro/link and cleanup protections.
- Include eligible local-folder mail in the automatic attachment queue. Previously unsupported records become eligible again; already completed records are reused.
- `read_personal_mail` reads unfinished selected attachments before returning evidence. A whole-mail selection covers its attachments; a specific attachment selection does not initiate reads for other attachments. Cancellation and changed originals stop the read. Individual unsupported/password/reader failures remain explicit and do not create citations.
- Image preview remains read-only and never claims OCR success. Explicit image analysis uses the connected vision-capable model, persists its extracted description, and reuses it for future reads. Background mail models use their own provider catalog instead of the currently active chat provider's models.
- Image source receipts contain IDs and hashes, not image payloads. Answer thumbnails fetch validated raster originals lazily through `previewImage`, deduplicate cited/consulted entries and expand inline. A changed/missing original clears the image and offers its source action. Opening a historical chat does not run vision inference.
- The image reader now exposes the existing “대화에서 질문” action. Search coverage distinguishes unread attachments from attachments whose contents were actually read.

## Validation and limits

24 focused tests pass, including real DOCX/XLSX/PPTX bytes through the worker, local attachment reading without credentials, a simulated Windows cache branch, pending attachment evidence, image analysis/cache reuse, provider routing, stale-source rejection, mail search and Personal Wiki evidence. A Chrome component test covers lazy image display, deduplication, expansion/collapse, narrow viewport and changed-original recovery. Electron build, initialization-order and icon checks pass.

Screenshots and UI results: `verification/mail-attachments-2026-10-15/`.

This is not universal format support or a native Windows Office/NASCA test. Existing PDF text, OOXML and UTF-8 parsers remain bounded; images require an available compatible model. Password-protected, damaged, unsupported and oversized documents report their actual limitation. Scanned PDF OCR and embedded Office images are not added by this change. Office COM execution and corporate protected files require their Windows environment. No installer or release was generated.
