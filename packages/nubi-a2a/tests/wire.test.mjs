import test from 'node:test';
import assert from 'node:assert/strict';
import {createCollaborationServer} from '../server.mjs';

test('both JSON-RPC endpoints return standard errors to an independent HTTP client',async t=>{
  const rows=new Map(),records={get:key=>rows.get(key),set:(key,value)=>rows.set(key,structuredClone(value)),list:prefix=>[...rows].filter(([key])=>key.startsWith(prefix)).map(([,value])=>structuredClone(value))};
  const server=await createCollaborationServer({records});t.after(()=>server.close());
  const invite=new URL(server.invite('browser').url),fragment=new URLSearchParams(invite.hash.slice(1));
  const paired=await fetch(server.origin+'/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:fragment.get('nubi-a2a'),role:'browser'})});
  const {token}=await paired.json();
  for(const path of ['/a2a','/tasks/a2a']) {
    async function call(body,version='1.0') {
      const headers={'Content-Type':'application/json',Authorization:'Bearer '+token};
      if(version!==null)headers['A2A-Version']=version;
      const response=await fetch(server.origin+path,{method:'POST',headers,body});
      assert.equal(response.status,200);
      return response.json();
    }
    const request={jsonrpc:'2.0',id:'independent-client',method:'ListTasks',params:{}};
    for(const version of ['99.0','',null]) {
      const result=await call(JSON.stringify(request),version);
      assert.equal(result.jsonrpc,'2.0');assert.equal(result.id,request.id);assert.equal(result.error.code,-32009);
    }
    assert.equal((await call(JSON.stringify({...request,method:'UnknownMethod'}))).error.code,-32601);
    const malformed=await call('{');assert.equal(malformed.id,null);assert.equal(malformed.error.code,-32700);
    for(const body of ['null','[]',JSON.stringify({id:request.id,method:'ListTasks'})])assert.equal((await call(body)).error.code,-32600);
    assert.equal((await call(JSON.stringify({...request,params:{tenant:'foreign'}}))).error.code,-32602);
    const valid=await call(JSON.stringify(request));assert.equal(valid.id,request.id);assert.deepEqual(valid.result.tasks,[]);
  }
  assert.deepEqual(records.list('a2a-task:'),[]);assert.deepEqual(records.list('nubi-task:'),[]);
});
