import React, {useLayoutEffect, useRef, useState} from 'react';
import {CxButton, Icon} from '@e2e/cx-design-system';
import {NubiComposerInput, NubiComposerBar} from '../../../extensions/aipro-chat/src/NubiSurfaces.jsx';
import {WORKSPACE_LAYOUT} from '../electron-app/workspace-layout.cjs';
import {useComposerCommands} from './ComposerCommands.jsx';
import {splitComposerDraft,updateComposerInput} from './composer-command-state.mjs';
import {TerminalMark} from './marks.jsx';

// Shared Nubi composer: model, approval and context stay inside the input surface.
// While running, a draft goes to the inbox and Stop remains available.
export function WorkspaceComposer({className = '', hidden=false, inputRef, id = 'message-input', value, onSubmit, sendDisabled, sending=false, modelControl, actionControl, contextControl, evidenceControl, onStop, onMinimumWidth, commandApi, taskId, onCommand,wikiEnabled=true, ...inputProps}) {
  const [skills,setSkills]=useState([]),draft=splitComposerDraft(value,skills);
  const writeInput=event=>inputProps.onChange({target:{value:updateComposerInput(value,event.target.value,skills)}});
  const commands=useComposerCommands({api:commandApi,taskId,value:draft.input,inputRef,onChange:writeInput,onCommand,wikiEnabled,onCatalog:setSkills,onSelect:(item,input)=>inputProps.onChange({target:{value:`/${item.command} ${input}`}})});
  const change=event=>{commands.onInputChange();writeInput(event);};
  const cannotSend=sendDisabled||!draft.input.trim();
  const form = useRef(null), previousLayout=useRef(null), entrance=useRef(null),entranceObserver=useRef(null),pendingEntrance=useRef(null);
  useLayoutEffect(()=>{
    const node=form.current;if(!node)return;
    const previous=previousLayout.current;
    previousLayout.current={...previous,value};
    // Animate only the first Send's layout change. Work starts immediately;
    // admission and subsequent typing never wait for a transition to finish.
    if(Number.isFinite(previous?.top)&&previous?.value&&!value&&sending&&node.closest('.nubi-submit-scene')&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
      pendingEntrance.current=previous.top;entranceObserver.current?.unobserve(node);entranceObserver.current?.observe(node);
    }
  },[value,sending]);
  useLayoutEffect(()=>{const node=form.current;if(!node)return;const observer=new ResizeObserver(()=>{const top=node.getBoundingClientRect().top;if(pendingEntrance.current!==null){const offset=pendingEntrance.current-top;pendingEntrance.current=null;if(Math.abs(offset)>2){entrance.current?.cancel();entrance.current=node.animate([{transform:`translateY(${offset}px)`},{transform:'translateY(0)'}],{duration:180,easing:'cubic-bezier(.2,.8,.2,1)'});}}previousLayout.current={...previousLayout.current,top};});entranceObserver.current=observer;observer.observe(node);return()=>{entranceObserver.current=null;observer.disconnect();entrance.current?.cancel();};},[]);
  const [expanded, setExpanded] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  useLayoutEffect(() => {
    if (!onMinimumWidth || !form.current) return;
    const node = form.current, content = node.closest('.nubi-workbench-content');
    const bar = node.querySelector('.composer-bottom');
    let disposed = false;
    const pixels = value => parseFloat(value) || 0;
    const measure = () => {
      if (disposed || !node.isConnected || node.hidden) return;
      
      const groupWidth = group => {
        if (!group) return 0;
        // Count each control, including model recovery and running/queue actions.
        // A wrapper can contain more than one button; capping its total lost space.
        const controls=[...group.querySelectorAll('button,.status-spinner')].filter(item=>!item.closest('[role="dialog"],[role="menu"]')&&item.getClientRects().length);
        const style=getComputedStyle(node),icon=pixels(style.getPropertyValue('--nubi-composer-icon-size'))||36;
        return controls.reduce((sum,item)=>sum+(item.matches('.context-trigger')?Math.max(44,item.getBoundingClientRect().width):item.matches('.status-spinner')?item.getBoundingClientRect().width:icon),0)+Math.max(0,controls.length-1)*pixels(getComputedStyle(group).columnGap);
      };
      let minimum = groupWidth(bar.querySelector('.composer-leading'))+groupWidth(bar.querySelector('.composer-tools'))+pixels(getComputedStyle(bar).columnGap);
      const surfaceStyle=getComputedStyle(node.querySelector('.nubi-composer-surface'));
      minimum+=pixels(surfaceStyle.paddingLeft)+pixels(surfaceStyle.paddingRight)+pixels(surfaceStyle.borderLeftWidth)+pixels(surfaceStyle.borderRightWidth);
      // Include the input card and reading-column insets, not just the icons.
      for (let ancestor = node; ancestor && ancestor !== content; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor);
        // Fluid reading insets contract with the agent. Reserve their lower
        // bound so a wide layout cannot inflate the minimum during resizing.
        const fluid = ancestor.matches('.nubi-main'), inset = pixels(style.getPropertyValue('--nubi-chat-min-inset'));
        minimum += (fluid && inset ? inset * 2 : pixels(style.paddingLeft) + pixels(style.paddingRight)) + pixels(style.borderLeftWidth) + pixels(style.borderRightWidth);
      }
      onMinimumWidth(Math.max(WORKSPACE_LAYOUT.minimumAgent,Math.ceil(minimum) + 2));
    };
    const sizes = new ResizeObserver(measure);
    const observe = () => {
      sizes.disconnect();
      sizes.observe(node);
      for (const item of node.querySelectorAll('.composer-leading > *, .composer-tools > *')) sizes.observe(item);
    };
    const changes = new MutationObserver(observe);
    changes.observe(bar, {childList:true, subtree:true, characterData:true});
    observe();
    // Initial delivery and font-driven control size changes are observed above.
    // Reading FontFaceSet.ready during commit itself forces synchronous layout.
    return () => {disposed = true; sizes.disconnect(); changes.disconnect();};
  }, [onMinimumWidth]);
  useLayoutEffect(() => {
    const field = inputRef.current;
    if (!field) return;
    const measure = () => {
      const more = field.scrollHeight > 181;
      setHasMore(current => current === more ? current : more);
      if (!more) setExpanded(false);
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    // Each observation delivers an initial notification after layout, including
    // value changes whose overflow grows inside an already capped textarea.
    if (observer) observer.observe(field);
    else {measure(); window.addEventListener('resize', measure);}
    return () => {observer?.disconnect(); window.removeEventListener('resize', measure);};
  }, [inputRef, value, expanded]);
  function submit(event){event.preventDefault();if(!hidden&&!cannotSend)onSubmit(event);}
  function clearCommand(){inputProps.onChange({target:{value:draft.input}});inputRef.current?.focus({preventScroll:true});}
  function keyDown(event){
    if(commands.onKeyDown(event))return;
    if(event.key==='Backspace'&&!event.nativeEvent.isComposing&&draft.selection&&event.currentTarget.selectionStart===0&&event.currentTarget.selectionEnd===0){event.preventDefault();inputProps.onChange({target:{value:draft.input}});return;}
    inputProps.onKeyDown?.(event);
    if(!event.defaultPrevented&&event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing&&event.keyCode!==229)submit(event);
  }
  return <form ref={form} hidden={hidden} className={`composer ${className}`} onSubmit={submit}>
    <div className="nubi-composer-surface">
    {evidenceControl}
    {draft.selection&&<div className="nubi-command-chip-row" role="group" aria-label="선택한 명령 또는 스킬"><CxButton type="button" className="nubi-command-chip" aria-label={draft.selection.title} aria-description="두 번 누르거나 Delete 키로 선택 해제" title="두 번 누르면 선택 해제" onDoubleClick={clearCommand} onKeyDown={event=>{if(['Enter',' ','Delete','Backspace'].includes(event.key)){event.preventDefault();event.stopPropagation();clearCommand();}}}>{draft.selection.icon==='terminal'?<TerminalMark size={17}/>:<Icon name={draft.selection.icon} size={17}/>}<span>{draft.selection.title}</span></CxButton></div>}
    <div className="nubi-composer-input" data-expanded={expanded}>
      <NubiComposerInput rows={1} inputRef={inputRef} id={id} title="" {...inputProps} value={draft.input} onChange={change} {...commands.inputAttributes} onKeyDown={keyDown}/>
    </div>
    <NubiComposerBar leading={modelControl} tools={<>{actionControl}{contextControl}{hasMore && <CxButton type="button" className="nubi-composer-more" data-icon-only aria-expanded={expanded} aria-controls={id} onClick={() => {
      setExpanded(current => !current);
      requestAnimationFrame(() => inputRef.current?.focus());
    }} aria-label={expanded?'접기':'더 보기'} title={expanded?'입력 접기':'입력 펼치기'}><Icon name={expanded?'chevronUp':'chevronDown'} size={16}/></CxButton>}{onStop ? <>{value.trim()&&<CxButton type="submit" variant="primary" data-icon-only aria-label="대기열에 추가" title="대기열에 추가" disabled={cannotSend}><Icon name="arrowUp" size={20}/></CxButton>}<CxButton type="button" className="nubi-composer-stop" data-icon-only aria-label="중지" title="작업 중지" onClick={onStop}><span className="stop-symbol" aria-hidden="true"/></CxButton></> : <CxButton type="submit" variant="primary" data-icon-only aria-label={sending?"요청 접수 중":"전송"} title={sending?"요청 접수 중":"전송"} disabled={cannotSend}>{sending?<span className="status-spinner" aria-hidden="true"/>:<Icon name="arrowUp" size={20}/>}</CxButton>}</>}/>
    </div>
    {!hidden&&commands.popup}
  </form>;
}
