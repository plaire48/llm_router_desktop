import React,{useEffect,useRef,useState} from 'react';
import {ActionButton} from '@e2e/cx-design-system';
import {DeckDisclosure} from '../../../extensions/aipro-chat/src/DeckSurfaces.jsx';
export function OfficeViewPreview({view,call}){
  const [image,setImage]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),version=useRef(0);
  useEffect(()=>{version.current++;setImage(null);setError('');setBusy(false);return()=>{version.current++;};},[view.id]);
  async function show(){const request=version.current;setBusy(true);setError('');try{const result=await call('view_image',{viewId:view.id});if(request!==version.current)return;if(result.id!==view.id||result.sha256!==view.imageSha256||typeof result.data!=='string'||result.data.length>120000||!/^iVBORw0KGgo[A-Za-z0-9+/=]+$/.test(result.data))throw new Error();setImage('data:image/png;base64,'+result.data);}catch{if(request===version.current)setError('화면 보관 시간이 지났거나 캡처를 불러오지 못했습니다.');}finally{if(request===version.current)setBusy(false);}}
  return <DeckDisclosure title="작업 위치와 화면" icon="eye">
    <p className="reply-note">{view.target} / {!view.current?'문서 변경 후 다시 확인 필요':view.imageStatus==='captured'?'캡처 시점의 화면':'화면 이미지 미확인'}</p>
    {view.imageStatus==='captured'&&!image&&<ActionButton action="view" label="화면 보기" iconOnly busy={busy} onClick={show}/>}
    {image&&<img className="office-view-image" src={image} alt={`${view.host} 작업 화면. 전체 문서가 아닌 캡처 당시 보이는 영역입니다.`}/>}
    {error&&<p role="status" className="reply-note">{error}</p>}
    {view.review&&<p className="reply-note">{view.review.imageViewed?'이미지 검토':'UI 요소 검토'} / {view.review.status==='complete'?'해당 화면 기준 확인':view.review.next_step}</p>}
    <p className="reply-note">화면 확인은 실제 값과 저장 결과 검증을 대신하지 않습니다.</p>
  </DeckDisclosure>;
}
