# 브라우저 선행 확인과 창 따라붙이기 스파이크

2026-10-21. 설계 §12의 1과 2만 준비했다. **제품 연결 완료가 아니라 Windows 사용자 실행용 실험 도구다.**

## 결과와 결정

- [회사 PC 확인표](BROWSER-TEACH-PC-CHECK-2026-10-21.md): 압축 해제 확장 로드, DeveloperToolsAvailability와 관련 정책, 실제 관찰, 확장 팝업 검사 권한을 따로 기록한다.
- [실험 도구와 실행 안내](../tools/browser-window-follow-spike/README.md): node-window-manager 2.2.4와 koffi 3.3.3을 제품 밖에 고정했다. 라이선스, native 빌드 요구와 실패 기록 양식을 포함한다.
- `nwm`의 setBounds/MoveWindow와 `koffi`의 SetWindowPos를 각각 이동 50회와 크기 변경 50회로 비교한다. 전체 poll, 안정 시점 오차, 최대 오차, 호출 p95, 복원 결과를 JSON에 보존한다. 빈 CSV는 두 경로 각각 100행이다.
- 기존 확장의 연결 상태와 `window-proof.html`을 이용한다. 별도 연결 서버, CDP 포트, 로그인 자동화, 쿠키 복사는 추가하지 않았다. 경로/PID/HWND가 달라지면 이동을 중단한다.
- 기존 Windows 브리지와 도킹 코드가 소스에 이미 있어 설계 §3의 “없음” 표와 차이가 있다. 또한 현재 확장은 새 전용 창을 만드는 대신 사용자가 연결한 탭의 창을 사용한다. 실험에서는 사용자가 테스트 전용 창을 만든다. 제품/설계 문서는 변경하지 않았다.

## 검증

| 확인 | 결과 |
|---|---|
| 실패 시험 먼저 | core.mjs가 없는 상태에서 ERR_MODULE_NOT_FOUND, exit 1 확인 |
| 최종 순수 Node | **12/12 통과**, 132.0565ms, 새 native 실행 시험 0 |
| mjs 문법 검사 | 5파일 통과 |
| Mac에서 native 실행 요청 | `windows_x64_required`, exit 1. Windows DLL 호출 전 차단 |
| M6/C7 지정 업로드 파일 | **11/11 기존 SHA 일치** |
| 제품 전체 test:gates | 미실행. 제품 코드/검사/의존성/Actions 변경 없음 |
| Windows 빌드 / DLL / 실제 100회 | 미실행, 사용자 측정 대기 |

검증 원본: `.superpowers/sdd/2026-10-21-browser-window-follow-spike/node-tests.log`, `verification.json`.

## 남은 위험과 경계

창 겹치기는 자식 창 임베딩이 아니다. DPI/숨은 테두리, 혼합 배율, 포커스, IME, 팝업과 최소화 뒤 앞뒤 순서는 실제 Windows 캡처와 기록으로 확인해야 한다. 수동 증명은 제품의 상시 연결 generation 검증을 대체하지 않는다. 연결 해제 시 사용자가 중단한다. 강제 종료 뒤 복원과 같은 PID의 HWND 재사용도 제품 수명 관리의 후속이다.

현재 캡처 **없음**. Windows에서 회사 본문 없는 화면을 사용하고 README의 캡처 경로 칸에 기록한다. 숫자 통과를 시각 품질이나 사내 자동화 성공으로 표시하지 않는다. M1, 녹화기, 워크플로우 연결, 배포와 업로드는 시작하지 않았다.

## 이번 변경 파일 전체

1. `docs/BROWSER-TEACH-PC-CHECK-2026-10-21.md`
2. `docs/BROWSER-WINDOW-SPIKE-2026-10-21.md`
3. `tools/browser-window-follow-spike/.gitignore`
4. `tools/browser-window-follow-spike/README.md`
5. `tools/browser-window-follow-spike/config.example.json`
6. `tools/browser-window-follow-spike/core.mjs`
7. `tools/browser-window-follow-spike/core.test.mjs`
8. `tools/browser-window-follow-spike/measurement-template.csv`
9. `tools/browser-window-follow-spike/native.mjs`
10. `tools/browser-window-follow-spike/package.json`
11. `tools/browser-window-follow-spike/package-lock.json`
12. `tools/browser-window-follow-spike/proof.mjs`
13. `tools/browser-window-follow-spike/run.mjs`

SHA-256 명세: `.superpowers/sdd/2026-10-21-browser-window-follow-spike/upload-inputs.json`. 향후 검토용이며 업로드는 하지 않았다.
