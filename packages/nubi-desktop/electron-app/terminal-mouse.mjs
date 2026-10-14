// Mouse tracking for the human terminal (user report 2026-10-14: clicking in the terminal filled the prompt with
// escape garbage and arrows). Windows ConPTY turns a console's mouse-input flag into DECSET ?1003;1006h, so xterm.js
// reported every click and every mouse move as ESC[<b;x;yM bytes written into PowerShell/cmd, which a line-editing
// prompt does not understand. It also switched off plain-drag selection. A line-editing prompt lives in the normal
// buffer; full-screen programs that really want the mouse (vim, htop, mc) use the alternate buffer. Tracking requests
// are therefore honoured only while the alternate buffer is active.

// DECSET modes that make the terminal send mouse reports: X10, VT200, highlight, button-event and any-event tracking.
// Encoding modes (1005, 1006, 1015, 1016) only change the report format and are left alone.
export const MOUSE_TRACKING_MODES=Object.freeze([9,1000,1001,1002,1003]);
const ALTERNATE_SCREEN_MODES=[47,1047,1049];

// Decides a CSI ? Pm h request. `handled` true means the request was consumed here and xterm's own handler must not
// run; `replay` is the remaining DECSET request (without tracking modes) to apply instead, or '' when nothing is left.
export function decsetRequest(params,alternate){
 const list=Array.from(params||[]);
 // A request that enters the alternate screen in the same sequence (CSI ? 1049;1000 h) belongs to a full-screen program.
 if(alternate||list.some(value=>ALTERNATE_SCREEN_MODES.includes(value))||!list.some(value=>MOUSE_TRACKING_MODES.includes(value)))return {handled:false,replay:''};
 const rest=list.filter(value=>!MOUSE_TRACKING_MODES.includes(value));
 return {handled:true,replay:rest.length?`\x1b[?${rest.map(value=>Array.isArray(value)?value.join(':'):value).join(';')}h`:''};
}

// Sent when a full-screen program returns to the normal buffer without switching tracking off itself.
export const MOUSE_TRACKING_OFF=MOUSE_TRACKING_MODES.map(mode=>`\x1b[?${mode}l`).join('');

// Wires the guard into an xterm.js Terminal. Returns a disposer.
export function guardShellMouse(view){
 const handler=view.parser.registerCsiHandler({prefix:'?',final:'h'},params=>{
  const decision=decsetRequest(params,view.buffer.active.type==='alternate');
  if(decision.replay)view.write(decision.replay);
  return decision.handled;
 });
 const change=view.buffer.onBufferChange(buffer=>{if(buffer.type==='normal')view.write(MOUSE_TRACKING_OFF);});
 return {dispose(){handler.dispose();change.dispose();}};
}
