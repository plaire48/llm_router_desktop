# Windows 창 따라붙이기 실험

설계 `docs/superpowers/specs/2026-10-21-nubi-browser-teach-design.md` §12의 2만 준비한다. **제품 코드와 의존성을 변경하지 않는다. Windows 실측은 사용자가 한다.**

## 비교할 것

같은 외부 브라우저 창을 누비의 빈 브라우저 칸에 겹쳐 놓고, 누비 창 이동 50회와 크기 변경 50회를 따라간다. 두 경로를 각각 100회 실행한다.

| 경로 | 창 찾기와 확인 | 위치 쓰기 | 독립 재읽기 |
|---|---|---|---|
| `nwm` | node-window-manager + 기존 확장 증명 페이지 | `Window.setBounds` → 내부 `MoveWindow` | koffi `GetWindowRect` |
| `koffi` | 같은 방법 | koffi `SetWindowPos` | koffi `GetWindowRect` |

두 경로 모두 koffi로 DPI와 전후 순서를 관리한다. 독립된 두 완제품 비교가 아니라 **위치 쓰기 경로 비교**다. node-window-manager의 실제 구현은 `SetWindowPos`가 아닌 `MoveWindow`다. [상류 구현](https://github.com/sentialx/node-window-manager/blob/master/lib/windows.cc).

## 기존 구현과의 관계

현재 소스에는 `browser-window-dock.cjs`, `browser-window-native.cjs`와 별도 Windows 브리지가 이미 있다. 설계 §3의 “없음” 표시는 이 소스와 차이가 있다. 이번에는 기존 도킹을 켜지 않고 실험하며 기존 제품을 교체하지 않는다.

확장은 지금 **사용자가 연결한 탭의 기존 창**에 묶인다. 전용 창을 자동 생성하는 기능은 이번에 추가하지 않는다. 사용자가 테스트 전용 외부 창을 열어 기존 확장으로 연결한다.

`background.js`는 ES module이므로 내부 `dispatch`를 콘솔 전역 함수처럼 부를 수 없다. 실험은 기존 `connect.html` 팝업의 허용된 `status` 메시지로 연결된 `sourceTab`을 얻고, **그 창에만 기존 `window-proof.html`을 잠깐 연다**. 새 연결 서버나 디버깅 포트는 만들지 않는다. 증명 탭은 기존 코드가 11초 후 닫는다.

이 수동 절차는 실험용이다. 제품용 상시 generation 바인딩이나 연결 해제 감지는 구현하지 않았다. 확장 연결이 끊기거나 다른 창으로 연결하면 즉시 Ctrl+C로 끝낸다. 같은 프로세스에서 HWND가 재사용되는 경우까지 방어하는 제품 수준의 수명 관리도 후속이다.

## 설치와 빌드 기록

| 대상 | 고정 버전 / 라이선스 | 요구 사항 | 이번 결과 |
|---|---|---|---|
| node-window-manager | 2.2.4 / MIT | 설치 스크립트가 node-gyp rebuild 실행. C++ 네이티브 빌드 필요 | Windows 설치 미실행 |
| koffi | 3.3.3 / MIT | Windows x64 사전 빌드 배포. 로드 실패 시 원인과 빌드 필요 여부 기록 | Windows 로드 미실행 |
| 공통 | Node 22 x64를 실험 기준으로 사용 | VS 2022 Build Tools의 Desktop development with C++, Windows SDK, Python. MSB8040 발생 시 해당 MSVC 도구 버전의 Spectre 라이브러리 | 호환성 미검증 |

버전과 MIT 표기는 2026-10-21 npm 메타데이터로 확인했다. `package-lock.json`에 전이 의존성과 무결성 값을 고정했다. 직접 의존성은 이 실험 폴더에만 설치한다. 공급자의 LICENSE와 전이 의존성 고지는 설치물에서 보존한다.

- [node-window-manager 패키지와 설치 스크립트](https://github.com/sentialx/node-window-manager/blob/master/package.json)
- [Koffi 플랫폼 지원과 사전 빌드](https://koffi.dev/)
- [node-gyp Windows 준비](https://github.com/nodejs/node-gyp#on-windows)
- [SetWindowPos 계약](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowpos)
- [스레드 DPI 모드](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setthreaddpiawarenesscontext)

아래 명령은 **회사 정책과 설치 승인이 허용하는 Windows PC에서** 실행한다. 권한 오류가 나면 관리자 권한으로 우회하지 말고 기록한다. 누비와 브라우저는 동일한 일반 사용자 세션에서 실행한다.

```powershell
cd <저장소>\tools\browser-window-follow-spike
node --version
npm --version
python --version
$env:npm_config_msvs_version = "2022"
npm ci --no-audit --no-fund
npm test
```

설치에는 네이티브 빌드가 포함된다. 실패하면 npm 로그의 해당 오류 코드, Node/Python/MSVC/SDK 버전과 소요를 기록한다. Electron rebuild나 제품 빌드는 하지 않는다. Python 3.12 이상은 node-gyp 10 이상이 필요하므로 실제 npm이 쓰는 node-gyp 버전도 함께 기록한다.

## 실행 순서

1. [회사 PC 확인표](../../docs/BROWSER-TEACH-PC-CHECK-2026-10-21.md)를 먼저 채운다.
2. 누비를 열고 **기존 도킹은 해제**한다. 다른 자동화는 중지한다. 외부 브라우저에 회사 자료 없는 테스트 전용 일반 창을 만들고 `https://example.com` 탭에서 기존 누비 확장 연결을 완료한다. 브라우저는 최대화/최소화가 아닌 일반 창으로 둔다.
3. 작업 관리자의 실행 파일 위치로 누비와 브라우저의 정확한 경로를 확인한다. 아래 목록은 제목이나 URL 없이 HWND, PID, 위치만 출력한다. 여러 누비 창이 있으면 불필요한 테스트 창을 닫고 다시 확인한다. 아무 창이나 첫 번째 항목으로 고르지 않는다.

```powershell
node run.mjs list "C:\실제 경로\Nubi Workspace.exe"
Copy-Item config.example.json local-config.json
```

4. `local-config.json`에 실제 누비 `id`, `processId`, 실행 파일 경로와 브라우저 경로를 넣는다. `paneInsetsDIP`는 **누비 client 영역에서 빈 브라우저 칸까지의 위/오른쪽/아래/왼쪽 여백**이다. 예제 숫자는 제품 토큰이나 정답이 아니다. 현재 화면에서 측정한 값으로 바꾼다. 브라우저 주소창과 탭을 포함한 전체 창이 이 사각형 안에 들어간다.
5. 읽기 전용 좌표 확인으로 client 화면 원점, DPI, 목표 칸을 확인한다. 150% 화면에서 DIP 100은 물리 픽셀 150이다. 왼쪽 모니터의 음수 원점도 유지한다. 목표 칸이 잘못되면 실행하지 않고 설정을 수정한다.

```powershell
node run.mjs geometry local-config.json
node run.mjs follow local-config.json koffi
```

6. 스크립트가 기다리는 90초 안에 **누비 브라우저 연결 팝업을 우클릭 → 검사**한다. Console의 문서가 `connect.html`인지 확인하고 터미널에 출력된 코드를 실행한다. 일반 웹페이지나 service worker 콘솔이 아니다. 증명 페이지가 잠깐 나타난 뒤 닫힌다. 터미널의 연결 코드는 저장하거나 공유하지 않는다.
7. “시작”이 나오면 누비 창을 **50번 이동**, 이어서 **50번 크기 변경**한다. 한 동작마다 0.5초 이상 멈추고 터미널의 번호가 올라간 것을 확인한다. 이동할 때는 크기를 바꾸지 않는다. 100회가 되면 브라우저의 원래 위치와 전후 순서를 복원하고 종료한다.
8. 같은 배율과 같은 테스트 창 조건으로 `node run.mjs follow local-config.json nwm`을 실행하고 동일하게 100회를 반복한다. 매 실행 새 증명 페이지가 필요하다. 비교 순서 효과를 줄이려면 다음 배율에서는 nwm부터 시작한다.

중단은 **Ctrl+C**다. 예외와 Ctrl+C에서도 현재 HWND/PID/실행 파일이 같을 때만 복원한다. 프로세스 강제 종료나 PC 전원 종료 뒤 복원은 보장하지 않는다. `recovery.local.json`은 수동 위치 복원의 참고 자료이며 오래된 HWND를 재실행하는 복원 명령은 제공하지 않는다.

## 측정 계약

- 32ms 목표 주기로 실제 host client 좌표를 다시 읽는다. 그린 것처럼 보이는 캡처로 정렬을 추정하지 않는다.
- 첫 배치와 같은 좌표의 반복 poll은 횟수에 넣지 않는다. 180ms 이상 안정된 새 이동/크기 변경을 한 건으로 센다. 정확히 100건, 이동 50건과 크기 변경 50건이 필요하다. 부족하거나 20분이 지나면 미완료다.
- 오차는 예상/실제 `x,y,width,height` 차이의 최댓값이며 **0px** 기준이다. 안정 시점 오차와 실행 중 모든 관찰 오차를 각각 기록한다. 움직이는 중의 샘플이나 호출 사이 host 이동을 삭제하지 않는다.
- `GetWindowRect`에는 보이지 않는 크기 조절 테두리가 포함된다. 숫자가 같아도 **눈에 보이는 테두리, 주소창, 탭, 모서리 잘림**은 별도 확인해야 한다. 32ms 관찰이 모든 디스플레이 프레임을 관찰하는 것은 아니다.
- 화면 좌표는 PER_MONITOR_AWARE_V2에서 물리 픽셀로 읽는다. nwm 경로만 그 라이브러리의 현재 모니터 배율로 역변환하고 koffi로 독립 재읽기한다. 혼합 배율 결과를 단일 배율 성공으로 대신하지 않는다.
- 누비가 비활성/최소화되면 브라우저를 누비 뒤로 보낸다. 브라우저를 최소화하거나 화면 밖으로 밀지 않는다. 창 소유자, 부모, 스타일은 바꾸지 않으며 `SetParent`, 항상 위, 강제 포커스 획득은 사용하지 않는다.
- 보고서의 `pass`는 이 실행의 **좌표와 복원 검사만 통과**했다는 뜻이다. 모든 조건의 제품 수용이나 자동화 성공은 아니다.

## 실행 결과와 기록 양식

`results/<시간>-<경로>/`에 `samples.jsonl`(전체 poll), `report.json`(100행과 합계), `recovery.local.json`(로컬 복원 참고)을 쓴다. 제목, URL, 페이지 본문, 쿠키, 로그인 정보, 페어링 코드와 nonce는 파일에 쓰지 않는다. 복원 파일의 실행 경로에는 PC 사용자 이름이 포함될 수 있으므로 외부에 전달하지 않는다.

| 실행 | 배율/모니터 | 이동/크기 변경 | 안정 시점 어긋남 | 관찰 어긋남/표본 | 최대 px | 호출 p95 ms | 복원 | 시각/입력 | 결과 경로 |
|---|---|---|---|---|---|---|---|---|---|
| koffi | 미측정 | /100 | | / | | | | | |
| nwm | 미측정 | /100 | | / | | | | | |

상세 수기 양식은 `measurement-template.csv`다. 각 경로 100행이 비어 있다. 자동 JSON과 대조해 적고, 실행하지 않은 행을 0으로 채우지 않는다.

| 추가 확인 | 기록 |
|---|---|
| 브라우저 이름/버전, Windows 빌드, Node/npm/Python/MSVC/SDK | 미측정 |
| 설치 소요 / native 빌드 성공 여부 / 오류 코드 | 미측정 |
| 100%, 125%, 150%, 200% 각각 2경로 100회 | 미측정 |
| 혼합 배율 모니터 왕복 / 음수 좌표 | 미측정 |
| 누비 최소화/복원, 창 간 전환 뒤 앞뒤 순서 | 미측정 |
| 주소창/탭 유지, 기존 로그인 상태 유지(계정값 제외) | 미측정 |
| 한국어 IME, Tab 이동, 팝업, 다운로드 대화상자 | 미측정 |
| 시각 어긋남/깜박임/초점 가로채기 | 미측정 |
| Ctrl+C / 창 닫힘 / 확장 연결 해제 후 수동 중지 | 미측정 |
| 캡처 경로(회사 본문 없는 화면만) | 미측정 |

로컬 순수 Node 시험은 좌표, 창 선택, 증명 페이지 범위, 집계 로직만 확인한다. Windows DLL 로드, 네이티브 빌드, 실제 이동과 화면 품질은 Windows 결과가 오기 전까지 **미검증**이다.
