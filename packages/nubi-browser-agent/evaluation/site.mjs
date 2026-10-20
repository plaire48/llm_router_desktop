import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {issues,mails} from './workflows.mjs';

const escape=value=>String(value??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const field=(label,name,value='',type='text')=>`<label>${label}<input name="${name}" type="${type}" value="${escape(value)}"></label>`;
const shell=(title,body)=>`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><style>body{font:16px/1.6 system-ui,sans-serif;color:#191F28;background:#F1F7FE;margin:0}main{max-width:900px;margin:32px auto;padding:24px;background:white;border-radius:16px}nav{display:flex;gap:20px}a{color:#1B64DA}label{display:block;margin:12px 0}input,select,textarea,button{font:inherit;padding:8px;border:1px solid #E5E8EB;border-radius:8px}input,textarea{box-sizing:border-box;width:100%}textarea{min-height:180px}button{background:#3182F6;color:white;cursor:pointer}td,th{text-align:left;padding:10px}table{width:100%}small{color:#4E5968}</style><main><small>누비 브라우저 시험 환경 — 합성 데이터</small><nav><a href="/jsm">JSM</a><a href="/mail">메일</a><a href="/compose">메일 쓰기</a><a href="/drafts">임시보관함</a></nav><h1>${escape(title)}</h1>${body}</main></html>`;

/** Each trial creates a fresh server. No production service, account or SMTP is used. */
export async function startWorkflowSite() {
  const sessions=new Set(),drafts=new Map(),reads=new Set();
  let origin;
  const server=createServer(async(req,res)=>{
    const url=new URL(req.url,'http://fixture.invalid');
    const reply=(status,body)=>{res.writeHead(status,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",'x-content-type-options':'nosniff'});res.end(body);};
    const redirect=path=>{res.writeHead(303,{location:path,'cache-control':'no-store'});res.end();};
    try {
      if(req.headers.host!==new URL(origin).host)return reply(403,'Local fixture host required');
      if(req.method==='POST'&&req.headers.origin!==origin)return reply(403,'Same-origin form required');
      const body=async()=>{
        let value='';for await(const chunk of req){value+=chunk;if(Buffer.byteLength(value)>24_000)throw Error('body_too_large');}
        return new URLSearchParams(value);
      };
      const back=()=>{const next=url.searchParams.get('next')??'/jsm';return next.startsWith('/')&&!next.startsWith('//')&&!next.includes('\\')?next:'/jsm';};
      if(url.pathname==='/login'){
        if(req.method==='POST'){
          const session=randomUUID();sessions.add(session);res.setHeader('set-cookie',`nubi_fixture=${session}; HttpOnly; SameSite=Strict; Path=/`);return redirect(back());
        }
        return reply(200,shell('사용자 로그인 필요',`<p>실제 SSO가 아닌 시험용 사용자 개입 화면입니다. 비밀번호를 입력하지 않습니다.</p><form method="post" action="/login?next=${encodeURIComponent(back())}"><button>시험 사용자로 계속</button></form>`));
      }
      const session=req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('nubi_fixture='))?.slice('nubi_fixture='.length);
      if(!sessions.has(session))return redirect('/login?next='+encodeURIComponent(url.pathname+url.search));
      if(req.method==='GET'&&url.pathname==='/')return redirect('/jsm');
      if(req.method==='GET'&&url.pathname==='/jsm'){
        const q=url.searchParams;
        const matched=issues.filter(x=>(!q.get('type')||x.type===q.get('type'))&&(!q.get('status')||x.status===q.get('status'))&&(!q.get('from')||x.date>=q.get('from'))&&(!q.get('to')||x.date<=q.get('to')));
        const page=Math.max(1,Math.min(100,Number(q.get('page'))||1)),rows=matched.slice((page-1)*2,page*2);
        const option=(name,values)=>`<label>${name==='type'?'유형':'상태'}<select name="${name}"><option value="">전체</option>${values.map(x=>`<option${q.get(name)===x?' selected':''}>${escape(x)}</option>`).join('')}</select></label>`;
        const next=new URLSearchParams(q);next.set('page',String(page+1));
        return reply(200,shell('변경 이슈 검색',`<form>${option('type',['변경','장애'])}${option('status',['진행 중','완료'])}${field('시작일','from',q.get('from'),'date')}${field('종료일','to',q.get('to'),'date')}<button>검색</button></form><p>총 ${matched.length}건 / ${page}페이지</p><table><thead><tr><th>ID</th><th>제목</th><th>상태</th><th>예정일</th></tr></thead><tbody>${rows.map(x=>`<tr><td><a href="/jsm/${x.id}">${x.id}</a></td><td>${escape(x.title)}</td><td>${x.status}</td><td>${x.date}</td></tr>`).join('')}</tbody></table>${page*2<matched.length?`<a href="/jsm?${escape(next)}">다음 페이지</a>`:''}`));
      }
      const issue=issues.find(x=>'/jsm/'+x.id===url.pathname);
      if(req.method==='GET'&&issue){reads.add(issue.id);return reply(200,shell(issue.id+' '+issue.title,`<dl>${[['유형',issue.type],['상태',issue.status],['담당자',issue.owner],['작업 일정',issue.window],['영향',issue.impact],['복구 방법',issue.rollback]].map(([k,v])=>`<dt>${k}</dt><dd>${escape(v)}</dd>`).join('')}</dl>`));}
      if(req.method==='GET'&&url.pathname==='/mail'){
        const q=url.searchParams.get('q')??'',matched=mails.filter(x=>JSON.stringify(x).includes(q));
        return reply(200,shell('메일 검색',`<form>${field('검색어','q',q)}<button>메일 검색</button></form><table><thead><tr><th>제목</th><th>보낸 사람</th><th>날짜</th></tr></thead><tbody>${matched.map(x=>`<tr><td><a href="/mail/${x.id}">${escape(x.subject)}</a></td><td>${escape(x.from)}</td><td>${x.date}</td></tr>`).join('')}</tbody></table>`));
      }
      const mail=mails.find(x=>'/mail/'+x.id===url.pathname);
      if(req.method==='GET'&&mail){reads.add(mail.id);return reply(200,shell(mail.subject,`<p>메일 ID: ${mail.id}</p><p>보낸 사람: ${escape(mail.from)}</p><p>날짜: ${mail.date}</p><article>${escape(mail.body)}</article><p><a href="/compose?replyTo=${mail.id}">회신 작성</a></p>`));}
      if(req.method==='GET'&&url.pathname==='/compose'){
        const original=mails.find(x=>x.id===url.searchParams.get('replyTo'));
        return reply(200,shell(original?'회신 초안':'새 메일 초안',`<form method="post" action="/drafts"><input type="hidden" name="replyTo" value="${original?.id??''}">${field('받는 사람','to',original?.from.match(/<([^>]+)>/)?.[1]??'')}${field('참조','cc')}${field('숨은 참조','bcc')}${field('제목','subject',original?'Re: '+original.subject:'')}<label>본문<textarea name="body"></textarea></label><button>초안 저장</button></form><p>이 시험 환경은 메일을 전송하지 않습니다.</p>`));
      }
      if(req.method==='POST'&&url.pathname==='/drafts'){
        const input=await body(),draft={id:randomUUID(),to:input.get('to')??'',cc:input.get('cc')??'',bcc:input.get('bcc')??'',subject:input.get('subject')??'',body:input.get('body')??'',replyTo:input.get('replyTo')||null};
        if(!draft.to.trim()||!draft.subject.trim()||!draft.body.trim()||(draft.replyTo&&!mails.some(x=>x.id===draft.replyTo)))return reply(400,shell('초안 확인 필요','받는 사람, 제목, 본문과 회신 대상을 확인해 주세요.'));
        drafts.set(draft.id,draft);return redirect('/drafts/'+draft.id);
      }
      if(req.method==='GET'&&url.pathname==='/drafts')return reply(200,shell('임시보관함',`<ul>${[...drafts.values()].map(x=>`<li><a href="/drafts/${x.id}">${escape(x.subject)}</a></li>`).join('')}</ul>`));
      const draft=[...drafts.values()].find(x=>'/drafts/'+x.id===url.pathname);
      if(req.method==='GET'&&draft)return reply(200,shell('초안 저장 완료',`<p>초안 ID: ${draft.id}</p><p>받는 사람: ${escape(draft.to)}</p><p>참조: ${escape(draft.cc)}</p><p>숨은 참조: ${escape(draft.bcc)}</p><p>회신 대상: ${escape(draft.replyTo??'새 메일')}</p><h2>${escape(draft.subject)}</h2><article>${escape(draft.body)}</article><p>전송하지 않은 초안입니다.</p>`));
      return reply(404,shell('화면 없음','요청한 화면을 찾을 수 없습니다.'));
    } catch {return reply(400,shell('요청 확인 필요','시험 요청을 처리하지 못했습니다.'));}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  origin=`http://127.0.0.1:${server.address().port}`;
  return {origin,snapshot:()=>structuredClone({reads:[...reads],drafts:[...drafts.values()],sentCount:0}),expireSessions:()=>sessions.clear(),close:()=>new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()))};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const site=await startWorkflowSite();console.log(JSON.stringify({fixtureUrl:site.origin,syntheticOnly:true,realSSO:false,realMailSend:false}));
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await site.close();process.exit(0);});
}
