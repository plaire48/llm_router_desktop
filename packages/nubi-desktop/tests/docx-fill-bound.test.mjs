// Controls bound to XML (document forms Task J8, 2026-10-21): ContentControl.XMLMapping. Word shows a bound control
// from its custom XML part (or the document properties) when it opens the file, so the value is written there too.
import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {createDocxWriter,verifyDocxCopy} from '../runtime/docx-apply.mjs';
import {extractFormMap,docxSnapshot} from '../runtime/docx-snapshot.mjs';
import {applyFill,createLedger} from '../generated/office-forms.mjs';
import {docxFromBlocks} from './helpers-docx-fixture.mjs';

const STORE='{8A1B6F0E-1C2D-4E5F-9A0B-1C2D3E4F5A6B}',CORE='{6C3C8BC8-F283-45AE-878A-BAB7291924A1}';
async function boundForm(){
  const source=await docxFromBlocks([{p:{text:'신청서',style:'Title'}},{control:{type:'text',title:'성명',text:'이름'}},{control:{type:'checkbox',title:'동의'}}],{header:[{control:{type:'text',title:'제목',text:'제목'}}]});
  const zip=await JSZip.loadAsync(source);
  let xml=await zip.file('word/document.xml').async('string');
  const bind=(xpath,store,maps='')=>`<w:dataBinding${maps?` w:prefixMappings="${maps}"`:''} w:xpath="${xpath}" w:storeItemID="${store}"/>`;
  xml=xml.replace('<w:text/>',bind('/ns0:form[1]/ns0:name[1]',STORE,"xmlns:ns0='urn:nubi:form'")+'<w:text/>').replace('<w14:checkbox>',bind('/ns0:form[1]/ns0:agree[1]',STORE,"xmlns:ns0='urn:nubi:form'")+'<w14:checkbox>');
  zip.file('word/document.xml',xml);
  let header=await zip.file('word/header1.xml').async('string');
  header=header.replace('<w:text/>',bind("/ns1:coreProperties[1]/ns0:title[1]",CORE,"xmlns:ns0='http://purl.org/dc/elements/1.1/' xmlns:ns1='http://schemas.openxmlformats.org/package/2006/metadata/core-properties'")+'<w:text/>');
  zip.file('word/header1.xml',header);
  zip.file('customXml/item1.xml','<?xml version="1.0" encoding="UTF-8"?><f:form xmlns:f="urn:nubi:form"><f:name>이름</f:name><f:agree>false</f:agree></f:form>');
  zip.file('customXml/itemProps1.xml',`<?xml version="1.0" encoding="UTF-8"?><ds:datastoreItem ds:itemID="${STORE}" xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml"><ds:schemaRefs/></ds:datastoreItem>`);
  zip.file('docProps/core.xml','<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>제목</dc:title></cp:coreProperties>');
  return zip.generateAsync({type:'nodebuffer'});
}

test('bound controls are writable when their XML node is found, and the node takes the value',async()=>{
  const source=await boundForm(),{map,items}=await extractFormMap(source);
  const fields=items.filter(item=>item.kind==='field');
  assert.deepEqual(fields.map(f=>[f.id,f.mapped,f.writable]),[['f-1',true,true],['f-2',true,true],['header1:f-1',true,true]]);
  assert.deepEqual(map.slots.map(slot=>slot.label),['성명','동의','머리글 제목']);
  const sheet={cells:[{slot:map.slots[0].id,value:'김민수'},{slot:map.slots[1].id,value:'예'},{slot:map.slots[2].id,value:'출장 신청'}],rows:[],sections:[]};
  const writer=await createDocxWriter(source),run=await applyFill({map,sheet,read:writer.read,apply:writer.apply,ledger:createLedger(items,map)});
  assert.ok(run.done,JSON.stringify(run));assert.equal(run.operations.length,3,JSON.stringify(run));
  const copy=await writer.bytes(),zip=await JSZip.loadAsync(copy);
  assert.match(await zip.file('customXml/item1.xml').async('string'),/<f:name>김민수<\/f:name><f:agree>true<\/f:agree>/);
  assert.match(await zip.file('docProps/core.xml').async('string'),/<dc:title>출장 신청<\/dc:title>/);
  const after=(await docxSnapshot(copy)).items.filter(item=>item.kind==='field');
  assert.deepEqual(after.map(f=>f.checked??f.text),['김민수',true,'출장 신청']);
  const verify=await verifyDocxCopy(source,copy,{targets:map.slots.map(slot=>slot.target)});
  assert.equal(verify.sameEntries,true,JSON.stringify(verify.changedEntries));assert.deepEqual(verify.violations,[]);
});
