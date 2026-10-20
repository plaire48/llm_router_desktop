import test from 'node:test';import assert from 'node:assert/strict';import {writeFile,unlink} from 'node:fs/promises';import path from 'node:path';
import {fixture} from './fixtures.mjs';
import {wikiSearchCorpus,rankWikiDocuments} from '../runtime/wiki-search-index.mjs';
const makeDocument=file=>({id:file.path,path:file.path,title:file.path,hash:file.hash,raw:file.content,fields:{}});
test('a 401st Wiki page is already searchable on the current pre-S1 baseline',async t=>{
 const {root,service}=await fixture(t);for(let i=0;i<401;i++)await writeFile(path.join(root,'openwiki',String(i).padStart(3,'0')+'.md'),'# Synthetic background\n\nGeneral notes.');await writeFile(path.join(root,'openwiki/zz-last.md'),'# Last page\n\nQUARTZ_LAST recovery is documented here.');const value=await service.wikiQuery({query:'QUARTZ_LAST'});assert(value.scanned>401);assert(value.results.some(r=>r.path==='openwiki/zz-last.md'));
});
test('incremental index metadata has a bounded body cache and never retains all raw source bodies',async t=>{
 const {root}=await fixture(t),owner={};await writeFile(path.join(root,'openwiki/home.md'),'# Quartz\n\nQUARTZ_71 recovery.');const corpus=await wikiSearchCorpus(owner,root,['openwiki/home.md'],makeDocument);
 assert.equal(corpus.documents[0].raw,undefined);assert.equal(typeof corpus.readDocument,'function');assert.match((await corpus.readDocument(corpus.documents[0])).raw,/QUARTZ_71/);assert(corpus.state.bodyBytes<=8*1024*1024);
 const ranked=rankWikiDocuments(corpus.state,corpus.documents,'QUARTZ_71');assert.equal(ranked.documents.length,1);const repeat=await wikiSearchCorpus(owner,root,['openwiki/home.md'],makeDocument);assert.equal(repeat.loaded,0);assert.equal(repeat.reused,1);
 await unlink(path.join(root,'openwiki/home.md'));assert.equal((await wikiSearchCorpus(owner,root,[],makeDocument)).documents.length,0);assert.equal(rankWikiDocuments(corpus.state,[],'QUARTZ_71').documents.length,0);
});
test('a source after 64MiB is indexed without an aggregate corpus byte cutoff',{timeout:120000},async t=>{
 const {root}=await fixture(t),owner={},paths=[],padding='padding '.repeat(120000);
 for(let i=0;i<71;i++){const rel='openwiki/large-'+String(i).padStart(3,'0')+'.md';paths.push(rel);await writeFile(path.join(root,rel),'# Background\n\n'+padding);}
 const last='openwiki/zz-late.md';paths.push(last);await writeFile(path.join(root,last),'# Final incident\n\nCOBALT_AFTER_64M recovery requires a lease reset.');
 const corpus=await wikiSearchCorpus(owner,root,paths,makeDocument);assert.equal(corpus.skipped,0);assert.equal(corpus.documents.length,72);assert(corpus.bytes>64*1024*1024);assert(rankWikiDocuments(corpus.state,corpus.documents,'COBALT_AFTER_64M').documents.some(d=>d.path===last));assert(corpus.state.bodyBytes<=8*1024*1024);
});

test('Claims statements are indexed incrementally and excluded secret references never enter that index',async t=>{
 const {root}=await fixture(t),owner={};const {mkdir}=await import('node:fs/promises');const {hash}=await import('../runtime/files.mjs');await mkdir(path.join(root,'openwiki/.claims'),{recursive:true});const text='# Operations\n\nA source-bound reference.';await writeFile(path.join(root,'openwiki/home.md'),text);
 const write=async(statement,resource='repo://app.txt')=>writeFile(path.join(root,'openwiki/.claims/home.json'),JSON.stringify({schemaVersion:1,pageVersion:hash(text),claims:[{id:'claim-one',statement,evidence:[{resource,version:'synthetic'}]}]}));
 await write('COBALTCLAIMONLY retry rule.');let corpus=await wikiSearchCorpus(owner,root,['openwiki/home.md'],makeDocument);assert.equal(rankWikiDocuments(corpus.state,corpus.documents,'COBALTCLAIMONLY').documents.length,1);
 await write('QUARTZCLAIMONLY wait rule.');corpus=await wikiSearchCorpus(owner,root,['openwiki/home.md'],makeDocument);assert.equal(rankWikiDocuments(corpus.state,corpus.documents,'COBALTCLAIMONLY').documents.length,0);assert.equal(rankWikiDocuments(corpus.state,corpus.documents,'QUARTZCLAIMONLY').documents.length,1);
 await write('PRIVATECLAIMSENTINEL','repo://.env');corpus=await wikiSearchCorpus(owner,root,['openwiki/home.md'],makeDocument);assert.equal(rankWikiDocuments(corpus.state,corpus.documents,'PRIVATECLAIMSENTINEL').documents.length,0);
});

test('search marks unreviewed Claims separately from matching source versions and preserves it in answer citations',async t=>{
 const {root,service}=await fixture(t),{mkdir}=await import('node:fs/promises'),{hash}=await import('../runtime/files.mjs'),{RepositoryEvidenceResolver}=await import('../generated/openwiki.mjs'),{AnswerSources}=await import('../runtime/answer-sources.mjs');
 const text='# Review rule\n\nCOBALTREVIEWRULE requires a recorded approval.';await writeFile(path.join(root,'openwiki/home.md'),text);await mkdir(path.join(root,'openwiki/.claims'),{recursive:true});const resource='repo://app.txt',version=(await new RepositoryEvidenceResolver({rootDir:root}).resolve(resource)).evidence.version;
 await writeFile(path.join(root,'openwiki/.claims/home.json'),JSON.stringify({schemaVersion:1,pageVersion:hash(text),claims:[{id:'one',statement:'COBALTREVIEWRULE requires a recorded approval.',evidence:[{resource,version}]}]}));
 const result=await service.wikiQuery({query:'COBALTREVIEWRULE'}),row=result.results[0];assert.equal(row.freshness,'source_matched');assert.equal(row.claimVerification.state,'unverified');const observed=new AnswerSources().annotate('wiki_query',result);assert.equal(observed.citations[0].claimVerification.state,'unverified');
});

test('changing ignore rules removes cached Claims terms before the next query',async t=>{
 const {root}=await fixture(t),owner={};const {mkdir}=await import('node:fs/promises'),{hash}=await import('../runtime/files.mjs');const text='# Source\n\nReference.';await writeFile(path.join(root,'openwiki/home.md'),text);await mkdir(path.join(root,'openwiki/.claims'),{recursive:true});await writeFile(path.join(root,'openwiki/.claims/home.json'),JSON.stringify({schemaVersion:1,pageVersion:hash(text),claims:[{id:'one',statement:'IGNOREDCLAIMTOKEN policy.',evidence:[{resource:'repo://app.txt',version:'synthetic'}]}]}));
 let corpus=await wikiSearchCorpus(owner,root,['openwiki/home.md'],makeDocument);assert.equal(rankWikiDocuments(corpus.state,corpus.documents,'IGNOREDCLAIMTOKEN').documents.length,1);
 await writeFile(path.join(root,'.openwikiignore'),'app.txt\n');corpus=await wikiSearchCorpus(owner,root,['openwiki/home.md'],makeDocument);assert.equal(rankWikiDocuments(corpus.state,corpus.documents,'IGNOREDCLAIMTOKEN').documents.length,0);
});

test('a long page cannot crowd a separate supporting document out before the per-page limit',async t=>{
 const {root,service}=await fixture(t);const long='# Recovery\n\n'+Array.from({length:30},(_,i)=>'## Recovery\n\nRecovery procedure '+i+'.').join('\n\n');await writeFile(path.join(root,'openwiki/recovery.md'),long);await writeFile(path.join(root,'openwiki/limits.md'),'# Limits\n\nRecovery requires waiting for 30 seconds.');
 const result=await service.wikiQuery({query:'recovery'});assert(result.results.some(r=>r.path==='openwiki/limits.md'&&r.excerpt.includes('30 seconds')),'support from another page survives the candidate caps');assert(result.results.filter(r=>r.path==='openwiki/recovery.md').length<=2);
});

test('independent candidate reads still coalesce an identical source-version lookup',async t=>{
 const {root,service}=await fixture(t),{mkdir}=await import('node:fs/promises'),{hash}=await import('../runtime/files.mjs'),{RepositoryEvidenceResolver}=await import('../generated/openwiki.mjs');await mkdir(path.join(root,'openwiki/.claims'),{recursive:true});const resource='repo://app.txt',version=(await new RepositoryEvidenceResolver({rootDir:root}).resolve(resource)).evidence.version;
 for(let i=0;i<12;i++){const text='# Shared '+i+'\n\nCOMMONRECOVERY requires approval.';await writeFile(path.join(root,`openwiki/shared-${i}.md`),text);await writeFile(path.join(root,`openwiki/.claims/shared-${i}.json`),JSON.stringify({schemaVersion:1,pageVersion:hash(text),claims:[{id:'one',statement:'COMMONRECOVERY requires approval.',evidence:[{resource,version}]}]}));}
 let calls=0;const original=RepositoryEvidenceResolver.prototype.resolve;RepositoryEvidenceResolver.prototype.resolve=async function(...args){if(args[0]===resource)calls++;return original.apply(this,args);};t.after(()=>{RepositoryEvidenceResolver.prototype.resolve=original;});const result=await service.wikiQuery({query:'COMMONRECOVERY'});assert(result.results.length>2);assert.equal(calls,1,'one observed source version is resolved once even while independent candidates overlap');assert(result.results.every(r=>r.freshness==='source_matched'));
});
