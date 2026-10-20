import React,{useEffect,useRef,useState} from 'react';
import {CxButton,CxSelect,Icon} from '@e2e/cx-design-system';
import {ModelPicker,ModelSelection} from '../../../extensions/aipro-chat/src/ChatControls.jsx';
import {reasoningLabel} from './reasoning-labels.mjs';
import {DESKTOP_PROVIDER_LABELS} from './provider-labels.mjs';
import {SettingsSection,SettingsField} from './SettingsSection.jsx';
import {DeckDisclosure} from '../../../extensions/aipro-chat/src/DeckSurfaces.jsx';
const errors={wiki_busy:'작성 중에는 설정을 바꿀 수 없어요.',invalid_reasoning_effort:'선택한 모델이 지원하는 추론 강도를 골라 주세요.',model_unavailable:'연결된 모델을 선택해 주세요.'};
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
 const selected=value.models.find(m=>draft.model==='auto'?m.provider===value.applied?.provider&&m.model===value.applied?.model:m.provider===draft.provider&&m.model===draft.model),changed=JSON.stringify(draft)!==JSON.stringify(value.settings),locked=disabled||saving;
 const change=patch=>{setError('');setDraft(old=>({...old,...patch}));};
 useEffect(()=>{if(!pickerOpen&&wasPickerOpen.current)document.getElementById('wiki-generation-model')?.focus({preventScroll:true});wasPickerOpen.current=pickerOpen;},[pickerOpen]);
 const choose=(provider,model)=>{const next=value.models.find(m=>m.provider===provider&&m.model===model);change({provider,model,...(draft.effort!=='auto'&&!next?.efforts.includes(draft.effort)?{effort:'auto'}:{})});setPickerOpen(false);return Promise.resolve(true);};
 const applied=value.applied,label=value.models.find(m=>m.provider===applied?.provider&&m.model===applied?.model)?.label||applied?.model;
 const provider=selected?.provider||applied?.provider||value.models[0]?.provider;
 const providers=Object.keys(DESKTOP_PROVIDER_LABELS);
 const catalogs=Object.fromEntries(providers.map(p=>[p,{models:value.models.filter(m=>m.provider===p).map(m=>({...m,name:m.model,displayName:m.label}))}]));
 const data={activeProvider:provider,settings:{modelId:selected?.model||''},catalog:catalogs[provider],catalogs,connections:Object.fromEntries(providers.map(p=>[p,{present:value.models.some(m=>m.provider===p)}])),selectedModels:Object.fromEntries(providers.map(p=>[p,draft.model!=='auto'&&draft.provider===p?draft.model:''])),report:{}};
 if(pickerOpen){
  return <section className="nubi-settings-section-body"><ModelSelection embedded embeddedLabel="생성 모델 선택" title={<span className="nubi-wiki-model-heading"><CxButton data-icon-only aria-label="생성 설정으로 돌아가기" title="생성 설정으로 돌아가기" onClick={()=>setPickerOpen(false)}><Icon name="chevronLeft" size={16}/></CxButton><span>모델 선택</span></span>} automaticOption={{label:'자동 (호스트 선택)',selected:draft.model==='auto',onSelect:async()=>{change({model:'auto',provider:null,effort:'auto'});setPickerOpen(false);return true;}}} data={data} initialProvider={provider} autoRefresh={false} manageConnections={false} showProviderNames providerLabels={Object.fromEntries(providers.map(p=>[p,DESKTOP_PROVIDER_LABELS[p]||p]))} disabled={locked} onProviderSelect={()=>Promise.resolve(true)} onSelect={(model,p)=>choose(p,model)}/></section>;
 }
 return <form className="nubi-settings-field" onSubmit={async event=>{event.preventDefault();if(!changed||locked)return;setSaving(true);setError('');try{const next=await api('wikiGeneration',{action:'set',value:draft});if(live.current){setDraft(next.settings);onChange(next);}}catch(cause){if(live.current)setError(errors[cause?.message]||'설정을 저장하지 못했어요. 다시 확인해 주세요.');}finally{if(live.current)setSaving(false);}}}><SettingsSection icon="sliders" title="생성 설정">
 <SettingsField id="wiki-generation-model" label="생성 모델"><ModelPicker data={data} open={pickerOpen} onOpen={()=>setPickerOpen(true)} disabled={locked||!value.models.length} providerLabels={DESKTOP_PROVIDER_LABELS}/></SettingsField>
 <SettingsField id="wiki-generation-effort" label="추론 강도"><CxSelect value={draft.effort} disabled={locked} onChange={event=>change({effort:event.target.value})}><option value="auto">자동</option>{(selected?.efforts||[]).map(effort=><option key={effort} value={effort}>{reasoningLabel(selected?.provider,effort)}</option>)}</CxSelect></SettingsField>
 <SettingsField id="wiki-generation-concurrency" label="동시에 작성"><CxSelect value={draft.concurrency} disabled={locked} onChange={event=>change({concurrency:Number(event.target.value)})}>{[1,2,3,4].map(n=><option key={n} value={n}>문서 {n}개</option>)}</CxSelect></SettingsField>
 <div className="nubi-wiki-response-limits"><DeckDisclosure title="응답 한도" icon="sliders"><SettingsField id="wiki-generation-calls" label="한 응답의 도구 호출"><CxSelect value={draft.maxToolCalls} disabled={locked} onChange={event=>change({maxToolCalls:Number(event.target.value)})}>{[8,16].map(n=><option key={n} value={n}>{n}개</option>)}</CxSelect></SettingsField><SettingsField id="wiki-generation-output" label="페이지 응답 상한" description={selected?.pageOutputConfigurable===false?'이 연결은 응답 길이를 서버가 정합니다':undefined}><CxSelect value={selected?.pageOutputConfigurable===false?'server':draft.pageMaxTokens} disabled={locked||selected?.pageOutputConfigurable===false} onChange={event=>change({pageMaxTokens:Number(event.target.value)})}>{selected?.pageOutputConfigurable===false&&<option value="server">서버 기본</option>}{[4096,8192,16384,32768].map(n=><option key={n} value={n}>{n.toLocaleString()} 토큰</option>)}</CxSelect></SettingsField></DeckDisclosure></div>
 <p role="status" className="nubi-muted">{applied?`적용: (${DESKTOP_PROVIDER_LABELS[applied.provider]||applied.provider}) ${label}, ${reasoningLabel(applied.provider,applied.effort)}, 문서 ${applied.concurrency}개${applied.pageMaxTokens?`, 페이지 최대 ${applied.pageMaxTokens.toLocaleString()} 토큰`:', 페이지 응답 서버 기본'}`:'연결된 모델을 선택해 주세요.'}</p>{error&&<p role="alert">{error}</p>}<div className="nubi-settings-actions"><CxButton type="submit" disabled={!changed||locked||draft.model!=='auto'&&!selected}>{saving?'저장 중':'저장'}</CxButton></div>
 </SettingsSection></form>;
}
