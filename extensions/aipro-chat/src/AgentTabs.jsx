import React,{useCallback,useLayoutEffect,useRef,useState} from 'react';
import {CxTabs} from '@e2e/cx-design-system';

// Shared tab surface; CX retains keyboard navigation, roles and focus behavior.
export function AgentTabs({items, active, provider = false, containerRef, measureAfterLayout = false, ...props}) {
  const node=useRef(null),[geometry,setGeometry]=useState(null);
  const attach=useCallback(value=>{node.current=value;if(typeof containerRef==='function')containerRef(value);else if(containerRef)containerRef.current=value;},[containerRef]);
  useLayoutEffect(()=>{
    if(!measureAfterLayout||!node.current)return;
    const root=node.current;let frame=0,alive=true;
    const measure=()=>{frame=0;if(!alive||!root.isConnected)return;const tab=root.querySelector('[role="tab"][aria-selected="true"]');if(!tab)return;const base=root.getBoundingClientRect(),box=tab.getBoundingClientRect();if(!base.width||!base.height)return;const sx=root.offsetWidth/base.width,sy=root.offsetHeight/base.height,next={active,x:(box.left-base.left)*sx-root.clientLeft,y:(box.top-base.top)*sy-root.clientTop,width:box.width*sx,height:box.height*sy};setGeometry(old=>old&&old.active===active&&['x','y','width','height'].every(k=>Math.abs(old[k]-next[k])<.01)?old:next);};
    const queue=()=>{if(alive&&!frame)frame=requestAnimationFrame(measure);};
    const observer=typeof ResizeObserver==='function'?new ResizeObserver(queue):null;observer?.observe(root);window.addEventListener('resize',queue);document.fonts?.ready.then(queue);queue();
    return()=>{alive=false;cancelAnimationFrame(frame);observer?.disconnect();window.removeEventListener('resize',queue);};
  },[active,items.length,measureAfterLayout]);
  const measured=measureAfterLayout&&geometry?.active===active?geometry:null;
  const index = Math.max(0, items.findIndex(item => item.key === active));
  return <div ref={attach} data-indicator-active={measured?active:undefined} id={provider ? 'model-provider-tabs' : undefined}
    className={`agent-tabs${provider ? ' provider-switcher' : ''}`} data-provider={provider ? active : undefined}
    style={{'--tab-index': index, '--tab-count': items.length}}>
    <span className={`agent-tab-highlight${provider ? ' provider-tab-highlight' : ''}`} aria-hidden="true" style={measured?{left:0,top:measured.y,bottom:'auto',width:measured.width,height:measured.height,transform:`translateX(${measured.x}px)`}:undefined}>
      {provider && items.map(item => <i key={item.key} data-provider={item.key}/>)}
    </span>
    <CxTabs {...props} className={`agent-tab-controls${provider ? ' provider-tabs' : ''}`} items={items} active={active}/>
  </div>;
}
