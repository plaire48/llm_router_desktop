import test from 'node:test';import assert from 'node:assert/strict';
let casesApi={},hostApi={};try{casesApi=await import('../eval/dual-business-cases.mjs');}catch{}try{hostApi=await import('../eval/dual-cli-host.mjs');}catch{}
test('new business oracles distinguish pending, quarantined and still-open work',()=>{
 assert.equal(typeof casesApi.expected,'function');
 const m={id:'maintenance',datasets:{jobs:[{site:'A',state:'승인',qty:2,price:10,hours:3,rate:4},{site:'A',state:'보류',qty:1,price:10,hours:2,rate:4}],settings:[{vat:.1,reserve:.12,budget:100}]}};
 assert.deepEqual(casesApi.expected(m),{material:20,labor:12,approved:32,vat:2,reserve:3.84,total:37.84,gap:62.16,pending:18});
 const s={id:'support',datasets:{tickets:[{queue:'A',state:'완료',elapsed:60,target:60,fee:100,creditRate:.1,work:20,remaining:0},{queue:'A',state:'진행',elapsed:61,target:60,fee:80,creditRate:.1,work:0,remaining:30}],capacity:[{queue:'A',people:1,minutes:40}]}};
 assert.deepEqual(casesApi.expected(s),{closed:1,met:1,breached:0,sla:1,credit:0,potential:8,work:50,capacity:40,gap:-10});
});
test('the comparison source contains three new complex cases without business templates',()=>{
 assert.equal(casesApi.cases?.length,3);assert.deepEqual(casesApi.cases.map(c=>c.id),['maintenance','inventory','support']);
 assert.ok(casesApi.cases.every(c=>c.fictional&&JSON.stringify(c).length<50000));
});
test('both CLI responses use the same value-only envelope and reject unadvertised actions',()=>{
 assert.equal(typeof hostApi.decodeEnvelope,'function');const tools=[{type:'function',function:{name:'read_sources',parameters:{type:'object',properties:{}}}}];
 assert.equal(hostApi.decodeEnvelope({content:'',calls:[{name:'read_sources',arguments:'{}'}]},tools).calls[0].function.name,'read_sources');
 assert.throws(()=>hostApi.decodeEnvelope({content:'',calls:[{name:'exec',arguments:'{}'}]},tools));
 assert.throws(()=>hostApi.decodeEnvelope({content:'',calls:[{name:'read_sources',arguments:'[]'}]},tools));
});
