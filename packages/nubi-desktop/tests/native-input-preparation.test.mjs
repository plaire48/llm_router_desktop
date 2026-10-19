import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {prepareNativeInput}=require('../electron-app/native-input-preparation.cjs');
function port(){const calls=[];let pid=10,destroyed=false;return {calls,setPid:value=>{pid=value;},destroy:()=>{destroyed=true;},isDestroyed:()=>destroyed,webContents:{isDestroyed:()=>destroyed,getOSProcessId:()=>pid,executeJavaScript:async()=>{calls.push('paint');},sendInputEvent:event=>calls.push(event)}};}
test('native input prepares after paint, sends only an outside mouseMove and waits for the next paint',async()=>{
 const window=port(),result=await prepareNativeInput(window);assert.equal(result.status,'ready');assert.equal(result.sent,true);assert.deepEqual(window.calls,['paint',{type:'mouseMove',x:-1,y:-1},'paint']);assert.ok(result.durationMs>=0);
});
test('one renderer process shares one preparation, while a replacement renderer prepares once again',async()=>{
 const window=port();const [a,b]=await Promise.all([prepareNativeInput(window),prepareNativeInput(window)]);assert.strictEqual(a,b);assert.equal(window.calls.length,3);window.setPid(11);assert.equal((await prepareNativeInput(window)).status,'ready');assert.equal(window.calls.length,6);
});
test('preparation failure is retained and never resends an uncertain native event',async()=>{
 const window=port();window.webContents.executeJavaScript=async()=>{throw Error('disposed');};const result=await prepareNativeInput(window);assert.equal(result.status,'failed');assert.equal(result.error,'native_input_failed');assert.equal(result.sent,false);assert.strictEqual(await prepareNativeInput(window),result);assert.deepEqual(window.calls,[]);
});
test('timeout before first paint prevents a late input dispatch',async()=>{
 const window=port();let release;window.webContents.executeJavaScript=()=>new Promise(r=>{release=r;});const result=await prepareNativeInput(window,{timeoutMs:10});assert.equal(result.error,'native_input_timeout');release();await new Promise(r=>setTimeout(r,0));assert.deepEqual(window.calls,[]);assert.strictEqual(await prepareNativeInput(window),result);
});
test('a destroyed host cannot be marked ready',async()=>{const window=port();window.destroy();const result=await prepareNativeInput(window);assert.equal(result.status,'failed');assert.equal(result.sent,false);assert.deepEqual(window.calls,[]);});
test('failure after dispatch is retained with sent=true and does not repeat the move',async()=>{
 const window=port();let paints=0;window.webContents.executeJavaScript=async()=>{if(++paints===2)throw Error('renderer lost');};const result=await prepareNativeInput(window);assert.equal(result.status,'failed');assert.equal(result.sent,true);assert.equal(window.calls.length,1);assert.strictEqual(await prepareNativeInput(window),result);assert.equal(window.calls.length,1);
});
test('timeout after dispatch never retries an input whose paint acknowledgement is late',async()=>{
 const window=port();let paints=0,release;window.webContents.executeJavaScript=()=>++paints===1?Promise.resolve():new Promise(r=>{release=r;});const result=await prepareNativeInput(window,{timeoutMs:10});assert.equal(result.error,'native_input_timeout');assert.equal(result.sent,true);release();await new Promise(r=>setTimeout(r,0));assert.strictEqual(await prepareNativeInput(window),result);assert.equal(window.calls.length,1);
});
