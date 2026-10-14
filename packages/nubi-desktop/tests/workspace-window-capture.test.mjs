import test from 'node:test';
import assert from 'node:assert/strict';
import {installWorkspaceBrowser} from '../runtime/workspace-browser.mjs';

// The agent can look at Nubi's own window (user request 2026-10-14: "인앱 내에서라도" screen capture). The request names
// the window target; the host answers with one bounded PNG.
test('window capture asks the host for the app window and returns its picture',async t=>{
  const sent=[],listeners=[],original=process.send,on=process.on;
  process.send=(message,callback)=>{sent.push(message);callback?.(null);const request=message.workspaceCaptureRequest;if(request)setImmediate(()=>listeners.forEach(listener=>listener({workspaceCaptureReply:{id:request.id,image:'iVBOR',width:800,height:600,url:'nubi://workspace',title:'누비 Workspace'}})));return true;};
  process.on=function(event,listener){if(event==='message'){listeners.push(listener);return process;}return on.call(process,event,listener);};
  t.after(()=>{process.send=original;process.on=on;});
  const service={};installWorkspaceBrowser(service);
  const shot=await service.captureWorkspaceWindow();
  assert.deepEqual(sent[0].workspaceCaptureRequest.target,'window');
  assert.equal(shot.url,'nubi://workspace');assert.equal(shot.width,800);
});
