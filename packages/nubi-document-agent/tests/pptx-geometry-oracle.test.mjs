import test from 'node:test';import assert from 'node:assert/strict';import{existsSync}from'node:fs';
const path=new URL('../eval/pptx-geometry-oracle.mjs',import.meta.url),api=existsSync(path)?await import(path):{};
const shapes=()=>['요청 접수','검토','완료'].map((text,i)=>({'p:nvSpPr':{'a:extLst':{'a:ext':{'@_uri':'creation-metadata'}}},'p:spPr':{'a:xfrm':{'a:off':{'@_x':String(1000+i*3000),'@_y':'1000'},'a:ext':{'@_cx':'2000','@_cy':'1000'}},'a:prstGeom':{'@_prst':'roundRect'}},'p:txBody':{'a:p':{'a:r':{'a:t':text}}}}));
test('geometry oracle reads CT_Transform2D extents rather than creation metadata with the same XML tag',()=>{
 assert.equal(typeof api.inspectFlowGeometry,'function');const check=api.inspectFlowGeometry({'p:sp':shapes()},['요청 접수','검토','완료']);assert.ok(Object.values(check).every(Boolean));
});
test('geometry oracle rejects unequal gaps, different widths, wrong order and missing transforms',()=>{
 assert.equal(typeof api.inspectFlowGeometry,'function');
 for(const mutate of [s=>s[2]['p:spPr']['a:xfrm']['a:off']['@_x']='8000',s=>s[2]['p:spPr']['a:xfrm']['a:ext']['@_cx']='3000',s=>s.reverse().forEach((x,i)=>x['p:spPr']['a:xfrm']['a:off']['@_x']=String(1000+i*3000)),s=>delete s[0]['p:spPr']['a:xfrm']]){const s=shapes();mutate(s);assert.ok(Object.values(api.inspectFlowGeometry({'p:sp':s},['요청 접수','검토','완료'])).some(v=>!v));}
});
