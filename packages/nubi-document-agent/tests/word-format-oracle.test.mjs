import test from 'node:test';import assert from 'node:assert/strict';import{existsSync}from'node:fs';
const path=new URL('../eval/word-format-oracle.mjs',import.meta.url),api=existsSync(path)?await import(path):{};
const paragraph=color=>({'w:p':{'w:pPr':{'w:pStyle':{'@_w:val':'ReviewCallout'}},'w:r':{'w:rPr':{'w:color':{'@_w:val':color}},'w:t':{'#text':'변경 대상 1','@_xml:space':'preserve'}}}});
test('Word format oracle reads preserved-space text and checks the actual direct run color',()=>{
 assert.equal(typeof api.hasDirectTextColor,'function');assert.equal(api.hasDirectTextColor(paragraph('3182F6'),'변경 대상 1','3182F6'),true);assert.equal(api.hasDirectTextColor(paragraph('000000'),'변경 대상 1','3182F6'),false);
 assert.equal(api.hasDirectTextColor(paragraph('3182F6'),'없는 문구','3182F6'),false);
 assert.equal(api.hasDirectTextColor([paragraph('3182F6'),paragraph('3182F6')],'변경 대상 1','3182F6'),false);
});
