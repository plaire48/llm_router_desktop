import test from 'node:test';
import assert from 'node:assert/strict';
import {answerReveal} from '../../../extensions/aipro-chat/src/answer-reveal.js';
const text=value=>({type:'text',value});
const element=(tagName,...children)=>({type:'element',tagName,children});
const content=node=>node.type==='text'?node.value:(node.children||[]).map(content).join('');
const pieces=node=>[...(node.properties?.className?.includes('nubi-answer-piece')?[node]:[]),...(node.children||[]).flatMap(pieces)];
test('reveals sanitized text in reading order without breaking graphemes or code/citation content',()=>{
  const original='한글 👨‍👩‍👧‍👦 e\u0301 문장을 부드럽게 보여줍니다. '.repeat(8);
  const code=element('pre',element('code',text('console.log("test");'))),link=element('a',text('출처 1'));
  const tree=element('div',element('p',text(original),element('strong',text('핵심 결론'))),code,link);
  const before=content(tree);answerReveal()(tree);
  assert.equal(content(tree),before);assert.equal(pieces(code).length,1);assert.equal(pieces(code.children[0]).length,0);assert.equal(pieces(link).length,1);
  const spans=pieces(tree);assert(spans.length>1&&spans.length<=160);
  const delays=spans.map(n=>Number(n.properties.style.match(/:(\d+)/)[1]));
  assert.equal(delays[0],0);assert(delays.at(-1)<=800);
  assert(delays.every((v,i)=>!i||v>=delays[i-1]));
  for(const span of spans){const value=content(span);assert(!/^[\uDC00-\uDFFF\u200D\u0301]|[\uD800-\uDBFF\u200D]$/.test(value));}
});
test('large answers stay immediate and ordinary answers have bounded extra nodes',()=>{
  const tree=element('div',...Array.from({length:60},()=>element('p',text('긴 답변 '.repeat(30)))));
  answerReveal()(tree);assert(pieces(tree).length<=160);
  const huge=element('div',text('a'.repeat(20001)));answerReveal()(huge);assert.equal(pieces(huge).length,0);
});
