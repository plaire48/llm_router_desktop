// Picture content controls (document forms Task J5, 2026-10-21): a photo or signature box takes an image file the user
// names in the Workspace. The image is added to the copy as a new media part, fitted inside the control's box.
import test from 'node:test';
import assert from 'node:assert/strict';
import {deflateSync,crc32} from 'node:zlib';
import JSZip from 'jszip';
import {applyDocxOperations,createDocxWriter,verifyDocxCopy} from '../runtime/docx-apply.mjs';
import {extractFormMap,docxSnapshot} from '../runtime/docx-snapshot.mjs';
import {applyFill,createLedger} from '../generated/office-forms.mjs';
import {docxFromBlocks} from './helpers-docx-fixture.mjs';

// A real PNG of the given size, one grey pixel row repeated.
function png(width,height){
  const chunk=(type,data)=>{const len=Buffer.alloc(4);len.writeUInt32BE(data.length);const body=Buffer.concat([Buffer.from(type),data]),crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(body)>>>0);return Buffer.concat([len,body,crc]);};
  const head=Buffer.alloc(13);head.writeUInt32BE(width,0);head.writeUInt32BE(height,4);head[8]=8;head[9]=0;
  const rows=Buffer.concat(Array.from({length:height},()=>Buffer.concat([Buffer.from([0]),Buffer.alloc(width,0x80)])));
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',head),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}
const label=text=>({text,bold:true});
const form=()=>docxFromBlocks([{p:{text:'이력서',style:'Title'}},{table:{rows:[[label('성명'),'']]}},{control:{type:'picture',title:'사진',placeholder:true,bytes:png(10,10),image:{cx:1440000,cy:1800000}}}]);

test('a picture control is an image slot and the named file goes in, fitted to the box',async()=>{
  const source=await form(),{map,items}=await extractFormMap(source);
  const photo=map.slots.find(slot=>slot.kind==='field');assert.deepEqual([photo.label,photo.valueType],['사진','image']);
  const files=new Map([['사진/증명.png',png(300,400)]]);
  const writer=await createDocxWriter(source,{resolveImage:async path=>files.get(path)??null});
  const run=await applyFill({map,sheet:{cells:[{slot:map.slots[0].id,value:'김민수'},{slot:photo.id,value:'사진/증명.png'}],rows:[],sections:[]},read:writer.read,apply:writer.apply,ledger:createLedger(items,map)});
  assert.ok(run.done,JSON.stringify(run));assert.equal(run.operations.length,2,JSON.stringify(run));
  const copy=await writer.bytes(),zip=await JSZip.loadAsync(copy),xml=await zip.file('word/document.xml').async('string');
  const embed=/<w:picture\/>[\s\S]*?r:embed="([^"]+)"/.exec(xml)[1],rels=await zip.file('word/_rels/document.xml.rels').async('string');
  const target=new RegExp(`Id="${embed}"[^>]*Target="(media/[^"]+)"`).exec(rels)?.[1]??new RegExp(`Target="(media/[^"]+)"[^>]*Id="${embed}"`).exec(rels)?.[1];
  assert.ok(target&&/^media\/nubi-image-\d+\.png$/.test(target),rels);
  assert.deepEqual(await zip.file('word/'+target).async('nodebuffer'),files.get('사진/증명.png'));
  assert.match(await zip.file('[Content_Types].xml').async('string'),/Extension="png"/);
  assert.match(xml,/<wp:extent cx="1350000" cy="1800000"\/>/,'3:4 inside a 4:5 box keeps its proportions');
  assert.doesNotMatch(xml,/showingPlcHdr/);
  const field=(await docxSnapshot(copy)).items.find(item=>item.kind==='field');assert.equal(field.showingPlaceholder,false);
  const verify=await verifyDocxCopy(source,copy,{targets:map.slots.map(slot=>slot.target)});
  assert.equal(verify.sameEntries,true,JSON.stringify(verify.changedEntries));assert.deepEqual(verify.violations,[]);
});

test('only a real PNG or JPEG from the resolver is placed',async()=>{
  const source=await form();
  await assert.rejects(applyDocxOperations(source,[{type:'fill_picture',targetId:'f-1',path:'x.png'}]),/invalid_plan/,'no resolver, no image');
  const writer=await createDocxWriter(source,{resolveImage:async()=>Buffer.from('not an image')});
  await assert.rejects(writer.apply({type:'fill_picture',targetId:'f-1',path:'x.png'}),/invalid_plan/);
});
