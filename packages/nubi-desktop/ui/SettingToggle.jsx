import React,{useId} from 'react';
import {Icon} from '@e2e/cx-design-system';
import './setting-toggle.css';

// Boolean preferences share the mail auto-organize switch. Selection lists keep checkboxes.
export function SettingToggle({label,description,icon,checked,disabled=false,onChange,className=''}){
 const id=useId();
 return <div className={`nubi-setting-toggle ${className}`}>
  {icon&&<Icon name={icon} size={18}/>}
  <div className="nubi-setting-toggle-copy"><label htmlFor={id}>{label}</label>{description&&<small id={`${id}-description`}>{description}</small>}</div>
  <button id={id} type="button" role="switch" className="nubi-ios-switch" aria-label={label} aria-checked={!!checked} aria-describedby={description?`${id}-description`:undefined} disabled={disabled} onClick={()=>onChange(!checked)}><span aria-hidden="true"/></button>
 </div>;
}
