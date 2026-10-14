import usage from '../electron-app/claude-cli-usage.cjs';
// Context windows of Claude models from the Models API, read with the Claude Code sign-in (user request 2026-10-14:
// show Claude context use from the start, "API 같은거 없어?"). The token is used for this one request and not kept.
// Any failure leaves the windows unknown; the value reported after a Claude reply still fills them in.
export const MODELS_URL='https://api.anthropic.com/v1/models?limit=100';
export async function claudeContextWindows({fetchImpl=globalThis.fetch,readToken=usage.readToken}={}){
  const token=await readToken();
  const response=await fetchImpl(MODELS_URL,{headers:{Authorization:`Bearer ${token}`,'anthropic-beta':'oauth-2025-04-20','anthropic-version':'2023-06-01',Accept:'application/json'},signal:AbortSignal.timeout(10000)});
  const windows=new Map();
  if(!response.ok)return windows;
  const body=await response.json().catch(()=>null);
  for(const model of Array.isArray(body?.data)?body.data:[])if(typeof model?.id==='string'&&Number.isSafeInteger(model.max_input_tokens)&&model.max_input_tokens>0)windows.set(model.id,model.max_input_tokens);
  return windows;
}
// A catalog id may carry a context suffix such as "[1m]"; the base id names the model.
export const baseModelId=id=>String(id).replace(/\[[^\]]*\]$/,'');
