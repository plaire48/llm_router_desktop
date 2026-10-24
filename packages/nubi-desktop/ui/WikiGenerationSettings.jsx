import React,{useEffect,useRef,useState} from 'react';
import {CxButton,CxSelect} from '@e2e/cx-design-system';
import {WikiModelChips,WikiReasoningChoice,WikiModelSelection,wikiModelSelected,chooseWikiModel} from './WikiModelChoice.jsx';
import {reasoningLabel} from './reasoning-labels.mjs';
import {DESKTOP_PROVIDER_LABELS} from './provider-labels.mjs';
import {SettingsSection,SettingsField} from './SettingsSection.jsx';
import {DeckDisclosure} from '../../../extensions/aipro-chat/src/DeckSurfaces.jsx';
const errors={wiki_busy:'위키 작업 중에는 설정을 바꿀 수 없어요.',invalid_reasoning_effort:'선택한 모델이 지원하는 추론 강도를 골라 주세요.',model_unavailable:'연결된 모델을 선택해 주세요.'};
export function WikiGenerationSettings({value,api,onChange,disabled=false,onRetry,onModelPickerChange}){
 if(value?.unsupported)return null;
 if(!value?.settings)return <SettingsSection icon="sliders" title="생성 설정"><p className="nubi-muted">{value?.error?'설정을 불러오지 못했어요.':'설정 확인 중'}</p>{value?.error&&<CxButton onClick={onRetry}>다시 확인</CxButton>}</SettingsSection>;
 return <GenerationForm key="loaded" value={value} api={api} onChange={onChange} disabled={disabled} onModelPickerChange={onModelPickerChange}/>;
}
function GenerationForm({value,api,onChange,disabled,onModelPickerChange}){
 const [draft,setDraft]=useState(value.settings),[pickerOpen,setPickerOpen]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState(''),base=useRef(value.settings),live=useRef(true),wasPickerOpen=useRef(false);
 useEffect(()=>{onModelPickerChange?.(pickerOpen);return()=>onModelPickerChange?.(false);},[pickerOpen,onModelPickerChange]);
 useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
 useEffect(()=>{setDraft(current=>JSON.stringify(current)===JSON.stringify(base.current)?value.settings:current);base.current=value.settings;},[value.settings]);
 const selected=wikiModelSelected(value,draft),changed=JSON.stringify(draft)!==JSON.stringify(value.settings),locked=disabled||saving;
 const change=patch=>{setError('');setDraft(old=>({...old,...patch}));};
 useEffect(()=>{if(!pickerOpen&&wasPickerOpen.current)document.getElementById('wiki-generation-model')?.focus({preventScroll:true});wasPickerOpen.current=pickerOpen;},[pickerOpen]);
 const choose=(provider,model)=>{change(chooseWikiModel(value,draft,provider,model));setPickerOpen(false);};
 const applied=value.applied,label=value.models.find(m=>m.provider===applied?.provider&&m.model===applied?.model)?.label||applied?.model;
 if(pickerOpen)return <section className="nubi-settings-section-body"><WikiModelSelection view={value} value={draft} disabled={locked} onBack={()=>setPickerOpen(false)} onChoose={choose}/></section>;
 return <form className="nubi-settings-field" onSubmit={async event=>{event.preventDefault();if(!changed||locked)return;setSaving(true);setError('');try{const next=await api('wikiGeneration',{action:'set',value:draft});if(live.current){setDraft(next.settings);onChange(next);}}catch(cause){if(live.current)setError(errors[cause?.message]||'설정을 저장하지 못했어요. 다시 확인해 주세요.');}finally{if(live.current)setSaving(false);}}}><SettingsSection icon="sliders" title="생성 설정">
 <SettingsField id="wiki-generation-model" label="작성/갱신 모델"><WikiModelChips includeReasoning={false} view={value} value={draft} open={pickerOpen} onOpen={()=>setPickerOpen(true)} onChange={change} disabled={locked}/></SettingsField>
 <SettingsField id="wiki-generation-effort" label="자동 작성/갱신 추론" description="대화와 별도로 저장하며 자동 작성과 갱신에 적용해요."><WikiReasoningChoice view={value} value={draft} onChange={change} disabled={locked}/></SettingsField>
 <SettingsField id="wiki-generation-concurrency" label="동시에 작성"><CxSelect value={draft.concurrency} disabled={locked} onChange={event=>change({concurrency:Number(event.target.value)})}>{[1,2,3,4].map(n=><option key={n} value={n}>문서 {n}개</option>)}</CxSelect></SettingsField>
 <div className="nubi-wiki-response-limits"><DeckDisclosure title="응답 한도" icon="sliders"><SettingsField id="wiki-generation-calls" label="한 응답의 도구 호출"><CxSelect value={draft.maxToolCalls} disabled={locked} onChange={event=>change({maxToolCalls:Number(event.target.value)})}>{[8,16].map(n=><option key={n} value={n}>{n}개</option>)}</CxSelect></SettingsField><SettingsField id="wiki-generation-output" label="페이지 응답 상한" description={selected?.pageOutputConfigurable===false?'이 연결은 응답 길이를 서버가 정합니다':undefined}><CxSelect value={selected?.pageOutputConfigurable===false?'server':draft.pageMaxTokens} disabled={locked||selected?.pageOutputConfigurable===false} onChange={event=>change({pageMaxTokens:Number(event.target.value)})}>{selected?.pageOutputConfigurable===false&&<option value="server">서버 기본</option>}{[4096,8192,16384,32768].map(n=><option key={n} value={n}>{n.toLocaleString()} 토큰</option>)}</CxSelect></SettingsField></DeckDisclosure></div>
 <p role="status" className="nubi-muted">{applied?`적용: (${DESKTOP_PROVIDER_LABELS[applied.provider]||applied.provider}) ${label}, ${reasoningLabel(applied.provider,applied.effort)}, 문서 ${applied.concurrency}개${applied.pageMaxTokens?`, 페이지 최대 ${applied.pageMaxTokens.toLocaleString()} 토큰`:', 페이지 응답 서버 기본'}`:'연결된 모델을 선택해 주세요.'}</p>{error&&<p role="alert">{error}</p>}<div className="nubi-settings-actions"><CxButton type="submit" disabled={!changed||locked||draft.model!=='auto'&&!selected}>{saving?'저장 중':'저장'}</CxButton></div>
 </SettingsSection></form>;
}
