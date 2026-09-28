import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
// The production bundle must run from its own folder without repository imports.
const child=spawn(process.execPath,['worker/main.mjs'],{cwd:resolve(process.env.NUBI_BUNDLE_ROOT || 'dist'),stdio:['pipe','pipe','pipe']});
const lines=createInterface({input:child.stdout}), pending=new Map();let serial=0,stderr='';
child.stderr.on('data',chunk=>stderr+=chunk);
lines.on('line',line=>{const response=JSON.parse(line), entry=pending.get(response.id);if(entry){pending.delete(response.id);clearTimeout(entry.timer);entry.resolve(response);}});
const call=(method,payload={})=>new Promise((resolve,reject)=>{const id=String(++serial),timer=setTimeout(()=>reject(new Error('Bundled worker did not reply')),10000);pending.set(id,{resolve,reject,timer});child.stdin.write((serial===1?'\ufeff':'')+JSON.stringify({id,method,payload})+'\n');});
try{
  let result=await call('session');assert.equal(result.ok,true);assert.deepEqual(result.result.providers.map(p=>p.id),['aipro','chatgpt','fabrix','aipro-cli','compatible']);
  result=await call('connect',{provider:'compatible',baseUrl:'http://127.0.0.1:8787/v1',token:'synthetic-token',model:'한글-모델'});assert.equal(result.result.model,'한글-모델');assert.ok(!JSON.stringify(result).includes('synthetic-token'));
  result=await call('executeVba');assert.equal(result.ok,false);assert.equal(result.error,'unknown_method');assert.equal(stderr,'');
  console.log('PASS: standalone bundled worker, Windows UTF-8 preamble, five providers, Korean JSON and secret-free status. No live model request sent.');
}finally{lines.close();child.stdin.end();child.kill();for(const p of pending.values())clearTimeout(p.timer);}
