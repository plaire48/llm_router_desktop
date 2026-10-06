import React, {useLayoutEffect, useRef, useState} from 'react';
import {CxButton, Icon} from '@e2e/cx-design-system';
import {NubiComposerInput, NubiComposerBar} from '../../../extensions/aipro-chat/src/NubiSurfaces.jsx';
import {useComposerCommands} from './ComposerCommands.jsx';

// Shared Nubi composer: skills/model/reasoning/context lead; approval/send trail.
// While running, a draft goes to the inbox and Stop remains available.
export function WorkspaceComposer({className = '', inputRef, id = 'message-input', value, onSubmit, sendDisabled, modelControl, actionControl, evidenceControl, onStop, onMinimumWidth, commandApi, taskId, onCommand, ...inputProps}) {
  const commands=useComposerCommands({api:commandApi,taskId,value,inputRef,onChange:inputProps.onChange,onCommand});
  const form = useRef(null);
  const [expanded, setExpanded] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  useLayoutEffect(() => {
    if (!onMinimumWidth || !form.current) return;
    const node = form.current, content = node.closest('.nubi-workbench-content');
    const bar = node.querySelector('.composer-bottom');
    let disposed = false;
    const pixels = value => parseFloat(value) || 0;
    const measure = () => {
      if (disposed || !node.isConnected) return;
      const iconSize = pixels(getComputedStyle(node).getPropertyValue('--nubi-composer-icon-size')) || 32;
      const groupWidth = group => {
        if (!group) return 0;
        const items = [...group.children].filter(item => getComputedStyle(item).display !== 'none');
        return items.reduce((sum, item) => {
          if (item.matches('.model-trigger,.nubi-approval-mode')) return sum + iconSize;
          if (item.matches('.model-picker')) {
            // A loading/error control beside the model remains available.
            return sum + iconSize + [...item.children].filter(child => !child.matches('.model-trigger')).reduce((extra, child) => extra + child.getBoundingClientRect().width, 0);
          }
          return sum + item.getBoundingClientRect().width;
        }, 0) + Math.max(0, items.length - 1) * pixels(getComputedStyle(group).columnGap);
      };
      let minimum = groupWidth(bar.querySelector('.composer-leading')) + groupWidth(bar.querySelector('.composer-tools')) + pixels(getComputedStyle(bar).columnGap);
      // Include the input card and reading-column insets, not just the icons.
      for (let ancestor = node; ancestor && ancestor !== content; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor);
        // Fluid reading insets contract with the agent. Reserve their lower
        // bound so a wide layout cannot inflate the minimum during resizing.
        const fluid = ancestor.matches('.nubi-main'), inset = pixels(style.getPropertyValue('--nubi-chat-min-inset'));
        minimum += (fluid && inset ? inset * 2 : pixels(style.paddingLeft) + pixels(style.paddingRight)) + pixels(style.borderLeftWidth) + pixels(style.borderRightWidth);
      }
      onMinimumWidth(Math.ceil(minimum) + 2);
    };
    const sizes = new ResizeObserver(measure);
    const observe = () => {
      sizes.disconnect();
      sizes.observe(node);
      for (const item of node.querySelectorAll('.composer-leading > *, .composer-tools > *')) sizes.observe(item);
      measure();
    };
    const changes = new MutationObserver(observe);
    changes.observe(bar, {childList:true, subtree:true, characterData:true});
    observe();
    document.fonts?.ready.then(measure);
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
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(field);
    window.addEventListener('resize', measure);
    return () => {observer?.disconnect(); window.removeEventListener('resize', measure);};
  }, [inputRef, value, expanded]);
  return <form ref={form} className={`composer ${className}`} onSubmit={onSubmit}>
    {evidenceControl}
    <div className="nubi-composer-input" data-expanded={expanded}>
      <NubiComposerInput inputRef={inputRef} id={id} value={value} title="" {...inputProps} {...commands.inputAttributes} onKeyDown={event=>{if(!commands.onKeyDown(event))inputProps.onKeyDown?.(event);}}/>
    </div>
    <NubiComposerBar leading={modelControl} tools={<>{hasMore && <CxButton type="button" className="nubi-composer-more" aria-expanded={expanded} aria-controls={id} onClick={() => {
      setExpanded(current => !current);
      requestAnimationFrame(() => inputRef.current?.focus());
    }} aria-label={expanded?'접기':'더 보기'} title={expanded?'입력 접기':'입력 펼치기'}><Icon name={expanded?'chevronUp':'chevronDown'} size={16}/></CxButton>}{actionControl}{onStop ? <>{value.trim()&&<CxButton type="submit" variant="primary" aria-label="대기열에 추가" title="대기열에 추가" disabled={sendDisabled}><Icon name="arrowUp" size={20}/></CxButton>}<CxButton type="button" className="nubi-composer-stop" aria-label="중지" title="작업 중지" onClick={onStop}><span className="stop-symbol" aria-hidden="true"/></CxButton></> : <CxButton type="submit" variant="primary" aria-label="전송" title="전송" disabled={sendDisabled}><Icon name="arrowUp" size={20}/></CxButton>}</>}/>
    {commands.popup}
  </form>;
}
