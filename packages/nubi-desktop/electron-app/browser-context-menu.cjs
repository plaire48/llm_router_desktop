// Native context menus target the clicked web contents, not the app renderer.
function browserContextMenu(wc,params,{openLink,copyLink}){
 const groups=[],edit=params.editFlags||{};
 if(params.isEditable)groups.push([
  {label:'실행 취소',enabled:!!edit.canUndo,click:()=>wc.undo()},
  {label:'다시 실행',enabled:!!edit.canRedo,click:()=>wc.redo()},
 ]);
 const selection=[];
 if(params.isEditable)selection.push({label:'잘라내기',enabled:!!edit.canCut,click:()=>wc.cut()});
 if(params.selectionText||params.isEditable)selection.push({label:'복사',enabled:!!edit.canCopy,click:()=>wc.copy()});
 if(params.isEditable)selection.push({label:'붙여넣기',enabled:!!edit.canPaste,click:()=>wc.paste()});
 if(selection.length)groups.push(selection);
 let link;try{const url=new URL(params.linkURL);if(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password)link=url.href;}catch{}
 if(link)groups.push([{label:'새 탭에서 링크 열기',click:()=>openLink(link)},{label:'링크 주소 복사',click:()=>copyLink(link)}]);
 if(params.mediaType==='image'&&params.hasImageContents)groups.push([{label:'이미지 복사',click:()=>wc.copyImageAt(params.x,params.y)}]);
 groups.push([{label:'전체 선택',enabled:edit.canSelectAll!==false,click:()=>wc.selectAll()}]);
 groups.push([
  {label:'뒤로',enabled:wc.navigationHistory.canGoBack(),click:()=>wc.navigationHistory.goBack()},
  {label:'앞으로',enabled:wc.navigationHistory.canGoForward(),click:()=>wc.navigationHistory.goForward()},
  {label:'새로고침',click:()=>wc.reload()},
 ]);
 return groups.flatMap((items,i)=>i?[{type:'separator'},...items]:items);
}
module.exports={browserContextMenu};
