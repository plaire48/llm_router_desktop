# 커스텀 로직 작성 계약

커스텀 로직은 일반 JSON 설정으로 표현하기 어려운 반복 처리·계산·형식 변환에만 쓴다.

1. 질문지가 지정한 `workflows/<활동>/logic/<task>__<node>/` 폴더를 만든다.
2. `LOGIC.md`에 사용자 설명 원문, 노드 목적, 입력/출력, 아래 실행 계약을 기록한다.
3. `run.py`가 그 계약을 구현하게 한다. 설명에 없는 경로·주소·업무 규칙은 되묻는다.
4. `python ops_runtime/logic_draft.py mark <폴더>`로 AI 초안임을 표시한다.
5. node의 `custom_logic`에 폴더를 연결하고 대체된 method/prompt/path 마커는 제거한다.
   분기형 decision의 labels는 유지한다.

## 실행 계약

- 엔진이 `run.py`를 `shell=False`로 실행한다.
- stdin은 `{task, node, key, inputs, outputs}` JSON이다. 분기형 decision이면 `labels`도 있다.
- stdout은 JSON 객체 하나만 출력한다.

```json
{"output":{"output_1":null},"label":"선언된 라벨 중 하나"}
```

- 산출형 decision에는 label을 내지 않는다.
- 선언된 출력 id를 모두 포함하며 없는 값은 null이다.
- 로그는 stderr로 보낸다. 실패는 0이 아닌 exit code와 stderr로 알린다.
- 상대경로 기준은 저장소 루트다. 자기 폴더 파일은 `__file__` 기준으로 연다.

사용자에게 run.py가 AI 초안임을 알린다. 수정 없이 승인하면
`python ops_runtime/logic_draft.py approve <폴더>`를 실행한다. Validator의 검토 경고가
사라지는지 확인한다.
