import {issueTitle} from './issuePresentation.js';
import {inquiryMentionLogins} from './inquiryMentions.js';
import {markdownLabel, safeEditorUrl} from './serviceDeskMarkdown.js';
export const SERVICE_DESK_TYPES = Object.freeze(['오류 신고', '개선 요청', '사용 문의']);
export const SERVICE_DESK_PAGES = Object.freeze(['Skill', 'App', '앱', 'URL', 'E2E Agent 현황', 'AI Talk', '기준 설정', '관리자 설정', '로그인']);
export const SERVICE_DESK_LIMITS = Object.freeze({ title: 100, description: 20000 });

export function validateServiceDesk(input = {}, types = SERVICE_DESK_TYPES) {
  const value = Object.fromEntries(['type', 'title', 'description', 'page'].map(key => [key, typeof input?.[key] === 'string' ? input[key].trim() : '']));
  if (value.page === 'E2E Talk') value.page = 'AI Talk';
  const errors = {};
  value.assignees = [];
  if (input?.assignees !== undefined) {
    if (!Array.isArray(input.assignees) || input.assignees.length > 10 || input.assignees.some(login => typeof login !== 'string' || !/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(login))) errors.assignees = '담당자를 최대 10명까지 선택하세요.';
    else value.assignees = [...new Set(input.assignees.map(login => login.toLowerCase()))];
  }
  value.attachments = [];
  if (input?.attachments !== undefined) {
    if (!Array.isArray(input.attachments) || input.attachments.length > 5) errors.attachments = '첨부 이미지를 확인하세요.';
    else {
      value.attachments = input.attachments.map(item => ({name:typeof item?.name==='string'?item.name:'',url:safeEditorUrl(item?.url)}));
      if (value.attachments.some(item=>!item.name||item.name.length>255||!item.url||item.url.length>2048)) errors.attachments = '첨부 이미지 정보를 확인하세요.';
    }
  }
  if (!types.includes(value.type)) errors.type = '문의 유형을 선택하세요.';
  if (!value.title) errors.title = '제목을 입력하세요.';
  else if (value.title.length > SERVICE_DESK_LIMITS.title) errors.title = '제목은 100자까지 입력할 수 있습니다.';
  if (!value.description) errors.description = '문의 내용을 입력하세요.';
  else if (value.description.length > SERVICE_DESK_LIMITS.description) errors.description = '내용은 20,000자까지 입력할 수 있습니다.';
  if (!SERVICE_DESK_PAGES.includes(value.page)) errors.page = '문의를 연 화면을 확인할 수 없습니다. 문의 페이지를 다시 여세요.';
  return { value, errors, valid: !Object.keys(errors).length };
}

// Preserve GitHub formatting. The preview sanitizes HTML; GHES renders the issue.
// The reserved receipt marker is generated only by the app.
export const issueMarkdown = text => text.replace(/<!--\s*service-desk(?=[:\s-])/gi, '&lt;!-- service-desk');
export function serviceDeskIssue(input, requestId, types = SERVICE_DESK_TYPES) {
  const { value, valid } = validateServiceDesk(input, types);
  if (!valid) throw new Error('Invalid service desk request');
  return {
    title: issueTitle('문의',value.title),
    ...(value.assignees.length ? {assignees: value.assignees} : {}),
    body: `## 문의 정보\n\n- 유형: ${value.type}\n- 화면: ${value.page}\n- 접수 경로: AI Workspace 문의\n- 문의 코드: ${requestId}${value.assignees.length?'\n- 알림 대상: '+inquiryMentionLogins(value.assignees).map(login=>`@${login}`).join(' '):''}\n\n## 문의 내용\n\n${issueMarkdown(value.description)}${value.attachments.length?'\n\n'+value.attachments.map(image=>`![${markdownLabel(image.name)}](${image.url})`).join('\n\n'):''}\n\n<!-- service-desk:${requestId} -->`,
  };
}
