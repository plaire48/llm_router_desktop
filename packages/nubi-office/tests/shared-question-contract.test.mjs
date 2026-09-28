import './ui-source-loader.mjs';
import test,{after,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
const dom=new JSDOM('<!doctype html><html lang="ko"><body></body></html>',{url:'https://office.test',pretendToBeVisual:true});
for(const name of ['window','document','navigator','HTMLElement','Element','Node','MutationObserver','getComputedStyle'])Object.defineProperty(globalThis,name,{configurable:true,value:dom.window[name]});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const React=await import('react');
const {render,screen,fireEvent,waitFor,cleanup}=await import('@testing-library/react');
const {OfficeQuestion}=await import('../src/OfficeQuestion.jsx');
afterEach(cleanup);after(()=>dom.window.close());
const question={id:'q',text:'작성할 부서를 알려주세요.',kind:'choice',options:[{id:'sales',label:'영업팀'}],inputLimit:10000};

test('Office choice questions accept a visible free-text alternative without a mode switch',async()=>{
  const answers=[],drafts=[];
  render(React.createElement(OfficeQuestion,{question,onDraft:async value=>drafts.push(value),onChoose:async value=>{answers.push(value);return true;}}));
  const input=screen.getByRole('textbox',{name:'직접 답변'});
  assert.equal(input.placeholder,'선택지에 없다면 직접 적어주세요.');
  assert.ok(screen.getByRole('button',{name:/영업팀/}));
  assert.equal(screen.queryByRole('button',{name:'직접 답변 입력'}),null);
  fireEvent.change(input,{target:{value:'연구개발팀'}});
  fireEvent.click(screen.getByRole('button',{name:'답변 보내기'}));
  await waitFor(()=>assert.deepEqual(answers,[{questionId:'q',text:'연구개발팀'}]));
  assert.deepEqual(drafts,['연구개발팀']);
});

test('Office choice submission preserves its exact option ID and answered state hides editable controls',async()=>{
  const answers=[];
  const props={question,onDraft:async()=>{},onChoose:async value=>{answers.push(value);return true;}};
  const view=render(React.createElement(OfficeQuestion,props));
  fireEvent.click(screen.getByRole('button',{name:/영업팀/}));
  await waitFor(()=>assert.deepEqual(answers,[{questionId:'q',optionId:'sales'}]));
  view.rerender(React.createElement(OfficeQuestion,{...props,question:{...question,answer:{optionId:'sales'}}}));
  assert.equal(screen.queryByRole('textbox',{name:'직접 답변'}),null);
  assert.equal(screen.queryByRole('button',{name:/영업팀/}),null);
});

test('Office answers grow from one editable textarea without a manual resize control',async()=>{
  render(React.createElement(OfficeQuestion,{question,onDraft:async()=>{},onChoose:async()=>true}));
  const input=screen.getByRole('textbox',{name:'직접 답변'});
  assert.equal(input.tagName,'TEXTAREA');assert.equal(input.getAttribute('rows'),'1');
  fireEvent.change(input,{target:{value:'연구개발팀'}});
  assert.equal(screen.getByRole('textbox',{name:'직접 답변'}),input);
  assert.equal(input.value,'연구개발팀');
  assert.equal(screen.queryByRole('button',{name:'길게 작성하기'}),null);
});

test('answer guidance stays inside the field and no send-key helper appears below it',()=>{
  const guidance='필요한 내용을 입력하세요.';
  render(React.createElement(OfficeQuestion,{question:{...question,kind:'text',options:[],inputPlaceholder:guidance},onDraft:async()=>{},onChoose:async()=>true}));
  const input=screen.getByRole('textbox',{name:'직접 답변'});
  assert.equal(input.placeholder,guidance);
  assert.equal(screen.queryByText(guidance),null);
  assert.equal(screen.queryByText(/Enter로 전송/),null);
  assert.equal(screen.getByRole('button',{name:'답변 보내기'}).title,'답변 보내기');
});

test('long Office drafts reveal a larger view without changing the answer or sending it',async()=>{
  const proto=dom.window.HTMLTextAreaElement.prototype;
  Object.defineProperty(proto,'scrollHeight',{configurable:true,get(){return this.value.length>100?400:44;}});
  const answers=[];
  try {
    render(React.createElement(OfficeQuestion,{question:{...question,kind:'text',options:[],inputMode:'long_text'},onDraft:async()=>{},onChoose:async answer=>{answers.push(answer);return true;}}));
    const field=screen.getByRole('textbox',{name:'직접 답변'});
    const value='긴 답변의 핵심 내용 '.repeat(15);
    fireEvent.change(field,{target:{value}});
    const more=await screen.findByRole('button',{name:'더 보기'});
    assert.equal(more.getAttribute('aria-expanded'),'false');
    assert.equal(field.style.height,'176px');
    fireEvent.click(more);
    assert.equal(screen.getByRole('button',{name:'접기'}).getAttribute('aria-expanded'),'true');
    assert.equal(field.style.height,'400px');
    assert.equal(field.value,value);assert.deepEqual(answers,[]);
    fireEvent.click(screen.getByRole('button',{name:'접기'}));
    assert.equal(field.style.height,'176px');
  } finally {delete proto.scrollHeight;}
});

test('answer label remains visible while typing and long answers do not request a short response',()=>{
  render(React.createElement(OfficeQuestion,{question:{...question,kind:'text',options:[],inputMode:'long_text'},onDraft:async()=>{},onChoose:async()=>true}));
  const field=screen.getByRole('textbox',{name:'직접 답변'});
  assert.ok(document.querySelector(`label[for="${field.id}"]`));
  assert.doesNotMatch(field.placeholder,/짧게/);
  fireEvent.change(field,{target:{value:'현황과 조건'}});
  assert.ok(document.querySelector(`label[for="${field.id}"]`).textContent.includes('답변'));
});
test('over-limit paste preserves the prior answer and explains the limit without silent clipping',async()=>{
  const drafts=[];
  render(React.createElement(OfficeQuestion,{question:{...question,inputLimit:12,draft:'원래 답변'},onDraft:async value=>drafts.push(value),onChoose:async()=>true}));
  const field=screen.getByRole('textbox',{name:'직접 답변'});field.setSelectionRange(field.value.length,field.value.length);
  fireEvent.paste(field,{clipboardData:{getData:()=> '\n너무 긴 문장과 중요한 꼬리말'}});
  assert.equal(field.value,'원래 답변');assert.deepEqual(drafts,[]);
  const error=await screen.findByRole('alert');assert.match(error.textContent,/12자/);assert.match(error.textContent,/유지/);
  assert.ok(field.getAttribute('aria-describedby').split(' ').includes(error.id));
});
test('Office submission errors are linked to the field and clear when the answer is corrected',async()=>{
  render(React.createElement(OfficeQuestion,{question,onDraft:async()=>{},onChoose:async()=>{throw new Error('input_context_limit');}}));
  const field=screen.getByRole('textbox',{name:'직접 답변'});
  fireEvent.change(field,{target:{value:'작성 내용'}});fireEvent.click(screen.getByRole('button',{name:'답변 보내기'}));
  const error=await screen.findByRole('alert');assert.ok(field.getAttribute('aria-describedby').split(' ').includes(error.id));assert.equal(field.getAttribute('aria-invalid'),'true');
  assert.equal(field.value,'작성 내용');fireEvent.change(field,{target:{value:'수정한 내용'}});
  assert.equal(screen.queryByRole('alert'),null);assert.notEqual(field.getAttribute('aria-invalid'),'true');
});

test('multiline paste within the limit retains every character and sends only with explicit submit',async()=>{
  const answers=[],drafts=[];
  render(React.createElement(OfficeQuestion,{question:{...question,inputLimit:40,draft:'앞뒤'},onDraft:async text=>drafts.push(text),onChoose:async answer=>{answers.push(answer);return true;}}));
  const field=screen.getByRole('textbox',{name:'직접 답변'});field.setSelectionRange(1,1);
  fireEvent.paste(field,{clipboardData:{getData:()=> '첫줄\n둘째줄'}});
  const multiline=await screen.findByRole('textbox',{name:'직접 답변'});
  assert.equal(multiline.tagName,'TEXTAREA');assert.equal(multiline.value,'앞첫줄\n둘째줄뒤');
  fireEvent.keyDown(multiline,{key:'Enter',isComposing:true,keyCode:229});fireEvent.keyDown(multiline,{key:'Enter'});assert.deepEqual(answers,[]);
  fireEvent.keyDown(multiline,{key:'Enter',ctrlKey:true});
  await waitFor(()=>assert.equal(answers.length,1));assert.equal(answers[0].text,'앞첫줄\n둘째줄뒤');assert.deepEqual(drafts,['앞첫줄\n둘째줄뒤']);
});

test('choice-only dialogs retain a valid error description even without a text field',async()=>{
  const {QuestionForm}=await import('../../../extensions/aipro-chat/src/QuestionForm.jsx');
  render(React.createElement(QuestionForm,{question,allowText:false,onDraft:async()=>{},onChoose:async()=>false}));
  fireEvent.click(screen.getByRole('button',{name:/영업팀/}));
  await screen.findByRole('alert');const group=screen.getByRole('group');
  assert.ok(document.getElementById(group.getAttribute('aria-describedby'))?.querySelector('[role="alert"]'));
  assert.equal(screen.queryByRole('textbox'),null);
});
