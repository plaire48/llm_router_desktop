# Mail progress without a frozen-looking screen

## Applied

- Reuse the existing Wiki `nubi-progress` track, color, radius, animation and reduced-motion rule through `TaskProgressBar`. No new palette or modal chrome.
- Mail folder scanning shows an indeterminate bar and actual discovered-file count. Importing uses completed/total files. The existing elapsed-time display and stop/resume behavior remain.
- Raw-mail relocation reports asynchronous inventory, copied-and-hash-verified bytes/files, path commit, cleanup and failure recovery. Percentages are stage-specific and never derived from elapsed time.
- `storageProgress` returns only a small job snapshot, without querying every mail row. The modal polls it without overlapping requests and stops polling when inactive/unmounted. Controls stay protected against duplicate writes while progress/time continue to update.
- Native folder selection starts a background runtime job and polls its ID. It no longer waits for the entire copy in one worker RPC that can expire after four minutes. Failed or mismatched jobs are not treated as success. Existing originals remain authoritative until verification and path commit.
- Fixed native `confirmStorage` forwarding of `includeAttachments`; source-runtime tests alone had not covered that IPC field.
- Git cloning and Wiki initialization already report real phase progress and elapsed time; retain their established flows.

## Verification

- Runtime progress/storage/resume tests: 14 passed. A further focused rerun of all six raw-storage tests passed after adding invalid-job protection assertions.
- Actual filesystem fixture: 96 files copied and verified; progress was observable during the operation; lightweight status did not enumerate mail rows. Background job IDs, overlapping requests, errors and path preservation checked.
- Actual Electron renderer: isolated OpenWiki/config/mail directories; real confirm-storage IPC, native folder-picker stub with real background relocation/status path. Slow-copy visual progress uses a synthetic 5/11 state. Timer updates and modal bounds verified at 700x560; normal form also checked at 1100x800.
- Browser UI fixture: determinate import, indeterminate discovery, discovered counts, reduced motion, cancel/resume dispatch and narrow layout.
- Design validation and Electron build passed. No Windows installation or company-portal performance claim; no release published.

Screens: `verification/mail-storage-resume/moving-700.png` and `verification/mail-storage-resume/import/resume.png`.
# 진행 중 조작 보호

메일 폴더를 선택하거나 가져오는 동안 포털 로그인, 추가 폴더 선택, 정리 모델/설정과 저장 위치 변경을 비활성화한다. 실행 중인 가져오기의 중지는 유지하며 중지/완료 이후 버튼을 복구한다. 별도 색이나 레이아웃 없이 기존 CX 비활성 스타일을 사용한다. Git 프로젝트 연결 중 모델 선택도 잠그고, 위키 변경 반영 요청은 연속 클릭을 즉시 차단한다.

추가 검증: 메일 UI에서 로그인/폴더 선택 비활성, 중지 활성, 중지 후 로그인 활성 복구를 확인했다. 관련 가져오기/갱신 상태 검사 13개와 공통 디자인 검사가 통과했다.

