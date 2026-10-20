# Q3 v2 릴리스 입력 검사

실제 Claude 업로더의 main d0643712 기준 후보를 `RELEASE_INPUTS_GATE=1`로 dry-run해 exit0을 확인했다. --push는 사용하지 않았다. v1의 로컬 임시 트리 통과는 generated/node_modules를 포함한 시험 조건이어서 실제 후보 통과를 증명하지 못했다. 실제 업로더의22건 실패 원본도 보존한다. v1 인계는 이 보고서로 정정한다.

## 변경과 결정

상대 import는 import하는 파일의 디렉터리 기준이다. 형제 패키지는 file: 의존성이나 실제로 소유 패키지 루트 밖으로 나가는 경로로만 발견한다. eval/hard-10의 ../candidate.mjs와 일반 문자열 배열을 형제 패키지로 해석하지 않는다. generated는 Git 존재를 요구하지 않고 관측한 esbuild outfile/outdir→entryPoints와 전이 import 원본을 요구한다. 생성기 스크립트도 원본과 SHA로 묶고, 생성기 없는 출력은 거절한다. node_modules 자산은 소유 package.json 선언과 lockfile의 해당 설치 항목을 검증한다. 실제 설치/Windows 성공을 이 검사로 표시하지 않는다.

새 회귀 후보에는 generated/node_modules가 없다. 누락 원본, 생성기 부재/변경, 잠금/선언 부재, verification 입력을 각각 거절한다. 출력 디렉터리와 copy 목적지를 원본 파일로 오인하지 않는다. 기존 Git 객체 API와 TypeScript5.9.3만 재사용하며 새 의존성0. 이전 gh api OSS 표는 Git/TypeScript/Nix의 기존 도구·입력 고정 패턴 참고이며 새 엔진을 도입하지 않았다.

## 검증과 비용

v2 실패 시험부터 작성했다. 사용자22건과 실제 후보에서 추가로 드러난 경로 오인식을 보완했다. 새 시험8개, Q3 전체20개와 기존 게이트 분리/워크플로4개를 집중 실행해24/24, 실패0, wall0.445초를 확인했다. 실제 Windows/Office 네이티브 시험 추가0, Git CLI를 쓰는 기존 회귀1개. 로컬 소요와 최종 실제 후보 tree/SHA는 아래 명세 및 원본 JSON에 고정한다. CI18차 unit16:12/ui8:07, 전체16:16은 릴리스 계획의 Claude 기록이며 v2 추가 후 CI 소요는 미측정이다. 긴 전체 게이트는 Actions가 판정한다.

최초 업로더 v2 후보: base d0643712c7803dda46e8ea182556972fc7039f5a, tree7c5efdcc7cb7064edf6d2e18b213f3ba8611c477, exit0, 원본1,086개/생성 출력9개/잠금 의존성4개. 생성기 해시 바인딩과 Windows workflow를 포함한9파일 후보도 실제 업로더 dry-run exit0이다. 최종 tree/SHA와 원본 JSON은 명세로 인계한다. 후보를 소스 폴더 전체로 채우거나 generated/node_modules를 임시로 추가하지 않았다.

## 인계와 남은 경계

기존9파일 묶음: 검사기/시험/Windows workflow, Desktop AGENTS, 릴리스 계획, CI-GATES, HOTFIX/INSTALL 초안2개, 이 보고서. SHA와 정확한 전체 경로, 고정 스냅숏, 최종 dry-run JSON/로그, 1280/440 CLI 검토용 캡처는 `.superpowers/sdd/2026-10-20-release-acceptance/q3-v2-upload-inputs.json`에 둔다. CLI 캡처는 제품 UI가 아니다.

Claude는 이 묶음을 검토해 올린 뒤 업로더 게이트를 기본 켬으로 바꾼다. Codex는 외부 업로더 기본값이나 릴리스 브랜치를 바꾸지 않는다. Windows workflow 단계는 실제 후보 exit0 뒤 인계 묶음에 포함한다. Windows 실행/패키징/실계정/설치판은 미검증. 사용량 초기화는 main d0643712에 업로드됐으며 별도 재업로드하지 않는다.

지정 후보 차단(2026-10-21): G5 포함93파일의 첫 실제Claude업로더 대조에서 `release_input_changed`4건이 나왔다. 병행 작업이 이어져 다음 대조에는 `runtime/openwiki-source.ts`까지5건이었다. 정확한 후보별 수치/경로는 최신 SHA명세와 입력 검사 JSON을 따른다. main a837ad61에 없는 병행 위키 문맥 접기/검토 복구 변경(`extensions/aipro-chat/openwiki-agent.js`, `packages/nubi-desktop/runtime/desktop-features.mjs`, `packages/openwiki/src/agent/repository-runner.ts`, `packages/openwiki/src/agent/repository-semantic-review.ts`)이 현재 compile 입력에 포함된 원인이다. 이 병행 파일들을 임의로 업로드 목록에 넣거나 비교에서 빼지 않았다. 최신93파일 명세는 **로컬 검토용, 후보 입력 게이트 차단** 상태다. 이전91파일 실제후보 exit0는 이전소스 증거로만 유지한다. Claude가 병행 변경을 검토해 같은 후보에 정합시킨 뒤 실제 입력 게이트를 다시 돌려야 한다. 상세 SHA는 `.superpowers/sdd/2026-10-20-release-acceptance/q3-q8-g5-parallel-inputs.json`.
