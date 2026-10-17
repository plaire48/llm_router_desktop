// Recheck original evidence and preserve readable synthetic outputs.
// This does not automatically judge semantic entailment.
import {mkdir,readFile,writeFile,cp} from 'node:fs/promises';
import path from 'node:path';
import {RepositoryEvidenceResolver,OpenWikiIgnore} from '../generated/openwiki.mjs';
import {git} from '../runtime/files.mjs';
const out=path.resolve('verification/code-wiki-map-2026-10-16');
const report=JSON.parse(await readFile(path.join(out,'report.json'),'utf8'));
const results=[];
for(const row of report.results){
  const slug=row.variant+'-'+(row.attempt||1);
  if(!/^(baseline|candidate)-[1-9][0-9]*$/.test(slug))throw Error('invalid_variant');
  const summary={id:slug,state:row.state,error:row.error||null,elapsedMs:row.elapsedMs,modelCalls:row.modelCalls,reads:row.reads,bodyCharacters:0,quickstartCharacters:0,claims:0,references:0,invalidEvidence:[],sourceChanges:[]};
  if(row.state==='completed'){
    const destination=path.join(out,slug);await mkdir(path.join(destination,'openwiki'),{recursive:true});
    for(const page of row.pages){
      if(!['quickstart.md','architecture.md','index.md'].includes(page.path))throw Error('unexpected_page');
      await writeFile(path.join(destination,'openwiki',page.path),page.text);
      const body=page.text.replace(/^---[\s\S]*?\n---\n/,'');
      if(page.path!=='index.md')summary.bodyCharacters+=body.length;
      if(page.path==='quickstart.md')summary.quickstartCharacters=body.length;
    }
    for(const rel of ['src','test','package.json','README.md','AGENTS.md','.github'])await cp(path.join(row.workspace,rel),path.join(destination,rel),{recursive:true}).catch(error=>{if(error.code!=='ENOENT')throw error;});
    summary.sourceChanges=(await git(row.workspace,['diff','--name-only','HEAD','--','src','test','package.json'])).trim().split('\n').filter(Boolean);
    const resolver=new RepositoryEvidenceResolver({rootDir:row.workspace,openWikiIgnore:await OpenWikiIgnore.load(row.workspace)});
    for(const file of row.claimFiles)for(const claim of file.value.claims){
      summary.claims++;
      for(const evidence of claim.evidence){
        summary.references++;
        try{const resolved=await resolver.resolve(evidence.resource,evidence.version);if(resolved?.evidence.version!==evidence.version)summary.invalidEvidence.push({page:file.path,resource:evidence.resource,reason:'version_mismatch'});}
        catch{summary.invalidEvidence.push({page:file.path,resource:evidence.resource,reason:'unresolvable'});}
      }
    }
  }
  results.push(summary);
}
await writeFile(path.join(out,'audit.json'),JSON.stringify({scope:'Deterministic evidence/version and source-preservation checks, not factual entailment. Failed generations stay in the denominator.',model:report.model,results},null,2)+'\n');
console.log(JSON.stringify(results));
