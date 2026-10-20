import test from'node:test';import assert from'node:assert/strict';
let api={};try{api=await import('../eval/dual-table-oracle.mjs');}catch{}
test('facility grouped totals are checked against approved rows and pending costs stay separate',()=>{
 assert.equal(typeof api.inspectGroupedTables,'function');const c={id:'maintenance',datasets:{jobs:[{site:'A',category:'전기',state:'승인',qty:2,price:10,hours:3,rate:4},{site:'A',category:'전기',state:'보류',qty:1,price:10,hours:2,rate:4}],settings:[{vat:.1,reserve:.12,budget:100}]}};
 const t=[{headers:['건물','승인 직접비','보류 직접비'],rows:[['A','32','18']]}];assert.equal(api.inspectGroupedTables(c,t).passed,true);t[0].rows[0][1]='50';assert.equal(api.inspectGroupedTables(c,t).passed,false);
});
test('percentage cells use displayed percentage units in SLA group checks',()=>{
 const c={id:'support',datasets:{tickets:[{queue:'A',state:'완료',elapsed:20,target:30,fee:10,creditRate:.1,work:10,remaining:0},{queue:'A',state:'완료',elapsed:40,target:30,fee:10,creditRate:.1,work:10,remaining:0}],capacity:[{queue:'A',people:1,minutes:15}]}};
 const t=[{headers:['큐','완료','준수율','보상예정액','여유시간'],rows:[['A','2','50%','1','-5']]}];assert.equal(api.inspectGroupedTables(c,t).checkedCells,4);assert.equal(api.inspectGroupedTables(c,t).passed,true);t[0].rows[0][2]='100%';assert.equal(api.inspectGroupedTables(c,t).passed,false);
});
test('inventory tables scoped by an explicit slide heading are not compared with all warehouses',()=>{
 const c={id:'inventory',datasets:{stock:[{warehouse:'중앙',sku:'필터',opening:2,target:5,unitCost:4},{warehouse:'동부',sku:'필터',opening:10,target:5,unitCost:4}],movements:[]}};
 const tables=[{part:'ppt/slides/slide1.xml',headers:['품목','보충금액','평가액'],rows:[['필터','12','8']]}],parts=[{name:'ppt/slides/slide1.xml',text:'중앙 창고 | 재고 확인 품목 필터 보충금액 12 평가액 8'}];
 assert.equal(api.inspectGroupedTables(c,tables,parts).passed,true);tables[0].rows[0][2]='40';assert.equal(api.inspectGroupedTables(c,tables,parts).passed,false);
 parts[0].text='전체 품목 집계';tables[0].rows[0]=['필터','12','48'];assert.equal(api.inspectGroupedTables(c,tables,parts).passed,true);
 parts[0].text='중앙 상세와 조치';tables[0].headers[0]='중앙 품목';tables[0].rows[0]=['필터','12','8'];assert.equal(api.inspectGroupedTables(c,tables,parts).passed,true);
});
