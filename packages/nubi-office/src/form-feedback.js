import {useState} from 'react';

function fieldError(input) {
  if(input.required&&!input.value.trim())return '값을 입력해 주세요.';
  if(input.maxLength>=0&&input.value.length>input.maxLength)return `${input.maxLength.toLocaleString('ko-KR')}자 이내로 입력해 주세요.`;
  if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(input.value))return '지원하지 않는 제어 문자를 지워 주세요.';
  if(input.validity.typeMismatch&&input.type==='url')return 'https://로 시작하는 전체 서버 주소를 입력해 주세요.';
  return input.validity.valid?'':'입력 형식을 확인해 주세요.';
}

// CX owns labels and error associations; native constraints remain the source
// of validation. This feedback never replaces worker/native validation.
export function useFormFeedback() {
  const [errors,setErrors]=useState({});
  const set=(id,message)=>setErrors(current=>({...current,[id]:message}));
  return {
    errors,
    reset:()=>setErrors({}),
    validate(form){
      const fields=[...form.querySelectorAll('input, textarea')].filter(input=>!input.disabled);
      const next=Object.fromEntries(fields.map(input=>[input.id,fieldError(input)]));
      setErrors(next);
      const first=fields.find(input=>next[input.id]);
      first?.focus();
      return !first;
    },
    input(onChange){return {
      onChange(event){set(event.currentTarget.id,'');onChange(event);},
      onBlur(event){set(event.currentTarget.id,fieldError(event.currentTarget));},
      onPaste(event){
        const input=event.currentTarget,text=event.clipboardData?.getData('text/plain');
        if(typeof text!=='string'||input.maxLength<0)return;
        const start=input.selectionStart??input.value.length,end=input.selectionEnd??start;
        const next=input.value.slice(0,start)+text+input.value.slice(end);
        if(next.length<=input.maxLength)return;
        event.preventDefault();
        set(input.id,`${input.maxLength.toLocaleString('ko-KR')}자를 넘겨 붙여넣지 않았습니다. 내용을 줄여 다시 붙여넣어 주세요.`);
      }
    };}
  };
}
