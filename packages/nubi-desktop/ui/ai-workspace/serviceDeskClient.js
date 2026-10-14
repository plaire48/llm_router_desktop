import { GHES_CONFIG, SERVICE_DESK_CONFIG, SERVICE_DESK_ATTACHMENT_CONFIG } from './config.js';
import { serviceDeskIssue, validateServiceDesk } from './serviceDeskModel.js';
import {ghesFetch} from './hostFetch.js';

import { getGithubSession, readGithubUser } from './session.js';
// Nubi: the session comes from the host account, never from browser storage.
export function getServiceDeskSession() {
  const session = getGithubSession(), user = readGithubUser();
  if (!session.token || !user?.login) return null;
  return { token: session.token, host: GHES_CONFIG.host, ...SERVICE_DESK_CONFIG, user };
}

export function serviceDeskLinks(session) {
  const base = new URL(`https://${session.host}`);
  if (base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw new Error('사내 GitHub 주소를 확인하세요.');
  if (![session.owner, session.repo].every(value => /^[a-z0-9][\w.-]*$/i.test(value || ''))) throw new Error('문의 저장소 설정을 확인하세요.');
  const repository = `${base.origin}/${encodeURIComponent(session.owner)}/${encodeURIComponent(session.repo)}`;
  return { repository, api: `${base.origin}/api/v3/repos/${encodeURIComponent(session.owner)}/${encodeURIComponent(session.repo)}/issues`, mine: `${repository}/issues?q=${encodeURIComponent('is:issue author:@me')}`, notifications: `${base.origin}/settings/notifications` };
}

export function serviceDeskAttachmentTarget(session, config = SERVICE_DESK_ATTACHMENT_CONFIG) {
  // Keep the authenticated GHES host; configuration selects only repo and branch.
  serviceDeskLinks(session);
  if (config.owner && !config.repo) throw new Error('첨부 저장소 이름을 설정하세요.');
  const links = serviceDeskLinks({...session, owner:config.owner || session.owner, repo:config.repo || session.repo});
  const branch = config.branch || '';
  if (typeof branch !== 'string' || branch.length > 255 || /[\s~^:?*\[\\\x00-\x1f\x7f]|\.\.|@\{|\/\/|^[\/.\-]|[\/.]$|\.lock(?:\/|$)|\/\./.test(branch) || branch === '@') throw new Error('첨부 브랜치 이름을 확인하세요.');
  return {...links, branch};
}

const errorFor = status => {
  const errors = {
    401: '로그인이 만료되었습니다. 입력한 내용을 복사한 뒤 다시 로그인하세요.',
    403: '문의 접근 권한과 요청 제한을 확인하세요.',
    404: '문의 저장소를 찾을 수 없습니다. 주소와 접근 권한을 확인하세요.',
    410: '문의 저장소에서 Issues를 사용할 수 없습니다. 담당자에게 알려주세요.',
    422: '접수하지 못했습니다. 입력 내용과 문의 설정을 확인하세요.',
    429: '접수 요청이 많습니다. 잠시 후 다시 시도해 주세요.',
  };
  return errors[status] || '접수 결과를 확인하지 못했습니다. 내 문의에서 확인해 주세요.';
};
const uncertainError = () => Object.assign(new Error('접수 결과를 확인하지 못했습니다.\n접수 확인을 누르거나 내 문의에서 확인하세요.'), { uncertain: true });

export async function serviceDeskRequest({ session, payload, requestId, verifyOnly = false, types, fetchImpl = ghesFetch, attachmentConfig = SERVICE_DESK_ATTACHMENT_CONFIG, assignmentClient }) {
  if (!session?.token || !session?.user?.login) throw Object.assign(new Error('문의하려면 사내 GitHub에 로그인하세요.'), { status: 401 });
  const links = serviceDeskLinks(session), checked = validateServiceDesk(payload, types);
  if(checked.value.attachments.length) {
    const target=serviceDeskAttachmentTarget(session,attachmentConfig);
    if(checked.value.attachments.some(image=>!image.url?.startsWith(target.repository+'/raw/'))) throw new Error('설정된 첨부 저장소의 이미지인지 확인하세요.');
  }
  if (!checked.valid) throw Object.assign(new Error('입력한 내용을 확인하세요.'), { fields: checked.errors });
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId || '')) throw new Error('문의 코드를 확인할 수 없습니다. 문의 페이지를 다시 여세요.');
  const headers = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${session.token}` };
  const receipt = issue => {
    if (!Number.isSafeInteger(issue?.number) || issue.number < 1 || !Number.isFinite(Date.parse(issue.created_at))) throw uncertainError();
    const result = { number: issue.number, createdAt: issue.created_at, url: `${links.repository}/issues/${issue.number}` };
    if(checked.value.assignees.length) {
      const assigned=Array.isArray(issue.assignees)?issue.assignees.map(user=>String(user?.login||'').toLowerCase()):[];
      result.assignment={requested:checked.value.assignees,missing:checked.value.assignees.filter(login=>!assigned.includes(login))};
    }
    return result;
  };
  const read = async (url, init = {}) => {
    let response;
    try { response = await fetchImpl(url, { headers, credentials: 'omit', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20000), ...init }); }
    catch { throw uncertainError(); }
    if (!response.ok) throw Object.assign(new Error(errorFor(response.status)), { status: response.status, uncertain: verifyOnly || ![400, 401, 403, 404, 410, 422, 429].includes(response.status) });
    try { return await response.json(); } catch { throw uncertainError(); }
  };
  if (verifyOnly) {
    // GET only after an ambiguous POST. Never resend a possibly successful creation.
    for (let page = 1; page <= 5; page++) {
      const query = new URLSearchParams({ state: 'all', creator: session.user.login, sort: 'created', direction: 'desc', per_page: '100', page: String(page) });
      const issues = await read(`${links.api}?${query}`);
      if (!Array.isArray(issues)) throw uncertainError();
      const found = issues.find(issue => !issue.pull_request && issue.user?.login === session.user.login && issue.body?.includes(`<!-- service-desk:${requestId} -->`));
      if (found) return receipt(found);
      if (issues.length < 100) break;
    }
    throw uncertainError();
  }
  if(checked.value.assignees.length) {
    try {
      // Load lazily: the assignment UI also uses this client's session helpers.
      const client=assignmentClient||(await import('./inquiryAssignment.js')).createInquiryAssignmentClient({session,config:{owner:session.owner,repo:session.repo},fetchImpl});
      await client.prepareCreation(checked.value.assignees);
    } catch(error) {
      // No Issue has been posted yet. Keep the draft editable and safe to retry.
      throw Object.assign(new Error(error.message),{status:error.status,uncertain:false,fields:{assignees:error.message}});
    }
  }
  const issue = await read(links.api, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(serviceDeskIssue(checked.value, requestId, types)) });
  return receipt(issue);
}
