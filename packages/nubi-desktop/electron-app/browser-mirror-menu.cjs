async function mirrorMenu({mirror,args,Menu,clipboard,parent,onSettings=()=>{},onError=()=>{},openPage}){
 const {context}=await mirror.input({...args,input:{...args.input,kind:'context'}});
 if(!context||context.siteHandled)return {siteMenu:true};
 const invoke=input=>void mirror.input({...args,input}).then(result=>{if(typeof result.text==='string')clipboard.writeText(result.text);},onError);
 const items=[];
 if(context.editable)items.push({label:'잘라내기',click:()=>invoke({kind:'command',command:'cut'})});
 items.push({label:'복사',click:()=>invoke({kind:'command',command:'copy'})});
 if(context.editable)items.push({label:'붙여넣기',click:()=>invoke({kind:'text',text:clipboard.readText().slice(0,100000)})});
 items.push({label:'전체 선택',click:()=>invoke({kind:'command',command:'selectAll'})});
 let link;try{const url=new URL(context.link);if(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password)link=url.href;}catch{}
 if(link)items.push({type:'separator'},{label:'새 탭에서 링크 열기',click:()=>void openPage(link).catch(onError)},{label:'링크 주소 복사',click:()=>clipboard.writeText(link)});
 items.push({type:'separator'},{label:'브라우저 연결 설정',click:onSettings});
 const options={window:parent};
 if(Number.isFinite(args.menuX)&&Number.isFinite(args.menuY)){const [width,height]=parent.getContentSize();options.x=Math.round(Math.max(0,Math.min(width,args.menuX)));options.y=Math.round(Math.max(0,Math.min(height,args.menuY)));}
 Menu.buildFromTemplate(items).popup(options);return {opened:true};
}
module.exports={mirrorMenu};
