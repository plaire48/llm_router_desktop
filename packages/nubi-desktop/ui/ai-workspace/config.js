const env = import.meta.env || {};

// 배포 환경별 값은 .env 파일의 VITE_* 변수로 덮어쓸 수 있습니다.
// OAuth client ID는 브라우저에서 사용하는 식별자이므로 secret을 넣지 않습니다.
export const GHES_CONFIG = Object.freeze({
  host: env.VITE_GHES_HOST || 'code.sdsdev.co.kr',
  owner: env.VITE_GHES_OWNER || 'Manufacturing-IT',
  repo: env.VITE_GHES_REPO || 'ai_workspace',
  clientId: env.VITE_GHES_OAUTH_CLIENT_ID || 'f939f199317d39998278',
  scope: env.VITE_GHES_OAUTH_SCOPE || 'repo',
  masterPath: env.VITE_MASTER_PATH || 'data/masters/work-items.json',
  branch: env.VITE_MASTER_BRANCH?.trim() || 'main'
});

export const SESSION_KEYS = Object.freeze([
  'gh_token',
  'gh_host',
  'gh_owner',
  'gh_repo',
  'gh_user'
]);

// Opt in after main branch permissions and the initial manifest are prepared.
export const SINGLE_BRANCH_DATA = (env.VITE_DATA_STORAGE || 'single-main') === 'single-main';
// Branch protection restricts main writers. Editor/settings separation is an app policy.
// A separately configured status repository remains supported for existing sites.
const statusOwner=env.VITE_STATUS_OWNER||GHES_CONFIG.owner,statusRepo=env.VITE_STATUS_REPO||GHES_CONFIG.repo;
const sameRepository=`${statusOwner}/${statusRepo}`.toLowerCase()===`${GHES_CONFIG.owner}/${GHES_CONFIG.repo}`.toLowerCase();
export const STATUS_CONFIG = Object.freeze({
  owner: statusOwner,
  repo: statusRepo,
  branch: env.VITE_STATUS_BRANCH?.trim() || (sameRepository?(SINGLE_BRANCH_DATA?GHES_CONFIG.branch:'status-data'):'main'),
});
export const AUTOMATION_SETTINGS_PATH = 'data/configuration/automation-settings.json';
export const SERVICE_DESK_SETTINGS_PATH = 'data/configuration/service-desk.json';
export function usesSharedRepository() {
  return `${STATUS_CONFIG.owner}/${STATUS_CONFIG.repo}`.toLowerCase() === `${GHES_CONFIG.owner}/${GHES_CONFIG.repo}`.toLowerCase();
}
// Retain the export for existing clients; isolation can be a protected branch.
export function hasIsolatedStatusRepository() {
  return /^[a-z0-9][\w.-]*$/i.test(STATUS_CONFIG.repo) && /^[a-z0-9][\w.-]*$/i.test(STATUS_CONFIG.owner)
    && (!usesSharedRepository() || Boolean(GHES_CONFIG.branch && STATUS_CONFIG.branch && GHES_CONFIG.branch !== STATUS_CONFIG.branch));
}

export function usesSingleBranchData() {
  return SINGLE_BRANCH_DATA && usesSharedRepository() && GHES_CONFIG.branch === 'main' && STATUS_CONFIG.branch === 'main' && GHES_CONFIG.masterPath === 'data/masters/work-items.json';
}
export const usesSeparateAutomationFile = () => hasIsolatedStatusRepository() || usesSingleBranchData();
export function isPublicationTarget({owner,repo,branch}) {
  return usesSingleBranchData() && `${owner}/${repo}`.toLowerCase() === `${GHES_CONFIG.owner}/${GHES_CONFIG.repo}`.toLowerCase() && branch === GHES_CONFIG.branch;
}

// The support repository must be on the same GHES host as the signed-in account.
export const SERVICE_DESK_CONFIG = Object.freeze({
  owner: env.VITE_SERVICE_DESK_OWNER || GHES_CONFIG.owner,
  repo: env.VITE_SERVICE_DESK_REPO || GHES_CONFIG.repo,
});
// Team slugs, not display names. Membership is always read from GHES.
export const SERVICE_DESK_TEAMS = Object.freeze((env.VITE_SERVICE_DESK_TEAMS || 'e2e-editors,e2e-system-admins').split(',').map(value=>value.trim()).filter(Boolean));
export const E2E_EDITOR_TEAM = env.VITE_E2E_EDITOR_TEAM?.trim() || 'e2e-editors';
export const E2E_USER_TEAM = env.VITE_E2E_USER_TEAM?.trim() || 'e2e-users';
export const E2E_SYSTEM_TEAM = env.VITE_E2E_SYSTEM_TEAM?.trim() || 'e2e-system-admins';

// All signed-in writers may upload images to this dedicated branch.
// Keep main and status-data protected independently of this branch.
export const SERVICE_DESK_ATTACHMENT_CONFIG = Object.freeze({
  owner: env.VITE_SERVICE_DESK_ATTACHMENT_OWNER?.trim() || '',
  repo: env.VITE_SERVICE_DESK_ATTACHMENT_REPO?.trim() || '',
  branch: env.VITE_SERVICE_DESK_ATTACHMENT_BRANCH?.trim() || 'voc-images',
});

// New Talk posts use Discussions in the same repository. Older issue posts remain readable.
export const TALK_CONFIG = Object.freeze({
  owner:env.VITE_TALK_OWNER?.trim() || SERVICE_DESK_CONFIG.owner,
  repo:env.VITE_TALK_REPO?.trim() || SERVICE_DESK_CONFIG.repo,
});
export const TALK_ATTACHMENT_CONFIG = Object.freeze({
  ...SERVICE_DESK_ATTACHMENT_CONFIG,
  branch:env.VITE_TALK_ATTACHMENT_BRANCH?.trim() || SERVICE_DESK_ATTACHMENT_CONFIG.branch,
});
