// Hot-loadable evaluator diagnostics. Only public, explicitly allowed Naver surfaces.
export async function run({command,get,config,emit}){
 const state=await get('naver'),u=new URL(state.page.url());if(!config.naver.hosts.includes(u.hostname))return emit({event:'public_scope_blocked'});
 if(command.action==='results-audit'){return emit({event:'result_nodes',links:await state.page.locator('#main_pack a').evaluateAll(xs=>xs.filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0;}).slice(0,24).map(el=>({text:(el.innerText??'').trim().slice(0,140),class:el.className,url:(()=>{try{const u=new URL(el.href);return u.origin+u.pathname;}catch{return '';}})(),children:Array.from(el.children).slice(0,4).map(n=>({tag:n.tagName,class:n.className}))})))});}
 if(command.action==='native-probe'){const start=performance.now();await state.page.getByRole('combobox',{name:'검색어를 입력해 주세요.',exact:true}).fill('Playwright 공식 문서');await state.page.getByRole('combobox',{name:'검색어를 입력해 주세요.',exact:true}).press('Enter');await state.page.waitForLoadState('domcontentloaded');(arguments[0].report.preflight??=[]).push({service:'naver',kind:'native-ui-probe',elapsedMs:performance.now()-start,countsAsModelTrial:false});await arguments[0].persist();command.action='audit';}
 if(command.action==='audit'){
  const structure=await state.page.locator('form,input,textarea,button').evaluateAll(xs=>xs.filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0;}).map(el=>({tag:el.tagName,type:el.type,role:el.getAttribute('role'),name:(el.getAttribute('aria-label')||el.getAttribute('title')||el.value||el.textContent||'').trim().slice(0,100),form:!!el.closest('form'),class:typeof el.className==='string'?el.className:''})).slice(0,25));
  const frames=state.page.frames().map(frame=>{try{const u=new URL(frame.url());return {host:u.hostname,path:u.pathname};}catch{return {host:'opaque'};}});
  const classes=await state.page.locator('a').evaluateAll(xs=>xs.filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&/title|tit|headline/.test(el.className);}).slice(0,20).map(el=>({class:el.className,title:el.textContent.trim().replace(/\s+/g,' ').slice(0,150)})));
  return emit({event:'naver_public_audit',host:u.hostname,path:u.pathname,query:u.searchParams.get('query'),structure,frames,classes});
 }
 throw Error('unknown_extension_action');
}
