import React,{cloneElement,useId} from 'react';
import {Icon} from '@e2e/cx-design-system';
import './settings-section.css';
// The mail settings pattern, shared by forms without adding another card layer.
export function PanelTitle({icon,children}){return <span className="nubi-panel-title"><span className="nubi-panel-title-icon" aria-hidden="true"><Icon name={icon} size={18}/></span><span>{children}</span></span>;}
export function SettingsSection({icon,title,description,children}){
 const id=useId();return <fieldset className="nubi-settings-section" aria-describedby={description?id:undefined}><legend><span className="nubi-settings-section-icon" aria-hidden="true"><Icon name={icon} size={18}/></span><strong>{title}</strong></legend><div className="nubi-settings-section-body">{description&&<p id={id} className="nubi-settings-section-description">{description}</p>}{children}</div></fieldset>;
}
export function SettingsField({id,label,description,children}){const help=id+'-help';return <div className="nubi-settings-control"><label htmlFor={id}>{label}</label>{cloneElement(children,{id,...(description?{'aria-describedby':[children.props['aria-describedby'],help].filter(Boolean).join(' ')}:{})})}{description&&<small id={help}>{description}</small>}</div>;}
