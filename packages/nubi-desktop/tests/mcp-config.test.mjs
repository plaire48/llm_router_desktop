import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMcpConfig,idFor} from '../ui/mcp-config.mjs';

test('configs pasted from other apps become ready-to-save servers with secrets kept apart',()=>{
  const servers=parseMcpConfig({mcpServers:{
    'GitHub Tools':{command:'npx',args:['-y','@modelcontextprotocol/server-github'],env:{GITHUB_TOKEN:'ghp_x',lower:'skip'}},
    company:{url:'https://mcp.company.local/mcp',headers:{Authorization:'Bearer abc'}},
    off:{command:'node',args:['x.js'],disabled:true},
    broken:{note:'no command'}
  }});
  assert.deepEqual(servers.map(server=>[server.id,server.transport,server.enabled]),[['github-tools','stdio',true],['company','http',true],['off','stdio',false]]);
  assert.deepEqual(servers[0].envKeys,['GITHUB_TOKEN']);assert.deepEqual(servers[0].secrets,{GITHUB_TOKEN:'ghp_x'});assert.deepEqual(servers[0].args,['-y','@modelcontextprotocol/server-github']);
  assert.deepEqual(servers[1].headerKeys,['Authorization']);assert.deepEqual(servers[1].secrets,{Authorization:'Bearer abc'});
  assert.equal(parseMcpConfig({command:'node',args:['a.js'],name:'one'})[0].id,'one');
  assert.equal(parseMcpConfig({servers:{a1:{url:'http://x/mcp'}}})[0].transport,'http');
  assert.deepEqual(parseMcpConfig(null),[]);assert.equal(idFor('사내 도구'),'');assert.equal(idFor('My Server 2'),'my-server-2');
  assert.equal(parseMcpConfig({mcpServers:{'사내 도구':{command:'node'}}})[0].id,'server-1','names without latin letters get a numbered id');
});
