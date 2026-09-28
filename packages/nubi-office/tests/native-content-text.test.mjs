// Native source contracts only. These do not execute C# or Office COM.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const source=async name=>readFile(new URL(`../native/Nubi.Office.Host/${name}.cs`,import.meta.url),'utf8');

test('native text reads validate source before and after observation, before returning any text (source contract)',async()=>{
  const port=await source('ContentPort');
  const read=port.slice(port.indexOf('private JObject ReadText('),port.indexOf('private JObject Save('));
  assert.match(read,/field!="text"&&field!="notes"/);
  assert.match(read,/offset<0\|\|maxChars<1\|\|maxChars>8000/);
  const pin=read.indexOf('fingerprint!=expectedFingerprint'),observe=read.indexOf('document.ReadText(itemId,field)'),recheck=read.indexOf('document.Fingerprint(document.Items())!=fingerprint'),result=read.indexOf('return new JObject');
  assert.ok(pin>=0&&pin<observe&&observe<recheck&&recheck<result);
  assert.match(read,/item\[field\]\?\.Type!=JTokenType.String/);
  assert.match(read,/item\[field\+"Hash"\]!=null&&\(string\?\)item\[field\+"Hash"\]!=textHash/);
  for(const field of ['scopeId','documentId','fingerprint','itemId','field','offset','text','textLength','textHash','chunkHash','nextOffset','readOnly'])assert.ok(read.includes(`["${field}"]`),field);
  assert.match(read,/text.Substring\(offset,Math.Min\(maxChars,text.Length-offset\)\)/);
  assert.doesNotMatch(read,/\.Text\s*=|\.Select\(|\.Activate\(|\.Save|File\.|Zip|Allowed\.Add|receipts\.Add/);
});

test('long-text native RPC stays on bound Office read routing and busy classification (source contract)',async()=>{
  const [port,pane]=await Promise.all([source('ContentPort'),source('NubiPane')]);
  const dispatch=port.slice(port.indexOf('public JToken Dispatch('),port.indexOf('private JObject ReadText('));
  assert.ok(dispatch.indexOf('if(method=="office_read_text")')<dispatch.indexOf('string operationId='));
  assert.match(dispatch,/ReadText\(Required\("scopeId"\),Required\("expectedFingerprint"\),Required\("itemId"\),Required\("field"\)/);
  assert.match(pane,/method.StartsWith\("office_",StringComparison.Ordinal\)\)result=content.Dispatch\(method,payload\)/);
  assert.match(pane,/bool read =[^;]*method == "office_read_text"/);
  assert.match(pane,/if \(read && error is COMException/);
});

test('Word retains exact paragraph and content-control read anchors and unchanged write limits (source contract)',async()=>{
  const [word,fields]=await Promise.all([source('WordContentDocument'),source('WordContentFields')]);
  const read=word.slice(word.indexOf('public override string ReadText('),word.indexOf('public override void Validate('));
  assert.match(read,/itemId=="p-"\+index/);
  assert.match(read,/index<1\|\|index>paragraphs.Count/);
  assert.match(read,/itemId=="cc-"\+\(string\)control.ID/);
  assert.match(read,/TrimEnd\('\\r','\\a'\)/);
  assert.match(word,/if\(value.Length>4000\)\{item\["textLength"\]=value.Length;item\["textHash"\]=Hash\(value\);\}/);
  assert.match(fields,/if\(value.Length>4000\)item\["textHash"\]=Hash\(value\)/);
  assert.match(word,/value.Length<=4000/);assert.match(fields,/value.Length<=4000/);
  assert.match(word,/return Hash\(xml\)/);
});

test('PPT long notes and text use bounded previews with full hashes and stay read-only (source contract)',async()=>{
  const ppt=await source('SlideContentDocument');
  assert.doesNotMatch(ppt,/if\((?:notes|text).Length>4000\)throw new OfficeFault\("evidence_limit"\)/);
  assert.match(ppt,/notes.Length>4000\?notes.Substring\(0,4000\):notes/);
  assert.match(ppt,/value\["text"\]=text.Length>4000\?text.Substring\(0,4000\):text/);
  assert.match(ppt,/slideItem\["notesHash"\]=Hash\(notes\)/);
  assert.match(ppt,/value\["textHash"\]=Hash\(text\)/);
  assert.match(ppt,/value\["textHash"\]=Hash\(text\);slideItem\["editable"\]=false/);
  assert.match(ppt,/value\["editable"\]=text.Length<=4000&&uniform/);
  assert.match(ppt,/\["editable"\]=notes.Length<=4000&&/);
  assert.match(ppt,/Fingerprint\(List<JObject> items\)=>Hash\(new JArray\(items\)/);
  const runs=ppt.slice(ppt.indexOf('private static JArray RunDetails('),ppt.indexOf('public override List<JObject> Items('));
  assert.match(runs,/previewRemaining=4000/);
  assert.match(runs,/previewLength=Math.Min\(previewRemaining,text.Length\);previewRemaining-=previewLength/);
  assert.match(runs,/text.Substring\(0,previewLength\)/);
  assert.match(runs,/item\["textHash"\]=Hash\(text\)/);
});

test('PPT text retrieval requires exact observed slide or shape IDs and matching field (source contract)',async()=>{
  const ppt=await source('SlideContentDocument');
  const read=ppt.slice(ppt.indexOf('public override string ReadText('),ppt.indexOf('public override void Validate('));
  assert.match(read,/field=="notes"&&itemId==slideId/);
  assert.match(read,/field=="text"&&itemId.StartsWith\(slideId\+"\/h-",StringComparison.Ordinal\)/);
  assert.match(read,/itemId!=slideId\+"\/h-"\+shape.Id\|\|\(int\)shape.HasTextFrame!=-1/);
  assert.doesNotMatch(read,/\.Text\s*=|\.Select\(|\.Activate\(|\.Save|File\.|Zip/);
});

test('long-field support does not silently waive existing native capacity and XML limits (source contract)',async()=>{
  const [word,fields,ppt]=await Promise.all([source('WordContentDocument'),source('WordContentFields'),source('SlideContentDocument')]);
  assert.match(word,/count>2000/);assert.match(word,/count\+items.Count>2000/);assert.match(word,/xml.Length>8000000/);
  assert.match(fields,/count>200/);assert.match(ppt,/count>200/);assert.match(ppt,/items.Count>2000/);
  assert.match(ppt,/items.Add\(slideItem\);if\(items.Count>2000\)throw new OfficeFault\("evidence_limit"\)/);
});

test('whole-slide replacement respects the long-source readonly guard even in created drafts (source contract)',async()=>{
  const ppt=await source('SlideContentDocument');
  const update=ppt.slice(ppt.indexOf('}else if(type=="set_slide_content"){'),ppt.indexOf('}else throw new OfficeFault("unsupported_operation")'));
  assert.match(update,/!Created\|\|!before.Any/);
  assert.match(update,/\(string\?\)i\["kind"\]=="slide"&&\(bool\?\)i\["editable"\]==true/);
});

test('native hash format and note extraction match the worker long-field contract (source contract)',async()=>{
  const [port,ppt]=await Promise.all([source('ContentPort'),source('SlideContentDocument')]);
  assert.match(port,/SHA256.Create\(\)/);assert.match(port,/Encoding.UTF8.GetBytes\(value\)/);
  assert.match(port,/Replace\("-",""\).ToLowerInvariant\(\)/);
  assert.match(ppt,/notes=Notes\(slide,com\)/);
  assert.match(ppt,/field=="notes"&&itemId==slideId\)return Notes\(slide,com\)/);
  assert.match(ppt,/slideItem\["truncated"\]=true;slideItem\["notesTruncated"\]=true;slideItem\["notesLength"\]=notes.Length/);
  assert.doesNotMatch(ppt,/slideItem\["textLength"\]/);
});
