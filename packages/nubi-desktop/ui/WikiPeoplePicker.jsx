import React,{useEffect,useId,useRef,useState} from 'react';
import {Icon} from '@e2e/cx-design-system';
import './wiki-people-picker.css';
function Photo({person}){
 const [failed,setFailed]=useState(false);useEffect(()=>setFailed(false),[person?.avatar]);
 return <span className="nubi-person-photo" aria-hidden="true">{person?.avatar&&!failed?<img src={person.avatar} alt="" onError={()=>setFailed(true)}/>:<Icon name="user" size={16}/>}</span>;
}
export function WikiPeoplePicker({api,value,onChange,disabled,label='사람 선택',max=100}){
 const id=useId(),input=useRef(null),revision=useRef(0),[query,setQuery]=useState(''),[items,setItems]=useState([]),[people,setPeople]=useState({}),[busy,setBusy]=useState(false),[error,setError]=useState(''),[open,setOpen]=useState(false),[active,setActive]=useState(0),[more,setMore]=useState(false);
 useEffect(()=>{
  const generation=++revision.current;setItems([]);setError('');setActive(0);setMore(false);
  if(!query.trim()||disabled){setBusy(false);return;}
  setBusy(true);const timer=setTimeout(()=>{api('wikiRepository',{action:'people',query:query.trim()}).then(result=>{if(revision.current!==generation)return;setItems(result.items||[]);setMore(!!result.incomplete);setPeople(old=>({...old,...Object.fromEntries((result.items||[]).map(person=>[person.login.toLowerCase(),person]))}));}).catch(()=>{if(revision.current===generation)setError('사람을 찾지 못했어요. 연결을 확인하고 다시 입력해 주세요.');}).finally(()=>{if(revision.current===generation)setBusy(false);});},300);
  return()=>{clearTimeout(timer);if(revision.current===generation)revision.current++;};
 },[api,query,disabled]);
 const options=items.filter(person=>!value.some(login=>login.toLowerCase()===person.login.toLowerCase()));
 function choose(person){if(!person||disabled||value.length>=max)return;onChange([...value,person.login]);setQuery('');setOpen(false);input.current?.focus();}
 const expanded=open&&!!query.trim()&&!disabled;
 return <div className="nubi-people-picker" onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))setOpen(false);}}>
  <label className="nubi-wiki-field" htmlFor={id}>{label}</label>

  <div className="nubi-person-search"><Icon name="search" size={16}/><input id={id} ref={input} value={query} maxLength={100} disabled={disabled||value.length>=max} role="combobox" aria-autocomplete="list" aria-expanded={expanded} aria-controls={id+'-results'} aria-activedescendant={expanded&&options[active]?id+'-option-'+active:undefined} placeholder="이름, 아이디 또는 메일 검색" onFocus={()=>setOpen(true)} onChange={e=>{setQuery(e.target.value);setOpen(true);}} onKeyDown={e=>{
   if(e.nativeEvent.isComposing)return;
   if(e.key==='Escape'&&expanded){e.preventDefault();e.stopPropagation();setOpen(false);}
   else if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();setOpen(true);setActive(old=>options.length?(old+(e.key==='ArrowDown'?1:-1)+options.length)%options.length:0);}
   else if(e.key==='Enter'){e.preventDefault();if(expanded)choose(options[active]);}
  }}/></div>
  {expanded&&<div className="nubi-person-results"><div id={id+'-results'} role="listbox" aria-label="사람 검색 결과" aria-busy={busy}>{options.map((person,index)=><button type="button" id={id+'-option-'+index} role="option" aria-selected={active===index} key={person.login} onMouseDown={e=>e.preventDefault()} onMouseEnter={()=>setActive(index)} onClick={()=>choose(person)}><Photo person={person}/><span className="nubi-person-info"><strong>{person.name}</strong><small title={person.email||'@'+person.login}>{person.email||'@'+person.login}</small></span><Icon name="plus" size={16}/></button>)}</div>
  {(busy||error||!options.length||more)&&<p role="status">{busy?'찾고 있어요…':error||(!options.length?'일치하는 사람이 없어요. 이름이나 아이디로 다시 검색해 주세요.':'검색어를 더 입력해 범위를 좁힐 수 있어요.')}</p>}</div>}
  {!!value.length&&<div className="nubi-person-chips" aria-label={`${label} 선택됨`}>{value.map(login=>{const person=people[login.toLowerCase()]||{login,name:login};return <span className="nubi-person-chip" key={login.toLowerCase()} title={`${person.name} (@${login})`}><Photo person={person}/><strong>{person.name}</strong><button type="button" disabled={disabled} onClick={()=>onChange(value.filter(item=>item!==login))} aria-label={`${person.name} 제외`} title="선택 해제"><Icon name="xClose" size={14}/></button></span>;})}</div>}
 </div>;
}
