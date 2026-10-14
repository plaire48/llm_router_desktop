import {ghesFetch} from './hostFetch.js';
const identityFields = ['id','login','name','avatar_url','html_url'];

export function githubIdentityLabel(profile) {
  const name=String(profile?.name||'').trim(),login=String(profile?.login||'').trim();
  return name&&login&&name!==login?`${name} (${login})`:name||login||'사용자';
}

export function githubDisplayIdentity(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return null;
  return Object.fromEntries(identityFields.filter(key => profile[key] !== undefined).map(key => [key,profile[key]]));
}

export async function fetchGithubUser({ host, token, signal }) {
  const response = await ghesFetch(`https://${host}/api/v3/user`, {
    cache: 'no-store', signal,
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}` }
  });
  const profile = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(profile.message || `GHES 사용자 확인 실패: HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  if (!profile.login || !Number.isSafeInteger(profile.id)) throw new Error('GHES 사용자 식별 정보를 확인하지 못했습니다.');
  return githubDisplayIdentity(profile);
}
