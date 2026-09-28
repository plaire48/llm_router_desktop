// Classifies whether a request asks for findings rather than a change. The
// answer must be positive on both sides: the request asks to be told something
// and names no operation that changes a page, a file or an account. Anything
// uncertain is NOT an information request, because that class relaxes
// intermediate reviews. This never grants permission for an operation.
const CHANGE_WORD = '작성|수정|편집|입력|등록|저장|전송|발송|게시|발행|업로드|다운로드|삭제|구매|결제|예약|배포|제출|변경|생성|채우|채워|넣어|붙여|보내|올려|고쳐|바꿔|반영' +
  '|옮겨|옮기|드래그|끌어|맞춰|토글|켜\\s*줘|꺼\\s*줘|켜\\s*주|꺼\\s*주|신청|가입|로그인|로그아웃' +
  // An action form of these verbs, not the adnominal form in "선택한 폴더" or "설정된 값".
  '|(?:선택|체크|해제|설정|이동|추가|제거|취소|승인|적용|실행)(?:해|하고|하여|하세요|하라|하기|시켜|시키)';
const CHANGE = new RegExp(`${CHANGE_WORD}|\\b(?:write|edit|save|submit|publish|post|upload|delete|purchase|book|move|drag|set|select|toggle|enable|disable|turn\\s+(?:on|off)|apply|sign\\s+(?:in|up)|log\\s+(?:in|out)|approve|cancel|add|remove)\\b`, 'i');
const ASK = /알려|찾아|조사|확인|설명|요약|비교|정리|읽어|보여|밝혀|뭐|무엇|언제|어디|누가|누구|몇|얼마|인지|\b(?:what|which|who|when|where|how\s+(?:many|much|long)|find|tell|show|summari[sz]e|explain|compare|list|look\s+up|check)\b/i;
// A forbidden operation: the change word followed closely by a negative ending.
const FORBIDDEN = new RegExp(`(?:${CHANGE_WORD})[가-힣]{0,6}(?:\\s*(?:은|는|도|을|를))?\\s*(?:하지|하지는|지는|지)\\s*(?:마|말)[가-힣]{0,6}`, 'g');
const FORBIDDEN_EN = /\b(?:do not|don't|never|without)\s+(?:\w+\s+){0,2}?(?:writ|edit|sav|submit|publish|post|upload|delet|purchas|book|mov|drag|set|select|toggl|enabl|disabl|apply|approv|cancel|add|remov)\w*\b/gi;
// A noun built on a change word names a fact to report, not an operation:
// "수정일" is a date, "작성자" a person, "변경 이력" a record.
const FACT_NOUN = /(?:작성|수정|등록|게시|발행|생성|변경|삭제|저장|업로드|예약|결제|구매|제출|신청|가입)\s?(?:일자|일시|일|날짜|시각|시간|자|본|내역|이력|여부|상태|현황|건수|번호|기간|방법|절차|조건|비용|수수료)(?![가-힣]*(?:해|하고|하여|하세요|하라))/g;
// Answer formatting: attach a source, link or citation to the reply.
const CITATION = /(?:출처|링크|근거|인용|참고\s*자료|주소|URL)[가-힣]{0,2}(?:\s*[가-힣]{0,4}){0,2}\s*(?:붙여|넣어|달아|첨부)/gi;

export function isInformationRequest(goal) {
  if (typeof goal !== 'string' || !goal.trim() || goal.length > 2000) return false;
  const request = goal.replace(FORBIDDEN, ' ').replace(FORBIDDEN_EN, ' ').replace(CITATION, ' ').replace(FACT_NOUN, ' ');
  return ASK.test(request) && !CHANGE.test(request);
}
