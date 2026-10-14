# 설치판 보호 (디컴파일 방지) 검토 — 2026-10-14

사용자 질문: 배포할 때 디컴파일을 어렵게 하는 보안 조치가 있는지, 동작에는 문제가 없어야 한다.

## 지금 상태

- `electron-app/electron-builder.yml`: `asar: true`, 일부 `asarUnpack`. Electron 퓨즈 설정 없음, 코드 서명 없음(Beta).
- 렌더러 번들은 `minify:true`, 메인 프로세스 번들(`lib/main.cjs`)과 실행기(`lib/backend`)는 **최소화 없이** 원문에 가깝다.
- 비밀값은 번들에 없다(토큰은 세션 메모리, 계정은 사용자 입력).

## 할 수 있는 것 (위험 낮은 순)

| 단계 | 조치 | 효과 | 동작 위험 |
| --- | --- | --- | --- |
| 1 | 메인·실행기 번들도 `minify:true`, 소스맵은 배포에서 제외 | 읽기 어렵게(식별자 제거). 복원은 가능 | 거의 없음. 오류 스택이 짧아지므로 진단 보고에 빌드 ID를 같이 남긴다 |
| 2 | Electron 퓨즈(`@electron/fuses`, 설치돼 있음): `RunAsNode` 끔, `EnableNodeOptionsEnvironmentVariable` 끔, `EnableNodeCliInspectArguments` 끔, `EnableEmbeddedAsarIntegrityValidation` 켬, `OnlyLoadAppFromAsar` 켬 | 실행 파일을 Node로 쓰거나 `--inspect`로 붙어 메모리를 보는 길을 막고, asar 변조를 막는다 | 낮음. `afterPack` 훅에서 적용. 변조 검증은 서명 없이도 동작 |
| 3 | 코드 서명(사내 인증서) | 변조·사칭 방지, SmartScreen 경고 제거 | 없음. 인증서가 있어야 함 |
| 4 | V8 바이트코드(`bytenode`)로 메인·실행기 배포 | 소스 자체가 설치판에 없음. 복원은 어렵다(불가능은 아님) | 중간. Electron의 정확한 V8 버전으로 컴파일해야 하고, `Function.prototype.toString`에 기대는 라이브러리가 깨질 수 있다. 실행기는 ESM 묶음이라 CJS로 바꿔야 한다. 전체 검사로 확인 필요 |
| 5 | 난독화(`javascript-obfuscator`) | 읽기 매우 어려움 | 높음. 속도 저하, 일부 코드 오동작. **권하지 않음** |

## 추천

1차: 1, 2, 3(인증서가 있으면)을 릴리스 브랜치에 적용하고 Windows CI 설치 검사로 확인한다. 설치판에서 소스를 꺼내는 일은 여전히 가능하지만, 실행 파일을 디버거로 열거나 asar를 바꿔 끼우는 일은 막힌다.
2차: 4는 개발 PC에서 메인 번들만 먼저 실험하고, 모든 검사와 실모델 실측이 통과하면 적용한다.

어떤 조치도 모델 토큰이나 사내 주소를 숨기는 용도는 아니다. 그런 값은 지금처럼 번들 밖(세션 메모리, 사용자 입력)에 둔다.

## 결정 필요

- 1차(1~3) 바로 적용할지. 인증서 유무.
- 4를 실험할지.

## 적용 (2026-10-14, 사용자 결정)

- **최소화**: `scripts/build-runtime.mjs`의 실행기 번들(service-entry, 작업자, document-extract, OpenWiki 번들)과 `scripts/build-electron.mjs`의 메인 번들에 `minify:true, keepNames:true`. `NUBI_MINIFY=0`으로 빌드하면 읽을 수 있는 번들이 나온다(진단용). 렌더러는 이미 최소화돼 있었다.
- **Electron 퓨즈** (`electron-app/electron-builder.yml` `electronFuses`): `enableNodeOptionsEnvironmentVariable:false`, `enableNodeCliInspectArguments:false`, `enableEmbeddedAsarIntegrityValidation:true`, `onlyLoadAppFromAsar:true`, `enableCookieEncryption:true`. `runAsNode`는 실행기 작업자를 `ELECTRON_RUN_AS_NODE`로 포크하므로 켜 둔다(끄려면 `utilityProcess`로 바꿔야 한다).
- **설치 속도**: `compression: store`. 설치가 압축 해제가 아니라 복사가 되어 가장 빠르다. 설치 파일은 커진다(압축 기본값 대비 약 1.5~2배 예상). 사내 미러 배포라 크기보다 설치 시간을 택했다.
- **서명**: 인증서가 없어 미적용. 인증서가 생기면 `win.certificateFile` 또는 사내 서명 도구를 `afterSign`에 건다.
- **bytenode**: 미적용(2차 실험).
