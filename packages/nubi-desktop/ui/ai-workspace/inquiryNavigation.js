const pages = {overview:'Skill', workspace:'App', agent:'Agent', settings:'기준 설정', admin:'관리자 설정', talk:'AI Talk'};

export function inquiryHash(page) {
  if (page === 'URL' || page === '앱') page = 'App';
  if (page === 'E2E Talk') page = 'AI Talk';
  return `#support=${Object.keys(pages).find(key=>pages[key]===page)||'overview'}`;
}

export function inquiryOrigin(hash = window.location.hash) {
  const key = hash.match(/^#support=(overview|workspace|agent|settings|admin|talk)$/)?.[1] || 'overview';
  return {view:key, page:pages[key]};
}

export function workspaceViewFromHash(hash) {
  if (/^#support(?:=(overview|workspace|agent|settings|admin|talk|new|[1-9]\d*))?$/.test(hash)) return 'support';
  if (/^#workspace(?:\?tab=(?:files|links))?$/.test(hash)) return 'workspace';
  if (/^#agent(?:=[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12})?$/i.test(hash)) return 'agent';
  if (hash.startsWith('#talk')) return 'talk';
  if (hash === '#app') return 'overview';
  return null;
}

export function rememberInquiryReturn(storage = sessionStorage, hash = window.location.hash) {
  if (workspaceViewFromHash(hash)==='support') storage.setItem('e2e-inquiry:return',hash);
}
