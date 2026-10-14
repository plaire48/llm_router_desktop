import {GHES_CONFIG,isPublicationTarget} from './config.js';
import {githubReadFailure} from './githubReadFailure.js';
function githubBase(host) {
  return `https://${String(host).replace(/^https?:\/\//i, '').replace(/\/+$/, '')}/api/v3`;
}

function githubHeaders(token) {
  // GHES 3.16 defaults to API 2022-11-28. Keep the earlier header set so
  // corporate gateways need not allow an additional custom CORS header.
  return { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}` };
}

function decodeBase64(value) {
  const binary = atob(String(value).replace(/\s/g, ''));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

function encodeBase64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function jsonDocument(value) {
  const document = typeof value === 'string' ? JSON.parse(value) : value;
  if (!document || typeof document !== 'object') throw new Error('마스터 JSON 형식이 올바르지 않습니다.');
  if (!Array.isArray(document.items) && !Array.isArray(document.rows)) throw new Error('마스터 JSON에 items 또는 rows 배열이 없습니다.');
  return document;
}

export async function loadGithubJson({ host, owner, repo, token, path, ref: requestedRef = GHES_CONFIG.branch }) {
  let snapshotHead=null;
  if(isPublicationTarget({owner,repo,branch:requestedRef})){
    const response=await fetch(`${githubBase(host)}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${encodeURIComponent(requestedRef)}`,{cache:'no-store',headers:githubHeaders(token)});
    if(!response.ok)throw await githubReadFailure(response,{path,ref:requestedRef,token});
    snapshotHead=(await response.json())?.object?.sha;
    if(!/^[a-f\d]{40}$/i.test(snapshotHead||''))throw Error('조회할 데이터 버전을 확인하지 못했습니다.');
    requestedRef=snapshotHead;
  }
  const ref = requestedRef ? `?ref=${encodeURIComponent(requestedRef)}` : '';
  const url = `${githubBase(host)}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}${ref}`;
  const response = await fetch(url, { cache: 'no-store', headers: { ...githubHeaders(token), Accept: 'application/vnd.github.object+json' } });
  if (response.status === 404) return null;
  if (!response.ok) throw await githubReadFailure(response, {path, ref: requestedRef, url, token});
  const data = await response.json();
  if (!/^[a-f\d]{40}$/i.test(data?.sha || '')) throw new Error('마스터 파일의 저장 버전을 확인하지 못했습니다. 다시 불러오세요.');
  let content = data.content;
  if (!content && data.encoding === 'none' && /^[a-f\d]{40}$/i.test(data.sha || '')) {
    // Read the immutable blob, not the branch again: content must match the SHA used for saving.
    const blobUrl = `${githubBase(host)}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/blobs/${data.sha}`;
    const blobResponse = await fetch(blobUrl, { cache: 'no-store', headers: githubHeaders(token) });
    if (!blobResponse.ok) throw await githubReadFailure(blobResponse, {path, ref: requestedRef, url: blobUrl, token, body: true});
    const blob = await blobResponse.json();
    if (blob.sha !== data.sha || blob.encoding !== 'base64') throw new Error('마스터 본문과 저장 버전이 일치하지 않습니다. 다시 불러오세요.');
    content = blob.content;
  }
  if (!content) throw new Error('GHES 마스터 파일 응답에 내용이 없습니다.');
  return { snapshotHead, document: jsonDocument(decodeBase64(content)), sha: data.sha || null, htmlUrl: data.html_url || '' };
}
