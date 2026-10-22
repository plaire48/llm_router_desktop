import React,{useCallback,useEffect,useState} from 'react';
import {CxButton,Icon} from '@e2e/cx-design-system';
import {ModelPicker,ModelSelection} from '../../../extensions/aipro-chat/src/ChatControls.jsx';
import {ReasoningPicker} from './ReasoningPicker.jsx';
import {DESKTOP_PROVIDER_LABELS} from './provider-labels.mjs';
import './wiki-model-choice.css';
// The wiki generation model and its reasoning, shown as the composer's two chips wherever a wiki is made: generation
// settings and the rebuild confirmations (user decision 2026-10-23). value is a draft {model,provider,effort} of the
// saved generation settings; 자동 means the conversation's choice (runtime/wiki-generation.mjs).
const AUTOMATIC=[{id:'auto',label:'자동'}];
export function wikiModelSelected(view,value){return view.models.find(m=>value.model==='auto'?m.provider===view.applied?.provider&&m.model===view.applied?.model:m.provider===value.provider&&m.model===value.model);}
function pickerData(view,value){
 const selected=wikiModelSelected(view,value),provider=selected?.provider||view.applied?.provider||view.models[0]?.provider,providers=Object.keys(DESKTOP_PROVIDER_LABELS);
 const catalogs=Object.fromEntries(providers.map(p=>[p,{models:view.models.filter(m=>m.provider===p).map(m=>({...m,name:m.model,displayName:m.label}))}]));
 return {activeProvider:provider,settings:{modelId:selected?.model||''},catalog:catalogs[provider],catalogs,connections:Object.fromEntries(providers.map(p=>[p,{present:view.models.some(m=>m.provider===p)}])),selectedModels:Object.fromEntries(providers.map(p=>[p,value.model!=='auto'&&value.provider===p?value.model:''])),report:{}};
}
// Choosing a model keeps the effort only when the new model offers it.
export function chooseWikiModel(view,value,provider,model){
 if(model==='auto')return {model:'auto',provider:null,effort:'auto'};
 const next=view.models.find(m=>m.provider===provider&&m.model===model);
 return {provider,model,...(value.effort!=='auto'&&!next?.efforts.includes(value.effort)?{effort:'auto'}:{})};
}
export function WikiModelChips({id,view,value,open=false,onOpen,onChange,disabled=false}){
 const selected=wikiModelSelected(view,value);
 return <div className="nubi-wiki-model-chips">
  <ModelPicker id={id} data={pickerData(view,value)} open={open} onOpen={onOpen} disabled={disabled||!view.models.length} providerLabels={DESKTOP_PROVIDER_LABELS}/>
  {selected?.efforts?.length>0&&<ReasoningPicker provider={{provider:selected.provider,model:selected.model,connected:true,reasoningOptions:selected.efforts}} value={value.effort} leadingOptions={AUTOMATIC} resetTo="auto" onApply={effort=>onChange({effort})} disabled={disabled}/>}
 </div>;
}
export function WikiModelSelection({view,value,onChoose,onBack,disabled=false}){
 const data=pickerData(view,value),providers=Object.keys(DESKTOP_PROVIDER_LABELS);
 return <ModelSelection embedded embeddedLabel="생성 모델 선택" title={<span className="nubi-wiki-model-heading"><CxButton data-icon-only aria-label="생성 설정으로 돌아가기" title="생성 설정으로 돌아가기" onClick={onBack}><Icon name="chevronLeft" size={16}/></CxButton><span>모델 선택</span></span>} automaticOption={{label:'자동 (호스트 선택)',selected:value.model==='auto',onSelect:async()=>{onChoose(null,'auto');return true;}}} data={data} initialProvider={data.activeProvider} autoRefresh={false} manageConnections={false} showProviderNames providerLabels={Object.fromEntries(providers.map(p=>[p,DESKTOP_PROVIDER_LABELS[p]||p]))} disabled={disabled} onProviderSelect={()=>Promise.resolve(true)} onSelect={(model,provider)=>{onChoose(provider,model);return Promise.resolve(true);}}/>;
}
// For the rebuild confirmations: loads the saved settings, keeps a draft and saves it right before the rebuild.
export function useWikiModelChoice(api){
 const [view,setView]=useState(null),[value,setValue]=useState(null),[open,setOpen]=useState(false);
 useEffect(()=>{if(!api)return;let live=true;api('wikiGeneration').then(next=>{if(live&&next?.settings){setView(next);setValue({model:next.settings.model,provider:next.settings.provider,effort:next.settings.effort});}}).catch(()=>{});return()=>{live=false;};},[api]);
 const save=useCallback(async()=>{if(!view||!value)return;const settings={...view.settings,...value};if(JSON.stringify(settings)!==JSON.stringify(view.settings))await api('wikiGeneration',{action:'set',value:settings});},[api,view,value]);
 return {view,value,open,setOpen,change:patch=>setValue(old=>({...old,...patch})),choose:(provider,model)=>{setValue(old=>({...old,...chooseWikiModel(view,old,provider,model)}));setOpen(false);},save};
}
export function WikiRebuildModel({control,disabled=false}){
 const {view,value,open}=control;if(!view||!value)return null;
 return <div className="nubi-wiki-rebuild-model">{open?<WikiModelSelection view={view} value={value} disabled={disabled} onBack={()=>control.setOpen(false)} onChoose={control.choose}/>:<><span>만들 모델</span><WikiModelChips view={view} value={value} disabled={disabled} onOpen={()=>control.setOpen(true)} onChange={control.change}/></>}</div>;
}
