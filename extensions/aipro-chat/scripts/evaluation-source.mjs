// Bind a Playwright-owned page to Chrome's native tab by target identity.
// URLs can change between DOMContentLoaded and the native tab query (YouTube
// normalizes spaces, for example). Never guess a tab from a matching URL.
export function evaluationSourceTab({targetId, pageUrl, targets, tabs, previousTabIds}) {
  const reject = reason => {throw Error(reason);};
  if (typeof targetId !== 'string' || !targetId || !Array.isArray(targets) || !Array.isArray(tabs) || !Array.isArray(previousTabIds)) reject('evaluation_source_identity_missing');
  const matched=targets.filter(target=>target.id===targetId&&target.type==='page');
  if(matched.length!==1||!Number.isInteger(matched[0].tabId))reject('evaluation_source_identity_ambiguous');
  const selected=tabs.filter(tab=>tab.id===matched[0].tabId);
  if(selected.length!==1||previousTabIds.includes(selected[0].id))reject('evaluation_source_not_new');
  const normalize=value=>{const url=new URL(value);return url.origin+url.pathname+'?'+url.searchParams.toString()+url.hash;};
  try {if(normalize(pageUrl)!==normalize(selected[0].url)||normalize(pageUrl)!==normalize(matched[0].url))reject('evaluation_source_url_pending');}
  catch(error){if(error.message==='evaluation_source_url_pending')throw error;reject('evaluation_source_url_invalid');}
  return selected[0].id;
}
