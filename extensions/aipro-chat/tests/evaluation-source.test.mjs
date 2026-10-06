import test from 'node:test';import assert from 'node:assert/strict';
import {evaluationSourceTab} from '../scripts/evaluation-source.mjs';
const input=()=>({targetId:'owned-page-target',pageUrl:'https://www.youtube.com/results?search_query=A%20B',
  targets:[{id:'owned-page-target',type:'page',tabId:22,url:'https://www.youtube.com/results?search_query=A+B'},{id:'old-page',type:'page',tabId:11,url:'https://www.youtube.com/results?search_query=A+B'}],
  tabs:[{id:11,url:'https://www.youtube.com/results?search_query=A+B'},{id:22,url:'https://www.youtube.com/results?search_query=A+B'}],previousTabIds:[11]});
test('actual target identity resolves duplicate URLs and standard query encoding without choosing an older tab',()=>{
 assert.equal(evaluationSourceTab(input()),22);
});
test('source binding rejects closed, reused, changed and ambiguous target identities',()=>{
 for(const patch of [{targetId:'closed-page'},{previousTabIds:[11,22]},{pageUrl:'https://www.youtube.com/results?search_query=other'},
  {targets:[...input().targets,input().targets[0]]},{tabs:[input().tabs[0]]},{pageUrl:'invalid'}])assert.throws(()=>evaluationSourceTab({...input(),...patch}),/evaluation_source_/);
});
