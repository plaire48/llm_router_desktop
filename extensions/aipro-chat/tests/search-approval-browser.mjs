// Real Chrome: which presses ask for approval. Reported by the user: clicks kept
// being held ("초안 검증 필요", a search Enter, 닫기 in a page-wide form), and "a
// click that works matters more than a guard". Only a button named for a final
// action is held: a short caption that ends with the verb (저장, 메일 보내기, 최종
// 반영), in English one that starts with it, and 확인 or OK alone. Save and submit
// shortcuts stay held, and text typed into a field never names an action.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {approvalTarget} from '../browser-approval.js';
const browser=await chromium.launch({executablePath:process.env.CHROME_BINARY,headless:true});
try {
  const page=await browser.newPage();
  const target=(selector,operation={method:'click'})=>page.locator(selector).elementHandle().then(handle=>handle.evaluate(approvalTarget,operation));
  await page.setContent('<form method="post" action="/page.do"><input id="memo" type="text" name="memo" value="삭제"><select name="unit"><option>1팀</option><option>2팀</option></select>'+
    '<button id="close" type="submit">닫기</button><button id="next">다음</button><input id="unnamed" type="submit" value=""><button id="save">저장</button>'+
    '<input id="send" type="submit" value="전송"><button id="ok" type="button">확인</button><button id="lookup" type="button">결과 확인</button><button id="apply" type="button">최종 반영</button>'+
    '<input id="img" type="image" alt="검색" src="data:,"><button id="mail" type="button"><span>메일</span> <span>보내기</span></button></form>'+
    '<a id="navapply" href="#a">교육 신청</a><a id="subject" href="#s">[인사] 2026년 10월 교육 일정 신청 안내</a><a id="board" href="#b">게시판</a>');
  for(const [id,action] of [['#save','저장'],['#send','발송'],['#ok','확인'],['#apply','반영'],['#mail','발송'],['#navapply','신청']])assert.equal((await target(id))?.action,action,id);
  for(const id of ['#close','#next','#unnamed','#lookup','#img','#subject','#board','#memo'])assert.equal(await target(id),null,id);
  console.log('PASS only buttons named for a final action are held; 닫기, 다음, an unnamed submit, a search image, a mail subject and a field value are not');
  assert.equal((await target('#memo',{method:'press',key:'ControlOrMeta+S'})).action,'저장');
  assert.equal((await target('#memo',{method:'press',key:'ControlOrMeta+Enter'})).action,'제출');
  console.log('PASS save and submit shortcuts stay held');
  // Enter in a field submits its form as the first submit button would.
  await page.setContent('<form id="f1"><input id="q1" name="q"><button type="submit">검색</button></form><form id="f2"><input id="t2" name="title"><button type="submit">저장</button><button type="submit">취소</button></form>'+
    '<form id="f3"><input id="t3" name="title"></form><form id="f4" method="post"><input id="t4" name="title"><button type="submit">조회</button></form>');
  assert.equal(await target('#q1',{method:'press',key:'Enter'}),null,'a search Enter');
  assert.equal((await target('#t2',{method:'press',key:'Enter'}))?.action,'저장','Enter in a form whose first submit saves');
  assert.equal(await target('#t3',{method:'press',key:'Enter'}),null,'a form without a submit button');
  assert.equal(await target('#t4',{method:'press',key:'Enter'}),null,'a POST lookup form');
  console.log('PASS Enter in a field is held only when the form\'s first submit button names a final action');
} finally {await browser.close();}
