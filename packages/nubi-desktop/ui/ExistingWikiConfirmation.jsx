import React,{useState} from 'react';
import {CxConfirmation} from '@e2e/cx-design-system';
import {notifyWorkspaceToast} from './WorkspaceToast.jsx';
import {useWikiModelChoice,WikiRebuildModel} from './WikiModelChoice.jsx';
// A folder that already has OpenWiki pages: keep them, or delete and rebuild with the model and reasoning chosen here.
export function ExistingWikiConfirmation({pages,api,onClose,onRebuilt}){
 const [busy,setBusy]=useState(false),model=useWikiModelChoice(api);
 async function rebuild(){
  setBusy(true);
  try{await model.save();await api('wikiInitialization',{action:'reset',confirmed:true});onRebuilt();notifyWorkspaceToast('기존 OpenWiki를 지우고 다시 만들기 시작했어요.',{success:true});}
  catch(error){notifyWorkspaceToast(error?.message==='wiki_busy'?'위키 작업이 진행 중이라 지금은 지울 수 없어요.':/invalid_reasoning_effort|model_unavailable/.test(error?.message)?'선택한 모델과 추론 정도를 확인해 주세요.':'OpenWiki를 지우지 못했어요.');}
  finally{onClose();}
 }
 return <CxConfirmation className="nubi-wiki-existing" icon="bookmark" title="OpenWiki가 이미 있어요" message={`이 폴더에 OpenWiki 문서 ${pages}개가 있어요. 그대로 가져올까요? 지우면 처음부터 다시 만들어요.`} cancelLabel="그대로 가져오기" confirmLabel="지우고 다시 만들기" busy={busy} onCancel={onClose} onConfirm={()=>void rebuild()}><WikiRebuildModel control={model} disabled={busy}/></CxConfirmation>;
}
