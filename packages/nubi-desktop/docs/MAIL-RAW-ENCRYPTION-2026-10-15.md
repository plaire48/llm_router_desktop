# Mail original encryption correction

The earlier mail vault encrypted generated Wiki pages only. `message.eml`, the body-bearing `manifest.json`, and extracted attachment `.bin` files still remained plaintext. This did not fulfill the requested original-mail encryption.

## Implemented

- Automatic original storage writes only `message.eml.enc`, `manifest.json.enc` and attachment `.bin.enc`. MIME/HTML/image/attachment readers decrypt bytes in memory, retaining existing plaintext SHA-256 receipts, citations, parsing and Office read contracts.
- AES-256-GCM uses a random 96-bit nonce and 128-bit authentication tag per file. The authenticated context binds the source ID and logical filename, survives relocation, and rejects ciphertext swapped across messages. Binary contents remain byte-identical after decryption.
- A separate `mail-raw-key` is saved through the existing trusted main/worker connection vault. Production has no plaintext or test-key fallback. A missing key for existing encrypted storage is an error, not a request to regenerate a key. The Electron vault uses OS protection; Linux basic-text storage remains rejected.
- Legacy managed raw directories are converted asynchronously. Write encrypted temporary file, verify decrypted bytes, rename, verify again, recheck original, then unlink plaintext. Disk full, authentication errors or conflicting originals preserve the existing bytes. A crash with both copies is recoverable. Retry resumes conversion; import receipts are unchanged.
- Moving storage copies ciphertext, checks hashes and commits the new path before deleting the old folder. Key failure blocks new intake. Status distinguishes original encryption, Wiki encryption and migration progress.

## Boundaries

- Explicit user export still returns normal EML or the original attachment after choosing Save. Imported source folders outside the managed raw store are never changed.
- This correction encrypts managed originals and their body manifests, not every app record. SQLite queue metadata, attachment extraction records, conversation evidence and the existing active Wiki session copy are separate plaintext-derived storage surfaces. Do not describe the entire application or every mail-derived datum as encrypted.
- Office COM's protected temporary file/readback/cleanup contract is unchanged; no NASCA bypass. Removing a plaintext file is not a guarantee of physical erasure from SSD snapshots or backups.
- A protected key is required to read these stored originals after relocation. Do not delete the connection vault or promise portability to another Windows account.

## Method and sources

Reuse Node's standard authenticated encryption and the existing OS-backed key store, adding no crypto dependency: [Node Crypto](https://nodejs.org/api/crypto.html#class-cipheriv), [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage). The original bytes use a separate binary format and key rather than the Wiki UTF-8 codec. Tests use an explicit memory-vault fixture, never a runtime test-mode exception.

## Related fixes

- The user-opened Samsung `abnormal-logout` and `logout` pages acknowledge one unambiguous visible confirmation button once per document before waiting for manual login. Exact HTTPS host/path checks apply inside and outside the injected function. Password forms and ambiguous buttons are not submitted. This handles HTML confirmation buttons; native JavaScript/system dialogs require separate real-page evidence.
- The inquiry UI uses `#support`. IPC now permits hash routes only on the bundled `app://bundle/index.html` main document, preserving exact sender/frame/document checks. Other documents and subframes remain blocked.

## Validation

See `tests/mail-raw-encryption.test.mjs`, related mail regression tests, `tests/mail-logout-confirm.test.mjs`, `tests/renderer-scope.test.mjs`, `scripts/check-mail-portal-login.mjs` and `scripts/check-inquiry-ipc.mjs`. Local source and isolated Electron tests do not establish actual Samsung SSO, Windows DPAPI, Windows 11 installation, or release publication.

Final local results: 178 related tests passed, 0 failed, 0 skipped. Identity check and Electron build passed. Actual Electron fixture checks passed for logout acknowledgment followed by SSO POST/opener/session verification and for inquiry hash-route IPC. A packaging regression test verifies the injected confirmation script remains self-contained after minification. Windows DPAPI, actual company pages and the updated Windows installer have not been verified or published in this change.
