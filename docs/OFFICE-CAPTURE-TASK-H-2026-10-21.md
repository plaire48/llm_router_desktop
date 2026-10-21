# Task H: Word 네이티브 캡처

**결과:** §8 답34 범위로 Word 캡처를 Desktop 브리지와 Office 추가 기능에 연결했다. 로컬 구현과 컴파일은 통과했다. **Windows Office 2016 수용 시험은 미실행이며 Task H 최종 완료는 보류다.** Excel/PowerPoint는 1.3.1이다. 업로드와 릴리스는 Claude가 한다.

기존 선택 문서/session 또는 추가 기능 scopeId만 읽는다. path는 동일 원본 확인용이며 불일치는 `form_capture_source_mismatch`다. Word의 읽기 전용 `Range.WordOpenXML` 결과를 공유 C# 모듈에서 캡처 v1로 투영한다. 원본 ZIP을 읽어 우회하지 않는다. 기존 .NET XML reader와 Newtonsoft를 사용하며 새 런타임 의존성을 추가하지 않았다. 그림과 쪽별 PDF는 새 빈 outDir에만 쓰고 JSON은 상대 경로다. 원본 파일 해시와 Word XML을 전후 대조한다. 저장되지 않은 변경, 문서 전환, 렌더 실패는 성공으로 표시하지 않는다. 실패하면 이번 호출의 자산을 정리한다. 300,000자 전송 한도를 넘으면 `form_capture_too_large`로 거절하며 자르지 않는다(공유 결과 검사에서 프레임용 1,024자 여유, Bridge의 실제 직렬화 프레임도 재검사).

| 검사 | 결과와 경계 |
|---|---|
| 실패 시험 | 미지원 전송 경로와 머리글 미표시를 먼저 재현. `verification/office-capture/route-red.log`, `verification/form-cards/headers-red.log` |
| 합성 C# 투영 | 실제 fixture ZIP을 **시험에서만** Flat OPC로 만들어 입력. 동일 `WORD_FEATURES` 38/38, Desktop `validateCapture` 통과. Office 실행 성적 아님 |
| C# 가짜 문서 | 자산/쪽 렌더 수, 원본 보존, 경로 불일치, 미저장, 변경 감지, 자산/문자 상한, 렌더 실패, 기존 파일 보존 등 10개 통과. DTD/자산 경계도 확인. 빌드 포함 2.88초. COM 실행 0 |
| .NET Framework 4.7.2 컴파일 | OfficeBridge와 Nubi.Office.Host 각각 경고 0, 오류 0. Bridge 최종 로그와 추가 기능 로그를 보관. 처음 로컬 복원 누락 실패는 NuGet 캐시 복원 후 해소. 설치판/실제 COM 검증 아님 |
| Node 집중 회귀 | 메일/가르치기/Office/양식 302/302, 실패 0, 28.60초. 신규 Node 2개는 합성 stdio, 약 1ms 합계. 네이티브 실행 시험을 fast unit에 추가하지 않음 |

원본 증거는 `packages/nubi-desktop/verification/office-capture/`의 `synthetic-grade.json`, `csharp-tests.log`, `bridge-build.log`, `addin-build.log`, `focused-302.log`다. 로컬 net8 시험의 CA1416는 Windows COM API를 참조하되 실행하지 않는 경고다. Windows 표본 없이 NASCA, 실제 Word XML의 전체 story 포함, 렌더 품질과 Office 2016 38항목 통과를 선언하지 않는다.

Windows 실행 준비: Office 2016에서 저장된 `tests/fixtures/office-fidelity/synthetic-kitchen-sink.docx`를 직접 연다. `node eval/office-fidelity/run-native-word.mjs --exe <Nubi.OfficeBridge.exe 절대경로> --list`로 창 번호를 확인한다. 같은 도구에 `--source <합성 docx 절대경로> --out <새 결과 폴더> --window <번호> --office-2016-confirmed`를 준다. 설치 제품이 Office 2016인지 사람이 확인한 경우만 마지막 옵션을 쓴다. 도구는 체크인 fixture 해시, 네이티브 엔진, 원본 불변, 상대 자산, 쪽 렌더와 38항목을 확인해 capture.json/result.json을 남긴다. 파일 엔진으로 대체하거나 Word를 새로 열지 않는다. 렌더 PDF는 사람이 전체 페이지를 검토한다.

**변경 파일/SHA:** `.superpowers/sdd/2026-10-21-task-h-word/upload-inputs.json`과 `SHA256SUMS.txt`에 전체 목록. 기능 UI를 새로 만들지 않아 H 자체 캡처는 해당 없음. 머리글/POP3 화면의 1280/440은 `docs/OFFICE-MAIL-UI-FOLLOWUP-2026-10-21.md`에 분리했다. 전체 test:gates/Actions/설치판은 이번에 실행하지 않았다.

기술 근거: [Range.WordOpenXML](https://learn.microsoft.com/en-us/office/vba/api/word.range.wordopenxml), [Document.ExportAsFixedFormat](https://learn.microsoft.com/en-us/office/vba/api/word.document.exportasfixedformat). 이 API 문서는 실제 Office 호환성을 대신 증명하지 않는다.
