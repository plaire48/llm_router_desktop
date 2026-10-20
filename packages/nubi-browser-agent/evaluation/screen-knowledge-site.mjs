import {createServer} from 'node:http';

export async function startScreenKnowledgeSite(){
 let changed=false;const html=body=>`<!doctype html><html lang="ko"><meta charset="utf-8"><title>Screen knowledge fixture</title><body>${body}</body></html>`;
 const server=createServer((req,res)=>{
  res.setHeader('content-type','text/html; charset=utf-8');res.setHeader('cache-control','no-store');
  const path=new URL(req.url,'http://fixture.invalid').pathname;
  if(path==='/search')return res.end(html(`<main><h1>자료 검색</h1><form aria-label="검색 조건"><label>검색어<input name="query" value="CURRENT_QUERY_DO_NOT_STORE"></label><label>분류<select><option>전체</option><option>문서</option></select></label><button type="button">조회</button></form><table><caption>검색 결과</caption><tr><th>번호</th><th>제목</th></tr><tr><td>10</td><td>현재 자료</td></tr></table></main>`));
  if(path==='/compose')return res.end(html('<main><h1>자료 작성</h1><iframe name="editor" src="/editor"></iframe><a href="/search">목록</a></main>'));
  if(path==='/editor')return res.end(html(`<form aria-label="작성 양식"><table><tr><td>${changed?'전달 대상':'대상'}</td><td><input name="target" value="CURRENT_TARGET_DO_NOT_STORE"></td></tr><tr><td>내용</td><td><div contenteditable="true" style="min-height:50px;border:1px solid">CURRENT_BODY_DO_NOT_STORE</div></td></tr></table><div onclick="void 0" tabindex="0">임시 저장</div></form>`));
  if(path==='/detail')return res.end(html('<main><h1>요청 상세</h1><section aria-label="기본 정보"><p>상태: 검토 중</p></section><button>편집</button><a href="/search">돌아가기</a></main>'));
  res.writeHead(404);res.end(html('<h1>없음</h1>'));
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 return {origin:'http://127.0.0.1:'+server.address().port,change:()=>{changed=true;},close:()=>new Promise(resolve=>server.close(resolve))};
}
