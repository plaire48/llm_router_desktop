# C7: 공개 OSS 세 크기의 결정적 기준선

상태: 기존 C1을 포함한 목록/지도/폴더 계획 측정 완료. **전체 위키 품질 수용은 미완료**. 새 의존성이나 제품 변경 없이 고정한 공개 원본을 읽었다. Q3~Q8은 로컬 `refs/desktop/main`의 `adc04f4c`에 포함되어 있다. 이 작업은 이후의 M6/C7 기준선이며 W6/W7은 설계대로 C5/C1에 대응한다.

## 결과

Mac arm64, Node 25.4.0, RAM 16GiB. 모델 호출 0. 각 자료를 별도 프로세스에서 순차 실행했다. 표는 최종 측정기 소스의 한 번 실행이며 최초 측정도 따로 보존했다.

| 공개 원본 | 원본 / 제품 목록 파일 수 | 지도 생성 | 최대 RSS¹ | 순위에 포함 |
|---|---:|---:|---:|---:|
| [Vue core](https://github.com/vuejs/core/tree/ef81ddcfc94399c043b349a986a1b231b6bac7d6) | 703 / 703 | 400.611ms | 227.438MiB | 528 |
| [Node.js lib/test/doc](https://github.com/nodejs/node/tree/3e5c8afba6dcff91d46b8204276d62e3843b23b6) | 13,850 / 13,264 | 2,956.234ms | 360.344MiB | 9,943 |
| [LLVM](https://github.com/llvm/llvm-project/tree/3c038bc08e08996b94bd3d35f2a95ad0b392a78d) | 187,926 / 187,854 | 26,055.132ms | 595.953MiB | 3,173 |

¹ 새 프로세스의 수집/지도/폴더 계획 전체 최대 RSS. 200,000개로 외삽한 값이 아니다. 작은 사례는 약 2천이라는 예시보다 작으며 복제해서 개수를 맞추지 않았다. 제품 필터 후 수를 분리했고 목록 잘림은 세 경우 모두 false다.

세 실행은 exit 0이며 지도 2분/RSS 1GiB 아래였다. 그러나 LLVM의 184,651개는 현재 지원 언어(JS/TS/Python/Java)가 아니며, 여기에는 C 계열 73,490개와 IR/어셈블리/문서 등이 포함된다. 1MiB 초과 163개, 바이너리 1,859개, 인코딩 29개도 별도 집계했다. Node.js 파서 오류 26개는 원본 테스트 fixture의 의도된 구문 오류인지 아직 분류하지 않았으므로 제품 결함이나 통과로 단정하지 않는다.

측정 후 대조에서 공유 `generated/openwiki.mjs`가 변경됐다. 측정 당시 해시는 각 report에 보존하고 현재 값과의 차이를 `source-stability.json`에 기록했다. 지도/폴더 계획/측정기 소스는 동일하다. 이 표를 이후 생성 번들 전체의 재검증으로 표시하지 않는다.

제품 폴더 계획은 LLVM에서 `codeMapSkipped: size`였다(50,000개 상한). 독립 지도 측정의 성공을 제품 계획 연결 성공으로 표시하지 않는다. 폴더 계획 문맥은 각각 40,458/199,259/199,139바이트였다. 큰 파일 건너뜀은 C2 개선 전 기준선이다.

## 결정과 남은 범위

원본은 고정 커밋의 아카이브다. 소스 코드를 설치/실행하지 않았고 회사 자료를 쓰지 않았다. Vue MIT, Node.js MIT 본문과 포함 소프트웨어 고지, LLVM Apache-2.0 with LLVM Exceptions의 실제 LICENSE 파일 해시를 보관했다. GitHub의 NOASSERTION을 실제 라이선스 이름으로 오인하지 않았다. 실제 공개 저장소 식별자는 합성 fixture로 부르지 않고 `sources.mjs`의 실행 설정으로 관리한다.

아카이브라 Git 최근 변경 점수는 미사용이며, Node.js는 명시한 세 하위 트리와 루트 LICENSE만 포함한다. 원본 symlink/hardlink는 추출하지 않고 수를 기록했다. LLVM GitHub 재귀 tree 응답은 truncated=true였으므로 그 수를 전체 수로 쓰지 않고 아카이브의 실제 일반 파일을 셌다.

초기화 시간/비용/페이지 수, W4 위키 커버리지, 린트, 240문항 답변 Recall@5와 인용 정확도, DeepWiki 비교는 **미측정**이다. Claude의 express 실모델 시험은 다른 소스/모델 실행이므로 이 표에 합치지 않았다. 원본 설계의 M1/M5/tree-sitter 답 대기를 유지한다. 이 결과만으로 C1 전체 언어 지원이나 C7 답변 품질 완료를 선언하지 않는다.

## 검증과 인계

실패 시험 후 새 단위 3개 통과. M6과 합쳐 새 시험 8개, 기존 검색/지도 포함 집중 24개 통과. 새 단위 8개 233.184ms, 집중 24개 720.963ms이며 새 단위의 네이티브 앱 실행은 없다. 인계 11파일과 기존 선언 자료 127개의 안전 증분 검사는 위반 0이다.

- 원본: `packages/nubi-desktop/verification/wiki-scale-c7-20261021-final/<저장소>/report.json`, `map-files.json`, `ranking.json`, `folder-plan.json`; 부모 종료 결과와 소스 불변 대조 포함
- 최초 측정/API 원본/아카이브 및 LICENSE 해시: `verification/wiki-scale-c7-20261021`
- 재현: Desktop에서 `python3 eval/wiki-scale/prepare.py <새 원본 폴더>` → 저장소별 `node --max-old-space-size=1536 eval/wiki-scale/run.mjs <이름-source.json> verification/<새 결과 폴더>`
- 변경: `eval/wiki-scale/{sources,metrics,run}.mjs`, `eval/wiki-scale/prepare.py`, `tests/wiki-scale-baseline.test.mjs`, 이 보고서
- SHA 명세: `.superpowers/sdd/2026-10-21-wiki-scale-baseline/c7-upload-inputs.json`
- 캡처: 해당 없음. 제품 화면 변경 없음. 전체 CI/Windows 게이트는 미실행. 업로드와 릴리스는 Claude.
