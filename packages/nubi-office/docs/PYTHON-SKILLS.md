# Office 하네스의 로컬 Python 스킬

Excel, Word, PowerPoint 실행기는 같은 스킬 작업공간을 사용한다. 모델은 계획을 표시한 뒤 스킬 문서를 읽고 `prepare_python`, `run_script`, 기존 Office 도구를 한 단계씩 호출한다. 반환 데이터는 문서 완료나 쓰기 승인으로 인정하지 않는다.

## 사용 흐름

1. 문서 작성에 Python 패키지가 필요하면 설치 목록을 표시한다. 사용자가 환경 준비를 허용하면 누비에 포함된 uv가 Python 3.12와 패키지를 PC에 설치한다. 별도의 Python 설치 프로그램이나 터미널 명령을 요구하지 않는다.
2. 모델은 메모리 작업공간의 `.py`에 `def transform(input)`을 작성한다. 실행 확인에서 코드와 입력 해시를 확인하고 허용한다. 승인 뒤 코드나 입력이 바뀌면 실행하지 않는다.
3. 실제 JSON 결과와 코드/입력/출력 해시를 다음 모델 호출에 전달한다. 실패 시 오류 종류와 줄 위치를 보고 수정한다. 재실행은 새 승인을 요구하며 자동 프로세스 재시도는 없다. 진전 없는 반복은 공통 하네스의 확인 대기로 전환한다.
4. 계산값과 문안은 기존 Office 도구로 반영한다. 원본 fingerprint, 실제 readback, 요구사항 검토, 저장 승인은 그대로 적용한다.

기본 예제는 Jinja2 `3.1.6`을 사용하는 보고서 데이터 스킬이다. 세 앱에 각각 스킬 문서, 요구 패키지 목록, Python 예제를 포함한다. 외부 스킬 저장소 자동 등록이나 임의 shell 실행, Python이 만든 Office 파일을 자동 가져오는 기능은 제공하지 않는다.

## 실제 도입과 선택 근거

| 대상 | 적용 | 이유 |
|---|---|---|
| Pi Coding Agent 0.86.1 | 기존 스킬 검색, 읽기, 편집, 단계 실행 재사용 | 별도 스킬 에이전트를 만들지 않고 현재 문맥과 복구 계약 유지 |
| Astral uv 0.12.18 (MIT OR Apache-2.0) | SHA-256 고정 Windows x64/x86 바이너리 번들 | Python 부재 시 관리형 설치, 가상환경, 해시 기반 패키지 동기화 |
| proper-lockfile 4.1.2 (MIT) | 환경별 설치 잠금과 heartbeat | 여러 Office 앱이 동시에 같은 환경을 만들 때 충돌 방지 |
| Python 3.12, Jinja2 3.1.6 | 승인 시 다운로드 | 코드 실행과 텍스트 템플릿의 실제 재사용 |
| 시스템 pip, 임의 shell, 기본 글로벌 인증 검색 | 미도입 | 기존 환경 변경과 승인 범위의 불명확성 방지 |

공식 근거: [uv Python 관리](https://docs.astral.sh/uv/guides/install-python/), [uv 환경 격리](https://docs.astral.sh/uv/pip/environments/), [uv CLI](https://docs.astral.sh/uv/reference/cli/), [proper-lockfile](https://github.com/moxystudio/node-proper-lockfile), [Anthropic Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills). 스킬의 점진적 읽기는 기존 Pi 구현을 유지한다. 특정 방법론 참고는 실모델 성능 향상 측정과 다르다.

## 실행 및 배포 경계

- 설치 위치는 `%LOCALAPPDATA%/NubiOffice/Python`. 시스템 Python과 PATH를 변경하지 않는다. 필요 시 인터넷에서 Python 및 wheel을 내려받으므로 회사 다운로드 정책이 적용된다. TLS 검증은 끄지 않는다.
- 의존성은 최대 12개 `패키지==버전`. uv가 전이 의존성을 해시가 있는 lock으로 해석하고 `--require-hashes`로 설치한다. URL/Git/editable/source build/custom index는 지원하지 않는다. 서로 다른 요구 목록은 다른 환경으로 유지한다.
- 가상환경은 **OS 보안 샌드박스가 아니다**. Python은 사용자 권한의 파일/네트워크 접근이 가능하고 UI에서 이를 알린다. 프로세스에 모델 인증 환경변수를 넘기지 않는다. 코드와 입력은 stdin으로 전달하며 런타임이 문서 평문 sidecar를 만들지 않는다. Python에서 Office/NASCA 파일을 직접 열거나 COM으로 승인 경계를 우회하지 않도록 스킬과 도구 계약에서 금지한다. 이 금지는 OS 파일 접근 차단을 의미하지 않는다.
- Windows는 Job Object로 512 MB와 하위 프로세스 제한, 호출기는 30초/출력 크기 제한 및 취소를 적용한다. 제한을 설정하지 못하면 사용자 코드를 실행하지 않는다. 종료가 불확실하면 별도 오류로 남긴다. 실패한 Python 코드의 부수 효과까지 되돌렸다고 표시하지 않는다.
- 의존성 환경은 재사용하지만 실행 결과와 문서 작업은 기존 실행 메모리에 남는다. 작업 재시작 복원이나 NASCA 암호화 검증을 새로 제공하지 않는다. 제거 시 사용자 Python 환경은 유지한다.

## 검증

`tests/python-runtime.test.mjs`: 승인 거절/취소, 설치 중복 실행 방지, 코드/입력/lock 변경, 비밀 환경변수 제외, 실제 subprocess 시간/출력 제한.

`tests/python-integration.mjs`: 실제 uv/Python/Jinja2 설치, 세 앱 스킬 데이터 생성, 오류 수정, 승인 중 입력 변경, 시간 초과, 취소, 비유한 결과 거절. Windows에서는 Job Object 하위 프로세스/메모리 제한까지 검사한다. 테스트 승인은 합성 응답이며 사용자 실승인 증거가 아니다.

Windows 브라우저 릴리스 검사는 생산 worker 번들의 Python 결과를 모델 fixture가 소비한 뒤 실제 UI 승인, C# 메모리 셀 반영, 서식 오류 수정, readback, 복원을 확인한다. 실제 Office 2016 COM, Qwen, 사내 인증, NASCA의 종단 간 성공은 별도 미검증이다.
