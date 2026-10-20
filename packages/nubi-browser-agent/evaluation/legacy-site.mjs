import {createServer} from 'node:http';

/** Deliberately poor semantics. The runner controls state through this closure, not an actor API. */
export async function startLegacySite({saveDelayMs=0}={}){
  let saved=null,bodyLabel='본문',saveCount=0;
  const html=body=>`<!doctype html><html lang="ko"><meta charset="utf-8"><title>복합 웹 시험</title><body>${body}</body></html>`;
  const server=createServer(async(req,res)=>{
    const url=new URL(req.url,'http://fixture.invalid');
    res.setHeader('content-type','text/html; charset=utf-8');res.setHeader('cache-control','no-store');
    if(req.method==='POST'&&url.pathname==='/save'){
      let raw='';for await(const part of req){raw+=part;if(raw.length>20_000){res.writeHead(413).end();return;}}
      const input=new URLSearchParams(raw);saved={recipient:input.get('recipient'),body:input.get('body')};saveCount++;if(saveDelayMs)await new Promise(resolve=>setTimeout(resolve,saveDelayMs));res.end(html('<h1>저장 완료</h1>'));return;
    }
    if(url.pathname==='/')return res.end(html(`<h1>업무 화면</h1><iframe name="outer" src="/outer"></iframe><button onclick="window.open('/address','directory','width=480,height=320')">주소록 열기</button><button onclick="document.querySelector('iframe').contentWindow.location.reload()">하위 화면 새로고침</button><button onclick="document.querySelector('iframe').src='/outer?new=1'">프레임 교체</button><a href="/saved">저장된 내용 보기</a>`));
    if(url.pathname==='/outer')return res.end(html(`<table><tr><td>업무 구분</td><td><select><option>일반</option><option>중요</option></select></td></tr></table><iframe name="editor" src="${url.searchParams.has('cross')?'http://localhost:'+server.address().port:''}/editor"></iframe>`));
    if(url.pathname==='/editor')return res.end(html(`<form method="post" action="/save"><table><tr><td>수신자 주소</td><td><input name="recipient" autocomplete="off"></td></tr><tr><td>${bodyLabel}</td><td><div id="area"></div><input name="body" type="hidden"></td></tr></table><div onclick="document.forms[0].requestSubmit()" tabindex="0">저장</div></form><input type="password" tabindex="0" aria-label="보호 입력" autocomplete="current-password"><script>setTimeout(()=>{const editor=document.createElement('div');editor.contentEditable='true';editor.style.cssText='min-height:100px;border:1px solid #aaa';editor.addEventListener('input',()=>{document.querySelector('[name=body]').value=editor.innerText});document.querySelector('#area').append(editor)},180)</script>`));
    if(url.pathname==='/address')return res.end(html('<h1>주소록</h1><table><tr><td>민수</td><td>minsu.sales@example.invalid</td><td><button>선택</button></td></tr><tr><td>민수</td><td>minsu.ops@example.invalid</td><td><button>선택</button></td></tr></table>'));
    if(url.pathname==='/saved')return res.end(html(saved?`<h1>저장된 내용</h1><pre>${JSON.stringify(saved).replace(/&/g,'&amp;').replace(/</g,'&lt;')}</pre>`:'<p>저장된 내용 없음</p>'));
    res.writeHead(404);res.end(html('<h1>화면 없음</h1>'));
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return {origin:`http://127.0.0.1:${server.address().port}`,snapshot:()=>structuredClone(saved),saveCount:()=>saveCount,reset:(options={})=>{saved=null;saveCount=0;bodyLabel=options.changed?'업무 내용':'본문';},close:()=>new Promise(resolve=>server.close(resolve))};
}
