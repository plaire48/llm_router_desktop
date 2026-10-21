import React,{useId,useState} from 'react';
import {CxButton,CxInput,CxSelect,CxTextarea} from '@e2e/cx-design-system';
import {SettingsField} from './SettingsSection.jsx';
import {formImageFiles} from './form-cards-view.mjs';

// Values remain the person's words. The host validates types and file scope.
export function FormQuestionField({question,value='',onChange,files=[],disabled}){
 const id=useId(),label=question.label||question.slot,options=(question.options||[]).filter(option=>typeof option==='string');
 const [custom,setCustom]=useState(()=>Boolean(question.freeText&&value&&!options.includes(value)));
 if(question.kind==='boolean')return <div className="nubi-settings-control"><label id={`${id}-label`}>{label}</label><div className="nubi-form-boolean" role="group" aria-labelledby={`${id}-label`} aria-describedby={question.question?`${id}-help`:undefined}>{['예','아니오'].map(answer=><CxButton key={answer} type="button" disabled={disabled} aria-pressed={value===answer} onClick={()=>onChange(answer)}>{answer}</CxButton>)}</div>{question.question&&<small id={`${id}-help`}>{question.question}</small>}</div>;
 if(question.kind==='choice'||options.length)return <div className="nubi-form-choice">
  <SettingsField id={id} label={label} description={question.question}><CxSelect disabled={disabled||!options.length&&!question.freeText} value={custom?'custom':options.includes(value)?String(options.indexOf(value)):''} onChange={event=>{const next=event.target.value;setCustom(next==='custom');onChange(next==='custom'||next===''?'':options[Number(next)]);}}>
   <option value="">선택해 주세요</option>{options.map((option,index)=><option key={index} value={String(index)}>{option}</option>)}{question.freeText&&<option value="custom">직접 입력</option>}
  </CxSelect></SettingsField>
  {custom&&question.freeText&&<SettingsField id={`${id}-custom`} label={`${label} 직접 입력`}><CxInput disabled={disabled} value={value} onChange={event=>onChange(event.target.value)}/></SettingsField>}
  {!options.length&&!question.freeText&&<p role="status">선택 항목을 확인할 수 없어요. 작성을 취소한 뒤 양식을 다시 선택해 주세요.</p>}
 </div>;
 if(question.kind==='image'){
  const images=formImageFiles(files);
  return <SettingsField id={id} label={label} description={images.length?'Workspace의 PNG 또는 JPEG 그림을 선택해 주세요.':'Workspace에 PNG 또는 JPEG 그림을 추가한 뒤 다시 열어 주세요.'}><CxSelect disabled={disabled||!images.length} value={value} onChange={event=>onChange(event.target.value)}><option value="">그림 파일 선택</option>{images.map(file=><option key={file} value={file}>{file}</option>)}</CxSelect></SettingsField>;
 }
 return <SettingsField id={id} label={label} description={question.question}>{question.kind==='date'?<CxInput type="date" disabled={disabled} value={value} onChange={event=>onChange(event.target.value)}/>:<CxTextarea disabled={disabled} value={value} onChange={event=>onChange(event.target.value)}/>}</SettingsField>;
}
