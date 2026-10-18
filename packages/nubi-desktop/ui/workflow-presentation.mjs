// Fixed UI vocabulary: diagnostic payloads remain in folded technical details.
export const workflowKindIcons=Object.freeze({tool:'code',agent:'agent',human:'user',branch:'workflow',loop:'refresh',parallel:'layers',subflow:'workflow',event:'play',memo:'file'});
const messages=Object.freeze({workflow_schema:'단계와 입력의 형식을 확인해 주세요.',workflow_inputs_invalid:'필수 입력과 값의 형식을 확인해 주세요.',workflow_tool_unknown:'사용할 수 없는 도구가 포함되어 있어요.',workflow_done_when_unobservable:'완료를 확인할 수 있는 조건을 추가해 주세요.',workflow_source_changed:'원본이 바뀌었어요. 다시 확인한 뒤 저장해 주세요.',workflow_layout_failed:'지도 배치를 준비하지 못했어요. 다시 확인해 주세요.',workflow_layout_unavailable:'지도를 사용할 수 없어요. 다시 열어 주세요.',workflow_import_invalid:'가져올 파일의 형식을 확인해 주세요.',path_scope:'프로젝트 안의 파일을 선택해 주세요.'});
export function workflowIssueMessage(code){return Object.hasOwn(messages,code)?messages[code]:'워크플로우 내용을 확인해 주세요.';}

