const {randomBytes}=require('node:crypto');

// A one-use loopback page replaces copying a pairing code. Only our isolated
// extension script runs there; no website receives browser or Electron APIs.
class BrowserQuickConnect {
 constructor(host,{resolveProof,url}={}){this.host=host;this.resolveProof=resolveProof;this.url=url;this.ticket=randomBytes(32).toString('hex');}
 address(){return `http://127.0.0.1:${this.host.server.address().port}/nubi-browser-connect/${this.ticket}`;}
 async handle(req,res){
  const base=this.address(),route=new URL(base).pathname;
  const finish=(status,value,type='application/json')=>{res.writeHead(status,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"});res.end(typeof value==='string'?value:JSON.stringify(value));};
  if(req.headers.host!==new URL(base).host||!this.host.ticket||Date.now()>=this.host.expiresAt)return finish(404,{});
  if(req.method==='GET'&&req.url===route){return finish(200,'<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>누비에 브라우저 연결</title><style>body{font:16px system-ui;background:#f1f7fe;color:#191f28;display:grid;place-content:center;min-height:90vh;text-align:center;gap:16px}h1{font-size:24px}p{max-width:32em;line-height:1.7}a{color:#2272eb}</style><h1>누비에 연결하고 있어요</h1><p id="status" role="status">연결 확장을 확인하고 있어요.</p><p>처음 사용한다면 누비에서 연결 확장을 한 번 설치한 뒤 이 페이지를 새로고침하세요.</p><p>이 창은 연결 후 자동으로 닫혀요. 기존 업무 탭은 그대로 유지돼요.</p></html>','text/html');}
  if(req.method==='GET'&&req.url===route+'/config')return finish(200,{code:`ws://127.0.0.1:${this.host.server.address().port}/${this.host.ticket}`,proof:!!this.resolveProof,...(this.url?{url:this.url}:{})});
  if(req.method==='POST'&&req.url===route+'/resolve'&&req.headers.origin===new URL(base).origin&&this.resolveProof){
   try{
    let body='';for await(const bytes of req){body+=bytes;if(body.length>4096)return finish(413,{});}
    const values=JSON.parse(body);if(!Array.isArray(values)||!values.length||values.length>16||!values.every(x=>typeof x==='string'&&/^[a-f0-9-]{36}$/.test(x)))return finish(400,{});
    // The native helper checks HWND, PID, process start and the nonce shown in
    // that exact window. Titles/URLs/bounds are never used to guess a tab.
    const nonce=await this.resolveProof(values);return finish(200,{nonce});
   }catch{return finish(409,{error:'dock_window_mismatch'});}
  }
  return finish(404,{});
 }
}
module.exports={BrowserQuickConnect};
