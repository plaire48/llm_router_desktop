import test from 'node:test';
import assert from 'node:assert/strict';
import {trustedRenderer} from '../electron-app/renderer-scope.cjs';
test('bundled inquiry routes retain IPC access without trusting other documents or frames',()=>{
 const frame={url:'app://bundle/index.html'},contents={mainFrame:frame},window={webContents:contents},event={sender:contents,senderFrame:frame};
 for(const url of ['app://bundle/index.html','app://bundle/index.html#support','app://bundle/index.html#support/123']){frame.url=url;assert.doesNotThrow(()=>trustedRenderer(event,window));}
 for(const url of ['https://example.test/#support','app://bundle/index.html?redirect=1#support','app://evil/index.html#support','app://bundle/other.html#support','app://bundle/index.html/anything#support','app://user@bundle/index.html#support']){frame.url=url;assert.throws(()=>trustedRenderer(event,window),/ipc_scope/);}
 frame.url='app://bundle/index.html#support';assert.throws(()=>trustedRenderer({...event,sender:{}},window),/ipc_scope/);assert.throws(()=>trustedRenderer({...event,senderFrame:{url:frame.url}},window),/ipc_scope/);assert.throws(()=>trustedRenderer({...event,senderFrame:null},window),/ipc_scope/);
});
