import React,{useId} from 'react';
import {CxButton,Icon} from '@e2e/cx-design-system';

export function ConnectionChoice({icon,title,description,selected,disabled,onClick}){
 const id=useId();
 return <CxButton aria-label={title} aria-describedby={description?id:undefined} className="nubi-connection-choice" aria-pressed={selected} disabled={disabled} onClick={onClick}>
  <span className="nubi-connection-symbol" aria-hidden="true">{icon}</span>
  <span className="nubi-connection-label"><span>{title}</span>{description&&<small id={id}>{description}</small>}</span>
 </CxButton>;
}
export function ConnectionDocument({icon,title,description,action,onClick,disabled}){
 const content=<><span className="nubi-connection-symbol" aria-hidden="true">{icon}</span><span className="nubi-connection-label"><span>{title}</span>{description&&<small>{description}</small>}</span>{action||(onClick&&<Icon name="arrowRight" size={16}/> )}</>;
 return onClick?<CxButton className="nubi-connection-document" disabled={disabled} onClick={onClick}>{content}</CxButton>:<div className="nubi-connection-document" role="group" aria-label={title}>{content}</div>;
}
export function ConnectionNote({children}){return <p className="nubi-connection-note"><Icon name="infoCircle" size={16}/><span>{children}</span></p>;}
