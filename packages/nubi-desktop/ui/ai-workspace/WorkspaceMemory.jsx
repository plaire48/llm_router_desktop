import React, { createContext, useContext, useLayoutEffect, useRef, useState } from 'react';

// Keep view preferences in this app session, without retaining stale remote data
// or putting work-item contents or credentials into browser storage.
const Memory = createContext(null);

// The main area scrolls inside the header/footer frame at every viewport size.
export function workspaceScroller(main) {
  if (!main) return null;
  return getComputedStyle(main).overflowY === 'visible' ? main.closest('.list-app-shell') : main;
}
export function WorkspaceMemory({ children }) {
  const memory = useRef(new Map());
  return <Memory.Provider value={memory.current}>{children}</Memory.Provider>;
}

export function useWorkspaceState(key, initial) {
  const memory = useContext(Memory);
  const [value, setValue] = useState(() => memory.has(key) ? memory.get(key) : typeof initial === 'function' ? initial() : initial);
  const update = (next) => setValue((current) => {
    const result = typeof next === 'function' ? next(current) : next;
    memory.set(key, result);
    return result;
  });
  return [value, update];
}

export function TableViewport({ memoryKey, resetKey, className, children }) {
  const memory = useContext(Memory);
  const element = useRef(null);
  const previousReset = useRef(resetKey);
  useLayoutEffect(() => {
    const position = memory.get(memoryKey) || { top: 0, left: 0 };
    element.current.scrollTop = previousReset.current === resetKey ? position.top : 0;
    element.current.scrollLeft = position.left;
    previousReset.current = resetKey;
  }, [memory, memoryKey, resetKey]);
  return <div ref={element} className={className} onScroll={(event) => memory.set(memoryKey, { top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft })}>{children}</div>;
}
