export const EXTERNAL_AI_POLICY_URL='https://sdsaiuc.sds.samsung.net/post/cmqj8pr3n053pu64okt6yhe7a';
export const EXTERNAL_AI_POLICY_KEY='nubi.workspace.external-ai-policy.dismissed.v1';
export function needsExternalAiPolicy(provider,storage){
 if(!['chatgpt','claude'].includes(provider))return false;
 try{return storage?.getItem(EXTERNAL_AI_POLICY_KEY)!=='true';}catch{return true;}
}
export function dismissExternalAiPolicy(storage){
 try{if(!storage)return false;storage.setItem(EXTERNAL_AI_POLICY_KEY,'true');return true;}catch{return false;}
}
