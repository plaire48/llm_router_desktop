import React,{useLayoutEffect,useMemo,useRef,useState} from 'react';
import {createPortal} from 'react-dom';

// The list owns its selection and draft; the shell owns only the shared pane.
// Portals move the reader without remounting either the list or its contents.
export function useAuxiliaryDetailHost(setPane){
 const [target,setTarget]=useState(null),[detail,setDetail]=useState(null),current=useRef(null);
 const actions=useMemo(()=>({
  register(value){
   current.current=value;setDetail(value);setPane(value.kind);
   return()=>{if(current.current?.owner!==value.owner)return;current.current=null;setDetail(null);setPane(pane=>pane===value.kind?null:pane);};
  },
  rename(owner,title){if(current.current?.owner!==owner||current.current.title===title)return;const next={...current.current,title};current.current=next;setDetail(next);},
  show(kind){setPane(kind);},
  dismiss(kind){if(current.current?.kind===kind)current.current.onClose();else setPane(null);}
 }),[setPane]);
 const host=useMemo(()=>({...actions,target}),[actions,target]);
 return {host,detail,setTarget};
}

export function AuxiliaryDetail({host,kind,title,open=true,onClose,children}){
 const owner=useRef(Symbol(kind)),close=useRef(onClose);close.current=onClose;
 useLayoutEffect(()=>{if(host&&open)return host.register({owner:owner.current,kind,title,onClose:()=>close.current?.()});},[host,kind,open]);
 useLayoutEffect(()=>{if(host&&open)host.rename(owner.current,title);},[host,open,title]);
 if(!host)return children;
 return open&&host.target?createPortal(children,host.target):null;
}
