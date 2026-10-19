// BrowserWindow visibility is authoritative when Chromium reports a hidden
// macOS window as visible. No permissions, file paths or document data cross IPC.
function watchMotionVisibility(window,{schedule=setInterval,cancel=clearInterval}={}){
 const contents=window.webContents;
 let last,active=true,hidden=!window.isVisible(),minimized=window.isMinimized();
 const publish=(force=false)=>{if(!active||window.isDestroyed()||contents.isDestroyed())return;const visible=!hidden&&!minimized;if(force||visible!==last){last=visible;contents.send('nubi:host-event',{type:'window_visibility',visible});}};
 // Use the event's meaning, not a reentrant AppKit visibility query or a timer
 // which may be starved while the native window is hidden.
 const handlers={hide:()=>{hidden=true;publish();},show:()=>{hidden=false;publish();},minimize:()=>{minimized=true;publish();},restore:()=>{minimized=false;publish();}};
 const loaded=()=>{hidden=!window.isVisible();minimized=window.isMinimized();publish(true);};
 for(const [event,handler] of Object.entries(handlers))window.on(event,handler);contents.on('did-finish-load',loaded);
 // Some macOS/Electron paths change isVisible without a hide/visibility event.
 // One bounded main-process fallback; no renderer polling or layout reads.
 const poll=schedule(()=>{if(!active||window.isDestroyed())return;hidden=!window.isVisible();minimized=window.isMinimized();publish();},250);poll?.unref?.();
 const stop=()=>{if(!active)return;active=false;cancel(poll);for(const [event,handler] of Object.entries(handlers))window.removeListener(event,handler);contents.removeListener('did-finish-load',loaded);window.removeListener('closed',stop);};window.once('closed',stop);publish();return stop;
}
module.exports={watchMotionVisibility};
