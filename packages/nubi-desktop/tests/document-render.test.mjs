import {removeLater} from './helpers-cleanup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile,realpath} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {findSoffice,renderDocumentPages,renderBeforeAfter} from '../runtime/document-render.mjs';
import {docxFromBlocks,FORMS} from './helpers-docx-fixture.mjs';

// Document forms plan Task E: without LibreOffice the render is unavailable and nothing else changes; with it (this
// Mac, test use only) a synthetic form renders to one PNG page per page.
const PNG=Buffer.from([137,80,78,71,13,10,26,10]);

test('without soffice the render is reported unavailable, and a bad argument is refused',async t=>{
  const dir=await realpath(await mkdtemp(path.join(os.tmpdir(),'nubi-render-')));removeLater(dir);
  const file=path.join(dir,'양식.docx');await writeFile(file,await docxFromBlocks(FORMS.gianmun));
  assert.deepEqual(await renderDocumentPages(file,{outDir:path.join(dir,'out'),soffice:false}),{status:'unavailable',reason:'soffice_missing',engine:null,pages:[],pageCount:0});
  assert.equal(await findSoffice({soffice:false}),null);
  assert.deepEqual((await renderDocumentPages(path.join(dir,'양식.txt'),{outDir:path.join(dir,'out2'),soffice:'/bin/sh'})).reason,'format_unsupported');
  await assert.rejects(renderDocumentPages('',{outDir:dir}),/render_arguments_invalid/);
});

test('with soffice a synthetic form renders to PNG pages beside a PDF, before and after',async t=>{
  const soffice=await findSoffice();
  if(!soffice){t.diagnostic('soffice not installed here: render path not exercised');return;}
  const dir=await realpath(await mkdtemp(path.join(os.tmpdir(),'nubi-render-')));removeLater(dir);
  const source=path.join(dir,'출장.docx'),copy=path.join(dir,'출장-작성.docx');
  await writeFile(source,await docxFromBlocks(FORMS.trip));await writeFile(copy,await docxFromBlocks(FORMS.gianmun));
  const {before,after}=await renderBeforeAfter({source,copy,outDir:path.join(dir,'renders'),soffice,timeoutMs:180000});
  for(const [name,result] of [['before',before],['after',after]]){
    assert.equal(result.status,'rendered',name+': '+JSON.stringify(result));
    assert.ok(result.pageCount>=1&&result.pages.length>=1&&result.pages.length<=result.pageCount);
    assert.equal(result.pages[0].path,path.join(dir,'renders',name,'page-1.png'));
    const bytes=await readFile(result.pages[0].path);assert.ok(bytes.length>1000&&bytes.subarray(0,8).equals(PNG),name+' is a PNG');
    assert.ok((await readFile(result.pdf)).subarray(0,4).toString()==='%PDF');
  }
});

test('on macOS a Korean form renders with a Korean system font, not missing-glyph boxes',async t=>{
  if(process.platform!=='darwin'||!await findSoffice()){t.diagnostic('macOS with LibreOffice only');return;}
  const dir=await realpath(await mkdtemp(path.join(os.tmpdir(),'nubi-render-')));removeLater(dir);
  const file=path.join(dir,'한글.docx');await writeFile(file,await docxFromBlocks([{p:{runs:[{text:'한글 글꼴 확인',font:'맑은 고딕'}]}}]));
  const result=await renderDocumentPages(file,{outDir:path.join(dir,'out'),maxPages:1});
  assert.equal(result.status,'rendered');
  const fonts=[...new Set((await readFile(result.pdf)).toString('latin1').match(/\/BaseFont\s*\/[A-Za-z0-9+_-]+/g)??[])].join(' ');
  assert.match(fonts,/AppleGothic|AppleSDGothic|AppleMyungjo|Nanum|NotoSansCJK|NotoSansKR/,'a Korean font is embedded: '+fonts);
});
