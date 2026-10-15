import test from 'node:test';
import assert from 'node:assert/strict';
import {browserContextMenu} from '../electron-app/browser-context-menu.cjs';
import {workspacePageUrl} from '../runtime/workspace-browser.mjs';
const fixture=params=>{
 const calls=[],wc={navigationHistory:{canGoBack:()=>false,canGoForward:()=>true,goBack(){},goForward(){}}};
 for(const action of ['undo','redo','cut','copy','paste','selectAll','reload','copyImageAt'])wc[action]=(...args)=>calls.push([action,...args]);
 return {calls,items:browserContextMenu(wc,params,{openLink:url=>calls.push(['open',url]),copyLink:url=>calls.push(['link',url])})};
};
test('context copy and paste target the clicked contents and respect edit flags',()=>{
 const {items,calls}=fixture({isEditable:true,selectionText:'선택',editFlags:{canCopy:true,canPaste:true,canCut:false}});
 items.find(item=>item.label==='복사').click();items.find(item=>item.label==='붙여넣기').click();
 assert.deepEqual(calls,[['copy'],['paste']]);assert.equal(items.find(item=>item.label==='잘라내기').enabled,false);
});
test('context links open in-app and executable or credential URLs are excluded',()=>{
 const {items,calls}=fixture({linkURL:'https://example.com/path'});items.find(item=>item.label==='새 탭에서 링크 열기').click();assert.deepEqual(calls,[['open','https://example.com/path']]);
 for(const linkURL of ['javascript:alert(1)','file:///tmp/test','https://user:pass@example.com'])assert(!fixture({linkURL}).items.some(item=>item.label==='새 탭에서 링크 열기'));
 assert(!fixture({isEditable:true,editFlags:{canCopy:false}}).items.find(item=>item.label==='복사').enabled);
});
test('agent and browser accept local server addresses without turning them into search',()=>{
 for(const [value,want] of [['localhost:5173','http://localhost:5173/'],['127.0.0.1:3000/a','http://127.0.0.1:3000/a'],['http://0.0.0.0:8000','http://127.0.0.1:8000/'],['[::]:8080','http://127.0.0.1:8080/'],[' HTTPS://example.com/a ','https://example.com/a']])assert.equal(workspacePageUrl(value),want);
 for(const value of ['file:///tmp/index.html','javascript:alert(1)','https://user:pass@example.com','not a URL'])assert.throws(()=>workspacePageUrl(value),/browser_url_invalid/);
});
