import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeDocumentPreview} from '../runtime/native-document-preview.mjs';
const get=(target,member,args=[],id)=>({target,action:'get',member,args,...(id?{id}:{})});
function observe(pairs){return {steps:pairs.map(p=>p[0]),results:pairs.map(p=>p[1])};}
test('Word observed paragraphs, line spacing and table cells become document blocks with exact before/after text',()=>{
 const o=observe([[get('document','Paragraphs.Item',[1],'p'),{reference:'p'}],[get('p','Range',[],'r'),{reference:'r'}],[get('r','Text'),'검토 초안\r'],[get('r','Font.Size'),20],[get('r','ParagraphFormat.LineSpacing'),24],[get('r','ParagraphFormat.LineSpacingRule'),4],[get('document','Tables.Item',[1],'table'),{reference:'table'}],[get('table','Cell.Range.Text',[1,1]),'담당\r\x07'],[get('table','Cell.Range.Text',[1,2]),'개발팀\r\x07']]);
 const proposal={steps:[{target:'r',action:'set',member:'Text',value:'검토 확정\r'}]};const before=structuredClone(o),p=nativeDocumentPreview('word',o,proposal);
 assert.equal(p.before.blocks[0].text,'검토 초안\r');assert.equal(p.after.blocks[0].text,'검토 확정\r');assert.equal(p.after.blocks[0].style.fontSize,20);assert.equal(p.after.blocks[0].style.lineSpacing,24);assert.deepEqual(p.after.blocks[1].cells.map(c=>c.text),['담당','개발팀']);assert.deepEqual(o,before);assert.equal(p.unmappedChanges,0);
});
test('Word Content plus a read range overlays the change without discarding untouched text',()=>{
 const o=observe([[get('document','Content',[],'body'),{reference:'body'}],[get('body','Text'),'앞 문단\r검토 초안\r보존 문단\r'],[get('document','Range',[5,10],'part'),{reference:'part'}],[get('part','Text'),'검토 초안']]);
 const p=nativeDocumentPreview('word',o,{steps:[{target:'part',action:'set',member:'Text',value:'검토 확정'}]});assert.equal(p.after.blocks.map(b=>b.text).join(''),'앞 문단\r검토 확정\r보존 문단\r');
});
test('PPT preserves actual slide/shape identity, coordinates and notes while previewing a text change',()=>{
 const o=observe([[get('document','PageSetup.SlideWidth'),960],[get('document','PageSetup.SlideHeight'),540],[get('document','Slides.Item',[2],'slide'),{reference:'slide'}],[get('slide','Shapes.Item',[3],'shape'),{reference:'shape'}],[get('shape','Left'),60],[get('shape','Top'),80],[get('shape','Width'),700],[get('shape','Height'),100],[get('shape','TextFrame.TextRange.Text'),'다음 분기 실행 계획'],[get('shape','TextFrame.TextRange.Font.Size'),32],[get('shape','Fill.ForeColor.RGB'),255],[get('slide','NotesPage.Shapes.Item.TextFrame.TextRange.Text',[2]),'발표자 메모 보존']]);
 const p=nativeDocumentPreview('powerpoint',o,{steps:[{target:'shape',action:'set',member:'TextFrame.TextRange.Text',value:'승인된 실행 계획'}]});const s=p.after.slides[0];assert.equal(s.index,2);assert.equal(s.shapes[0].index,3);assert.equal(s.shapes[0].text,'승인된 실행 계획');assert.equal(s.shapes[0].left,60);assert.equal(s.shapes[0].fill,'#ff0000');assert.deepEqual(s.notes,['발표자 메모 보존']);assert.equal(p.before.slides[0].shapes[0].text,'다음 분기 실행 계획');assert.equal(p.after.sizeKnown,true);
});
test('unread shape positions and unknown mutation handles remain disclosed instead of inventing a layout',()=>{
 const o=observe([[get('document','Slides.Item.Shapes.Item.TextFrame.TextRange.Text',[1,1]),'위치 미확인 본문']]);const p=nativeDocumentPreview('powerpoint',o,{steps:[{target:'invented',action:'set',member:'Text',value:'가짜'}]});assert.equal(p.unmappedChanges,1);assert.equal(p.after.sizeKnown,false);assert.equal(p.after.slides[0].shapes[0].positionKnown,false);assert(!JSON.stringify(p).includes('가짜'));
});
test('two slides with equal shape indices stay separate, and notes are never promoted to canvas text',()=>{
 const o=observe([[get('document','Slides.Item.Shapes.Item.TextFrame.TextRange.Text',[1,1]),'첫 슬라이드'],[get('document','Slides.Item.Shapes.Item.TextFrame.TextRange.Text',[2,1]),'둘째 슬라이드'],[get('document','Slides.Item.NotesPage.Shapes.Item.TextFrame.TextRange.Text',[1,2]),'비공개 발표 메모']]);const p=nativeDocumentPreview('powerpoint',o,{steps:[]});assert.equal(p.before.slides.length,2);assert.equal(p.before.slides[1].shapes[0].text,'둘째 슬라이드');assert.deepEqual(p.before.slides[0].notes,['비공개 발표 메모']);assert(!p.before.slides[0].shapes.some(s=>s.text.includes('비공개')));
});
test('large document projections are explicitly bounded without changing the execution proposal',()=>{
 const o=observe([[get('document','Content.Text'),'A'.repeat(60000)]]),proposal={steps:[{action:'call',member:'Unknown'}]},copy=structuredClone(proposal);const p=nativeDocumentPreview('word',o,proposal);assert.equal(p.partial,true);assert(p.after.blocks.reduce((n,b)=>n+(b.text?.length||0),0)<=40000);assert.equal(p.unmappedChanges,1);assert.deepEqual(proposal,copy);
});
test('unsupported observed formatting changes remain disclosed rather than claiming a visual projection',()=>{
 const o=observe([[get('document','Content.Text'),'보존 본문'],[get('document','Content.Font.Outline'),0]]),p=nativeDocumentPreview('word',o,{steps:[{action:'set',member:'Content.Font.Outline',value:-1}]});assert.equal(p.unmappedChanges,1);assert.equal(p.after.blocks[0].text,'보존 본문');
});
test('PPT uses observed z-order and separately flags notes changes, without altering main text',()=>{
 const o=observe([[get('document','Slides.Item.Shapes.Item.ZOrderPosition',[1,1]),2],[get('document','Slides.Item.Shapes.Item.ZOrderPosition',[1,9]),1],[get('document','Slides.Item.NotesPage.Shapes.Item.TextFrame.TextRange.Text',[1,2]),'원본 메모']]);const p=nativeDocumentPreview('powerpoint',o,{steps:[{action:'set',member:'Slides.Item.NotesPage.Shapes.Item.TextFrame.TextRange.Text',args:[1,2],value:'수정 메모'}]});assert.deepEqual(p.after.slides[0].shapes.map(s=>s.index),[9,1]);assert.equal(p.after.slides[0].notesChanged,true);assert.deepEqual(p.after.slides[0].notes,['수정 메모']);
});
