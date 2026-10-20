import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeMap, summarizeBaseline} from '../eval/wiki-scale/metrics.mjs';
import {PUBLIC_REPOSITORIES} from '../eval/wiki-scale/sources.mjs';

test('code baseline counts unsupported source and parse failures rather than hiding them in coverage',()=>{
  const map={summary:{files:4,ranked:1},files:{
    'x.ts':{language:'typescript',definitions:[{name:'one'}],imports:[],parseError:false},
    'x.cpp':{language:null,definitions:[],imports:[],parseError:false},
    'big.ts':{language:'typescript',unavailable:'file_too_large',definitions:[],imports:[]},
    'broken.js':{language:'javascript',parseError:true,definitions:[],imports:[]},
  }};
  assert.deepEqual(summarizeMap(map),{...map.summary,supportedLanguageFiles:3,unsupportedLanguageFiles:1,
    parsedAvailableFiles:1,definitions:1,unavailableReasons:{file_too_large:1},parseErrorFiles:1});
});
test('deterministic baseline never labels absent model or answer metrics as zero or passed',()=>{
  const row=summarizeBaseline({inventory:{paths:['a'],truncated:false},map:{summary:{files:1},files:{a:{language:null}}},mapMs:30,peakRssBytes:100});
  assert.equal(row.modelInitialization.status,'not_measured');
  assert.equal(row.answerQuality.recallAt5,null);
  assert.equal(row.answerQuality.citationAccuracy,null);
  assert.equal(row.releaseAccepted,false);
});
test('three OSS inputs are pinned commits, distinct size targets and public-only repositories',()=>{
  const repos=PUBLIC_REPOSITORIES;
  assert.deepEqual(repos.map(r=>r.tier),['small','medium','large']);
  for(const r of repos){
    assert.match(r.repository,/^(vuejs\/core|nodejs\/node|llvm\/llvm-project)$/);
    assert.match(r.commit,/^[a-f0-9]{40}$/);
    assert.equal(r.sourceUrl,`https://github.com/${r.repository}/tree/${r.commit}`);
    assert(r.subtrees.every(p=>!p.includes('..')));
  }
});
