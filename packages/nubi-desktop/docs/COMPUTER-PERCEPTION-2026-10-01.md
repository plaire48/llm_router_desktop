# Computer Use 관찰과 검증

주 제품은 VS Code 포크의 `nubi/` 입력이다. 주 에이전트는 기존 AI Pro/ChatGPT/FabriX 로그인과 사용자 모델 선택을 유지한다. 별도 로컬 LLM이나 GPU 서버를 기본 요구사항으로 추가하지 않는다.

## 실행 흐름

1. 기존 Chrome DOM/API, Office native 도구, Windows UIA 중 목적에 맞는 도구를 먼저 사용한다.
2. 사용자가 연결한 창을 `observe_computer`로 관찰한다. 기본 모델이 이미지 입력을 받지 않지만 같은 로그인에 이미지 모델이 있으면 캡처는 호스트에 보관하고 UIA 정보만 기본 모델에 보낸다.
3. UIA 검색만으로 대상이 불분명하면 `ground_computer_target`이 캡처 한 장과 짧은 대상 설명만 별도 분석한다. 브라우저의 `visionModelFor`를 재사용하며 현재 인증 카탈로그의 AI Pro Qwen 경로를 선택한다. 명시적인 `supportsImages:false`는 우선한다. 카탈로그에 없는 기억 속 모델이나 다른 제공자 계정은 사용하지 않는다.
4. 분석 호출은 같은 인증으로 `visionModel`을 사용한다. 사용자 기본 모델과 문맥 크기, 선택 목록은 바뀌지 않는다. 분석 응답은 원래 실행으로 돌아오며 실제 사용 모델과 SSE usage는 기존 `analysis` 메트릭에 기록한다. 큰 주 대화를 작은 이미지 모델의 문맥에 넘기지 않는다.
5. 시각 응답은 관찰된 라벨과 이미지 내 비율 좌표에 한정한 힌트다. 같은 실행의 UIA 대상으로 다시 조회한 뒤 기존 단일/배치 승인으로 조작한다. 원시 좌표 실행이나 모델이 만든 Python 실행 권한을 주지 않는다.
6. 조작 뒤 다시 관찰하고 `verify_computer_outcome`으로 값, 이름, 활성화, 선택, 토글, 펼침 상태를 최대 8개 비교한다. 기본 1.5초, 최대 5초의 제한된 읽기에서 두 번 연속 일치해야 확인된다. 미지원, 불일치, 한 번만 일치한 상태는 구분한다. 취소, 바뀐 창/대상과 오래된 관찰은 성공 기록을 만들지 않는다.
7. 검증 결과와 불일치 항목을 모델에 돌려주어 다음 접근을 정한다. 읽기 대기는 입력 재실행이 아니다. 미확정 쓰기와 취소는 기존 정책대로 자동 재실행하지 않는다.

UIA와 화면은 원자적으로 읽히지 않는다. 이 검증은 명시한 컨트롤의 값과 상태에 한정하며 저장, 서버 접수, 메일 전송이나 전체 요청 완료를 증명하지 않는다. 이미지 전용 custom UI에 UIA 대상이 없으면 그 동작은 아직 지원하지 않는다.

## 검토한 방법과 도입 범위

| 방법 | 실제 반영 | 선택 근거와 경계 |
|---|---|---|
| Agent S3 | 판단과 대상 찾기 분리, 별도 화면 분석, 실제 결과를 사용한 다음 행동 검토 | Apache-2.0. [고정 Worker 소스](https://github.com/simular-ai/Agent-S/blob/3aa272d23d2994c7bbde1acbbe0ef8e8d06b8693/gui_agents/s3/agents/worker.py)와 [grounding 소스](https://github.com/simular-ai/Agent-S/blob/3aa272d23d2994c7bbde1acbbe0ef8e8d06b8693/gui_agents/s3/agents/grounding.py)를 검토했다. SDK 전체, 생성 Python/pyautogui 실행이나 실제 환경을 반복 변경하는 bBoN rollout은 도입하지 않았다. 해당 벤치마크 점수를 누비 성능으로 사용하지 않는다. |
| UI-TARS | 시각 대상 grounding 방식과 명확한 좌표 계약을 참고 | Apache-2.0. [원본 좌표 계약](https://github.com/bytedance/UI-TARS/blob/582f3a7ea5d285ee8ed9e2e84048d1ab01453c49/README_coordinates.md)을 검토했다. 전용 7B 모델/가중치/서버는 설치하지 않았다. 현재 로그인 이미지 모델을 사용하며 좌표는 실행 권한이 아니다. |
| OmniParser | 공식 로컬 `/parse/` 응답의 라벨/ratio bbox를 읽는 선택적 어댑터 | [공식 서버](https://github.com/microsoft/OmniParser/blob/354021201345a96178360b28733573e27269f2de/omnitool/omniparserserver/omniparserserver.py)의 `base64_image`와 `parsed_content_list` 계약을 사용한다. 파서 프로세스, OCR/caption 의존성과 가중치는 아직 설치하지 않았다. repo CC-BY-4.0, detector/caption/code/weights별 라이선스를 별도 확인해야 한다. v2 Ultralytics/AGPL 경로와 v3 구현을 같은 라이선스로 표시하지 않는다. |
| Playwright | 입력을 반복하지 않는 eventual assertion 패턴을 UIA 검증에 적용 | [actionability](https://playwright.dev/docs/actionability), [auto-retrying assertions](https://playwright.dev/docs/test-assertions)를 검토했다. 기존 Playwright/Chrome 경로를 유지한다. UIA에 Playwright locator가 생겼다고 표시하지 않는다. |
| Python computer-use / browser-use | 적용성 검토 | [browser-use](https://github.com/browser-use/browser-use)의 MIT 소스를 검토했다. 별도 Python 브라우저/LLM/로그인 세션을 추가하면 기존 Chrome 연결과 인증을 분리하게 되므로 기본 실행기로 추가하지 않았다. 현재 Windows native UIA와 Chrome 실행기를 사용한다. Python/GPU 설치 비용이나 새 런타임 의존성은 추가하지 않는다. |

## 선택적 로컬 파서

서버가 없는 현재 상태에서도 UIA와 로그인 이미지 모델 분석은 동작한다. OmniParser가 준비되면 신뢰한 네이티브 호스트 환경의 `NUBI_OMNIPARSER_URL=http://127.0.0.1:8000`으로 연결하고 도구의 `provider:omniparser`를 선택한다. 프로젝트 문서나 모델이 주소를 정하지 못한다. literal loopback만 허용하며 리다이렉트, 8MB 초과 응답, 잘못된 bbox를 거부한다. 캡처 외 GHES/SSO/제공자 인증값과 임의 명령은 보내지 않는다. 주 모델의 인증은 기존 호스트가 관리한다. 로컬 파서 연결 준비를 파서 설치 완료로 표시하지 않는다.

GHES GitHub App 사용자 로그인/SecretStorage 경로는 유지한다. 회사 사용자 토큰은 저장소 접근을 위한 것이며 로컬 화면 분석기나 모델 입력에 전달하지 않는다.

## 검증 범위

새 검사와 기존 가상 Windows 드라이버, 실제 Pi 실행기, 합성 AI Pro HTTP/SSE 계약으로 확인한다. 실제 AI Pro Qwen 이미지 해석 정확도, Windows 앱 업무 수행, 설치된 OmniParser와 GHES 실계정은 미검증이다. 상세 실행 수와 실패는 주 포크 `docs/COMPUTER-USE-2026-10-01.md`에 기록한다. 최종 Windows EXE 빌드와 커밋/푸시는 하지 않았다.
