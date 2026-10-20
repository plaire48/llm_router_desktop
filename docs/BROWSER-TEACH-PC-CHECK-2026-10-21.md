# 회사 PC 브라우저 연결 선행 확인

설계 §12의 1. **사용자가 Windows에서 확인하고 아래 빈칸을 채운다. 아직 실측하지 않았다.**

## 먼저 확인할 두 가지

1. 회사에서 승인한 **누비 브라우저 연결** 확장을 압축 해제 폴더로 로드할 수 있는가?
2. 실제 사용할 업무 주소에서 확장의 `chrome.debugger` 연결을 정책이 허용하는가?

브라우저 이름만으로 허용을 추정하지 않는다. 정책을 바꾸거나 관리자 권한으로 우회하지 않는다. 막혀 있으면 해당 단계와 정책 이름을 기록하고 중단한다. 배포 방식은 설계 질문 28에서 정한다.

## 확인 순서

1. Windows 설정에서 OS 빌드, 디스플레이별 배율과 해상도를 적는다. 브라우저의 도움말/정보에서 이름과 정확한 버전을 적는다. 사용자 이름이나 계정 사진은 기록에 넣지 않는다.
2. Chrome이면 `chrome://policy`, Edge이면 `edge://policy`에서 정책을 새로 읽는다. Samsung Browser는 해당 설치판이 제공하는 정책/관리 화면에서 확인한다. Chrome과 같은 주소나 정책 지원을 가정하지 않는다. 화면이 없거나 항목을 찾지 못하면 **확인 불가**로 적고 관리 담당자에게 해당 항목만 요청한다.
3. `DeveloperToolsAvailability`의 값, 출처, 범위, 상태를 기록한다. `ExtensionDeveloperModeSettings`, `ExtensionSettings`, 설치 차단/허용 정책과 개발자 도구 URL 허용/차단 목록이 있으면 관련 부분만 기록한다. 전체 정책 JSON에는 회사 주소가 들어갈 수 있으므로 보고서에 붙이지 않는다.
4. Chrome은 `chrome://extensions`, Edge는 `edge://extensions`에서 개발자 모드와 **압축 해제된 확장 프로그램을 로드** 버튼이 실제로 동작하는지 확인한다. Samsung은 설치판의 확장 관리 화면을 사용한다. 조직에서 허용한 누비 확장 폴더만 로드한다. 차단 메시지나 서명/스토어 설치 요구가 나타나면 중단한다.
5. 누비 확장 **0.1.0 이상, 이 소스의 `window-proof.html` 포함 여부**를 기록한다. Windows 설치판에 포함된 확장과 소스판이 같은지는 별도로 확인한다. 현재 소스의 최소 Chrome 버전은 125지만 Samsung 호환성을 보장하는 값은 아니다.
6. 회사 자료 없는 테스트 창을 하나 열고 공개 `https://example.com` 탭에서 기존 누비 연결을 완료한다. 연결 코드는 화면에만 사용하고 기록하지 않는다.
7. 기존 누비 에이전트로 그 탭의 제목을 읽는다. **확장 설치 성공 / 연결 성공 / debugger를 이용한 관찰 성공**을 따로 적는다. 일반 웹페이지의 F12 성공만으로 debugger 성공으로 판정하지 않는다. 업무 사이트는 정책 담당자가 허용 여부만 확인하며, 로그인이나 사내 본문을 로그에 남기지 않는다.
8. 창 실험에 필요한 확장 팝업 `connect.html`의 **검사** 콘솔을 열 수 있는지 확인한다. 강제 설치 확장의 콘솔만 차단된 경우 일반 페이지 관찰은 가능해도 이번 수동 스파이크는 실행할 수 없다. 우회하지 않고 제한으로 적는다.

## 정책 해석

Chrome/Edge의 `DeveloperToolsAvailability`는 일반적으로 0이면 강제 설치 확장에 대한 개발자 도구 제한, 1이면 허용, 2이면 금지다. 다만 URL별 허용/차단 정책과 브라우저 버전에 따라 실제 대상의 결과가 달라진다. **2라는 값 하나나 정책 미설정만으로 모든 대상의 성공/실패를 확정하지 않는다.** 확장별 호스트 제한도 별도로 확인한다. [Edge 정책 문서](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies/DeveloperToolsAvailability), [Chrome 정책 목록](https://chromeenterprise.google/policies/developer-tools-availability/), [Chrome debugger 권한과 제한](https://developer.chrome.com/docs/extensions/reference/api/debugger).

확장 페이지의 개발자 모드와 웹 개발자 도구는 별개일 수 있다. Chrome 128 이후에는 별도 `ExtensionDeveloperModeSettings` 정책도 확인한다. [Chrome 확장 개발자 모드 정책](https://chromeenterprise.google/policies/extension-developer-mode-settings/).

## 사용자 기록 양식

| 항목 | 실제 확인값 |
|---|---|
| 확인 날짜 / 익명 PC 구분 | 미측정 |
| Windows 빌드 / x64 여부 | 미측정 |
| 모니터 수 / 각 해상도와 배율 | 미측정 |
| 브라우저 이름 / 버전 | 미측정 |
| 확장 버전 / 배포 경로(소스판 또는 설치판) | 미측정 |
| 압축 해제 확장 허용(허용/차단/확인 불가) | 미측정 |
| DeveloperToolsAvailability 값 / 출처 / 범위 / 상태 | 미측정 |
| ExtensionDeveloperModeSettings 값 | 미측정 |
| 확장별 설치/호스트 제한 해당 여부 | 미측정 |
| 개발자 도구 URL 허용/차단 정책 해당 여부 | 미측정 |
| 공개 테스트 탭 연결 / 관찰 성공 여부 | 미측정 / 미측정 |
| 업무 주소의 정책 허용 여부(주소 자체는 제외) | 미측정 |
| connect.html 팝업 검사 콘솔 허용 여부 | 미측정 |
| 차단 단계 / 오류 코드(민감값 제외) | 미측정 |
| 진행 가능 / 관리자 확인 필요 / 확인 불가 | 미판정 |

정책이 허용되면 [Windows 창 따라붙이기 실험](../tools/browser-window-follow-spike/README.md)으로 진행한다. 이 양식의 성공은 SSO, 업무 자동화나 창 도킹의 성공이 아니다.
