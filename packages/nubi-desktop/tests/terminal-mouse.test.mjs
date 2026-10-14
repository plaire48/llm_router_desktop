// Clicking in the interactive terminal filled the prompt with escape garbage and arrows (user report 2026-10-14).
// Windows ConPTY asks for any-event mouse tracking (CSI ? 1003;1006 h) on behalf of PowerShell/cmd, so every click and
// mouse move became ESC[<b;x;yM input. Tracking is honoured only in the alternate buffer (full-screen programs), and the
// panel turns off xterm's Alt+click cursor moves, which type arrow keys.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {decsetRequest,guardShellMouse,MOUSE_TRACKING_OFF} from '../electron-app/terminal-mouse.mjs';

test('a mouse tracking request at the shell prompt is consumed and only its encoding part is applied',()=>{
  assert.deepEqual(decsetRequest([1003,1006],false),{handled:true,replay:'\x1b[?1006h'});
  assert.deepEqual(decsetRequest([1000],false),{handled:true,replay:''});
  assert.deepEqual(decsetRequest([9],false),{handled:true,replay:''});
  assert.deepEqual(decsetRequest([1002,25],false),{handled:true,replay:'\x1b[?25h'});
});

test('full-screen programs and unrelated modes are left to xterm',()=>{
  assert.deepEqual(decsetRequest([1003,1006],true),{handled:false,replay:''});
  assert.deepEqual(decsetRequest([1049,1000],false),{handled:false,replay:''},'entering the alternate screen in the same request');
  assert.deepEqual(decsetRequest([25],false),{handled:false,replay:''});
  assert.deepEqual(decsetRequest([1004],false),{handled:false,replay:''});
  assert.deepEqual(decsetRequest([2004],false),{handled:false,replay:''});
});

test('the guard hooks DECSET and switches tracking off when a program returns to the normal buffer',()=>{
  const writes=[];let csi,change,disposed=0;
  const view={
    buffer:{active:{type:'normal'},onBufferChange(listener){change=listener;return {dispose(){disposed++;}};}},
    parser:{registerCsiHandler(id,callback){assert.deepEqual(id,{prefix:'?',final:'h'});csi=callback;return {dispose(){disposed++;}};}},
    write(data){writes.push(data);}
  };
  const guard=guardShellMouse(view);
  assert.equal(csi([1003,1006]),true);assert.deepEqual(writes,['\x1b[?1006h']);
  view.buffer.active.type='alternate';assert.equal(csi([1000,1006]),false);
  change({type:'normal'});assert.equal(writes.at(-1),MOUSE_TRACKING_OFF);
  for(const mode of [9,1000,1001,1002,1003])assert.ok(MOUSE_TRACKING_OFF.includes(`\x1b[?${mode}l`));
  change({type:'alternate'});assert.equal(writes.length,2);
  guard.dispose();assert.equal(disposed,2);
});

test('the terminal panel wires the guard and never moves the cursor on click',async()=>{
  const source=await readFile(new URL('../electron-app/TerminalPanel.jsx',import.meta.url),'utf8');
  assert.match(source,/altClickMovesCursor:false/);
  assert.match(source,/guardShellMouse\(view\)/);
  assert.match(source,/mouse\.dispose\(\)/);
  assert.ok(source.indexOf('guardShellMouse(view)')<source.indexOf("write(result.output||'')"),'the guard is active before the replayed output');
});
