// A simulated Windows app behind the command contract of the app control
// adapter. It holds one window with controls, values and states, applies an
// input the way the app definition says, and records every input it received.
// No window exists and no input reaches this computer. The product code under
// test is the real adapter: only the command runner is replaced.
//
// Since 2026-09-30 it also answers the mouse and keyboard commands: a real click
// (a plain click also does what an invoke does), double and right click, hover,
// drag onto a control, UIA scroll and the wheel on a list that scrolls, bringing
// a control into view, keys and typed text with keyboard focus. Rules name the
// input they answer: an action such as invoke, pointer_double_click, hover or
// drag (with `to`), or a key such as key:enter. A key reaches the focused
// control and then its parents, the way a window passes a key up.
//
// Limits of the simulation: a capture is a drawing of the controls with their
// labels and values (eval/app-render.py), not the look of a real app. Where
// the drawing tool is missing a capture is a plain picture and `images` says
// so. Timing and custom-drawn controls are not simulated. Typed text goes to the
// end of the value, or replaces it after ctrl+a; there is no caret otherwise.
import {writeFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PNG} from 'pngjs';

const RENDERER=path.join(path.dirname(fileURLToPath(import.meta.url)),'app-render.py');
// Draws with the helper. Resolves false when the helper or its font is missing.
const draw=spec=>new Promise(resolve=>{
  const child=execFile('python3',[RENDERER],{timeout:15000,windowsHide:true},error=>resolve(!error));
  child.on('error',()=>resolve(false));child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(spec));
});

const NATIVE={'invoke':'invoke','select':'select','toggle-on':'toggle_on','toggle-off':'toggle_off','expand':'expand','collapse':'collapse'};
const INSPECT_DEPTH=5,ROW=36,WHEEL_ROWS=3;
const INVOKABLE=['Button','ListItem','CheckBox','MenuItem','Hyperlink'];
// Controls that take keyboard focus, in tree order, for Tab.
const FOCUSABLE=new Set(['Edit','Document','Button','CheckBox','ComboBox','ListItem','List','DataItem','MenuItem','Hyperlink','Custom','TreeItem']);
const TEXT=new Set(['Edit','Document','ComboBox']);
const text=(value,max)=>typeof value==='string'&&value.length>0&&value.length<=max;
const selector=value=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,299}$/.test(value);
const failure=(message,code=2)=>Object.assign(new Error(message),{code});

export function validateApp(app){
  const problems=[],need=(ok,problem)=>{if(!ok)problems.push(problem);};
  if(!app||typeof app!=='object')return ['app_not_object'];
  const window=app.window||{};
  need(Number.isSafeInteger(window.hwnd)&&window.hwnd>0,'window.hwnd');need(Number.isSafeInteger(window.processId),'window.processId');
  need(text(window.processName,100),'window.processName');need(text(window.title,300),'window.title');
  const seen=new Set();
  const walk=(controls,at)=>{
    need(Array.isArray(controls),at);
    for(const [index,control] of (Array.isArray(controls)?controls:[]).entries()){
      const here=`${at}[${index}]`;
      need(selector(control?.selector)&&!seen.has(control.selector),here+'.selector');seen.add(control?.selector);
      need(typeof control?.name==='string'&&control.name.length<=500,here+'.name');need(text(control?.type,60),here+'.type');
      need(control.value===undefined||typeof control.value==='string'&&control.value.length<=4000,here+'.value');
      need(control.toggle===undefined||['On','Off','Indeterminate'].includes(control.toggle),here+'.toggle');
      need(control.selected===undefined||['True','False'].includes(control.selected),here+'.selected');
      need(control.expansion===undefined||['Expanded','Collapsed'].includes(control.expansion),here+'.expansion');
      for(const key of ['password','readOnly','offscreen'])need(control[key]===undefined||typeof control[key]==='boolean',here+'.'+key);
      // A list that scrolls shows `visible` of its items; its items hold no children of their own.
      need(control.scroll===undefined||Number.isSafeInteger(control.scroll?.visible)&&control.scroll.visible>=1&&control.scroll.visible<=100&&Array.isArray(control.children)&&control.children.every(child=>!child.children),here+'.scroll');
      if(control.children)walk(control.children,here+'.children');
    }
  };
  walk(app.controls,'controls');
  for(const [index,rule] of (app.rules||[]).entries()){
    need(seen.has(rule?.on?.selector),`rules[${index}].on.selector`);need(text(rule?.on?.action,40),`rules[${index}].on.action`);
    need(rule?.on?.to===undefined||seen.has(rule.on.to)&&rule.on.action==='drag',`rules[${index}].on.to`);
    need((rule.set||[]).every(item=>seen.has(item?.selector)),`rules[${index}].set`);
    need(rule.record===undefined||text(rule.record,60),`rules[${index}].record`);
  }
  return problems;
}

export function createAppHost(definition,{render=draw}={}){
  const problems=validateApp(definition);
  if(problems.length)throw Object.assign(new Error('app_invalid'),{details:{problems}});
  const app=structuredClone(definition),window={dpi:96,width:900,height:700,...app.window};
  const controls=new Map(),parents=new Map(),commands=[],inputs=[],events=[];let row=0,images='drawn',focused=null;
  // The items of a list that scrolls take the rows of its window; the ones outside it are off the screen.
  const layout=list=>{const {offset,visible}=list.scroll;list.children.forEach((item,index)=>{const at=index-offset;item.offscreen=at<0||at>=visible;item.y=item.offscreen?-1000:20+ROW*(list.top+at);});};
  const place=(list,parent,depth)=>{for(const control of list){
    controls.set(control.selector,control);parents.set(control.selector,parent);control.depth=depth;
    Object.assign(control,{x:20+depth*16,y:20+ROW*row++,width:control.width||320,height:control.height||28});
    if(control.scroll){
      control.scroll={visible:control.scroll.visible,offset:0};control.top=row;
      for(const item of control.children){controls.set(item.selector,item);parents.set(item.selector,control);item.depth=depth+1;Object.assign(item,{x:20+(depth+1)*16,width:item.width||320,height:item.height||28});}
      layout(control);row+=control.scroll.visible;continue;
    }
    if(control.children)place(control.children,control,depth+1);
  }};
  place(app.controls,null,1);
  const element=control=>({selector:control.selector,name:control.name,type:control.type,isEnabled:control.enabled!==false,isOffscreen:control.offscreen===true,
    x:control.x,y:control.y,width:control.width,height:control.height,isInvokable:INVOKABLE.includes(control.type)});
  const tree=(list,depth)=>list.map(control=>({...element(control),...(control.children&&depth<INSPECT_DEPTH?{children:tree(control.children,depth+1)}:{})}));
  const find=id=>{const control=controls.get(id);if(!control)throw failure('element not found');return control;};
  const status=()=>({hwnd:window.hwnd,processId:window.processId,processName:window.processName,windowTitle:window.title,windowDpi:window.dpi,scale:window.dpi/96,coordinateSpace:'physical-screen-pixels'});
  const ancestors=control=>{const chain=[];for(let at=control;at;at=parents.get(at.selector))chain.push(at);return chain;};
  // The first rule for this input on this control whose condition holds.
  const fire=(control,action,{to,bubble=false}={})=>{
    for(const at of bubble?ancestors(control):[control]){
      for(const rule of app.rules||[]){
        if(rule.on.selector!==at.selector||rule.on.action!==action||(rule.on.to!==undefined&&rule.on.to!==to))continue;
        // A rule may depend on what the form holds when the input arrives.
        if(rule.when&&!Object.entries(rule.when).every(([id,expected])=>new RegExp(expected,'u').test(String(controls.get(id)?.value??''))))continue;
        for(const {selector:id,...fields} of rule.set||[])Object.assign(controls.get(id),fields);
        if(rule.record)events.push(rule.record);
        return true;
      }
    }
    return false;
  };
  const apply=(control,action,value)=>{
    if(control.enabled===false)throw failure('element is disabled',3);
    if(action==='set_value'){if(control.readOnly)throw failure('element is read only',3);control.value=value;}
    if(action==='toggle_on')control.toggle='On';
    if(action==='toggle_off')control.toggle='Off';
    if(action==='expand')control.expansion='Expanded';
    if(action==='collapse')control.expansion='Collapsed';
    if(action==='select'){
      const parent=parents.get(control.selector);
      for(const sibling of parent?.children||[])if(sibling.selected!==undefined)sibling.selected='False';
      control.selected='True';if(parent&&parent.value!==undefined)parent.value=control.name;
    }
    inputs.push({action,selector:control.selector,...(action==='set_value'?{value}:{})});
    fire(control,action);
  };
  const scrollable=control=>{for(let at=control;at;at=parents.get(at.selector))if(at.scroll)return at;return null;};
  const scrollBy=(list,rows)=>{list.scroll.offset=Math.min(Math.max(0,list.children.length-list.scroll.visible),Math.max(0,list.scroll.offset+rows));layout(list);};
  const focusable=control=>FOCUSABLE.has(control.type)&&control.enabled!==false&&control.offscreen!==true;
  const typeInto=(control,value)=>{
    if(control.password||control.readOnly||!TEXT.has(control.type))return;
    control.value=control.selectAll?value:(control.value??'')+value;control.selectAll=false;
  };
  const press=token=>{
    const control=controls.get(focused);if(!control)return;
    if(token==='tab'||token==='shift+tab'){
      const order=[...controls.values()].filter(focusable),at=order.indexOf(control);
      if(order.length)focused=order[(at+(token==='tab'?1:-1)+order.length)%order.length].selector;return;
    }
    if(token==='ctrl+a'){control.selectAll=true;return;}
    if((token==='backspace'||token==='delete')&&TEXT.has(control.type)&&!control.readOnly&&!control.password){control.value=control.selectAll?'':token==='backspace'?String(control.value??'').slice(0,-1):control.value;control.selectAll=false;return;}
    if((token==='down'||token==='up')&&Array.isArray(control.children)&&control.children.some(item=>item.selected!==undefined)){
      const items=control.children.filter(item=>item.selected!==undefined),at=items.findIndex(item=>item.selected==='True'),next=items[Math.min(items.length-1,Math.max(0,at+(token==='down'?1:-1)))];
      if(next&&next!==items[at])apply(next,'select');return;
    }
    fire(control,'key:'+token,{bubble:true});
  };
  const properties=control=>{
    const list=control.scroll?control:null,max=list?Math.max(0,list.children.length-list.scroll.visible):0;
    return {IsPassword:control.password?'True':'False',IsReadOnly:control.readOnly?'True':'False',
      ...(control.selected!==undefined?{IsSelected:control.selected}:{}),...(control.toggle!==undefined?{ToggleState:control.toggle}:{}),...(control.expansion!==undefined?{ExpandCollapseState:control.expansion}:{}),
      ...(list?{VerticallyScrollable:max>0?'True':'False',HorizontallyScrollable:'False',ScrollVerticalPercent:max>0?String(Math.round(list.scroll.offset/max*1000)/10):'-1',ScrollHorizontalPercent:'-1'}:{})};
  };
  const runner=async args=>{
    commands.push(args.slice(1,3).join(' '));
    const command=args[1],at=name=>{const index=args.indexOf(name);return index<0?undefined:args[index+1];};
    if(command==='list-windows')return [{hwnd:window.hwnd,processId:window.processId,processName:window.processName,title:window.title,width:window.width,height:window.height}];
    if(Number(at('-w'))!==window.hwnd)throw failure('window not found');
    if(command==='status')return status();
    if(command==='inspect')return {windows:[{hwnd:window.hwnd,elements:tree(app.controls,1)}]};
    if(command==='search'){
      const query=String(args[2]).toLowerCase(),matches=[...controls.values()].filter(control=>control.name.toLowerCase().includes(query)||control.selector.toLowerCase().includes(query)).map(element);
      return {matchCount:Math.min(20,matches.length),hasMore:matches.length>20,matches:matches.slice(0,20)};
    }
    if(command==='get-property'){const control=find(args[2]);return {elementId:control.selector,element:element(control),properties:properties(control)};}
    if(command==='get-value'){const control=find(args[2]);return {elementId:control.selector,text:control.value??''};}
    if(command==='get-focused'){const control=controls.get(focused);return control?{hasFocus:true,element:element(control)}:{hasFocus:false,element:null};}
    if(command==='screenshot'){
      const whole=args[2]==='--capture-screen',control=whole?null:find(args[2]),width=whole?window.width:control.width,height=whole?window.height:control.height;
      const file=at('--output'),shown=[...controls.values()].filter(item=>item.offscreen!==true).map(({selector,name,type,x,y,width,height,value,toggle,selected,password,readOnly,enabled})=>({selector,name,type,x,y,width,height,value,toggle,selected,password,readOnly,enabled}));
      const drawn=images==='drawn'&&await render({title:window.title,width:window.width,height:window.height,controls:shown,crop:whole?null:{x:control.x,y:control.y,width,height},output:file});
      if(!drawn){
        // A plain picture. The shade changes with every input, so a capture after an input differs from the one before.
        images='plain';const png=new PNG({width,height});png.data.fill(Math.max(40,250-inputs.length*12));await writeFile(file,PNG.sync.write(png));
      }
      return {hwnd:window.hwnd,elementId:whole?null:control.selector,filePath:file,width,height};
    }
    if(command==='set-value'){apply(find(args[2]),'set_value',String(args[3]));return {ok:true};}
    if(command==='invoke'){const action=NATIVE[at('--action')];if(!action)throw failure('unknown action');apply(find(args[2]),action);return {ok:true};}
    if(command==='click'){
      const control=find(args[2]),action=args.includes('--double')?'pointer_double_click':args.includes('--right')?'pointer_right_click':'pointer_click';
      if(control.enabled===false)throw failure('element is disabled',3);
      if(focusable(control))focused=control.selector;
      inputs.push({action,selector:control.selector});
      // A left click on a button does what pressing it does.
      if(!fire(control,action)&&action==='pointer_click'&&INVOKABLE.includes(control.type))fire(control,'invoke');
      return {elementId:control.selector,clickType:action,hwnd:window.hwnd};
    }
    if(command==='hover'){const control=find(args[2]);inputs.push({action:'hover',selector:control.selector});fire(control,'hover');return {elementId:control.selector,hwnd:window.hwnd};}
    if(command==='drag'){const control=find(args[2]),to=find(args[3]).selector;inputs.push({action:'drag',selector:control.selector,to});fire(control,'drag',{to});return {from:control.selector,to,hwnd:window.hwnd};}
    if(command==='scroll'){
      const control=find(args[2]),list=scrollable(control),wheel=at('--wheel'),direction=at('--direction');
      if(!list||direction&&!['up','down'].includes(direction))throw failure('element does not support ScrollPattern');
      const rows=wheel!==undefined?-Number(wheel)*WHEEL_ROWS:direction==='down'?list.scroll.visible:-list.scroll.visible;
      inputs.push({action:wheel!==undefined?'wheel':'scroll',selector:control.selector,...(direction?{direction}:{wheel:Number(wheel)})});
      scrollBy(list,rows);fire(control,wheel!==undefined?'wheel':'scroll');return {elementId:control.selector,hwnd:window.hwnd};
    }
    if(command==='scroll-into-view'){
      const control=find(args[2]),list=scrollable(parents.get(control.selector)||control);
      inputs.push({action:'scroll_into_view',selector:control.selector});
      if(list){const index=list.children.indexOf(control),{offset,visible}=list.scroll;if(index>=0&&(index<offset||index>=offset+visible))scrollBy(list,index<offset?index-offset:index-offset-visible+1);}
      return {elementId:control.selector,hwnd:window.hwnd};
    }
    if(command==='send-keys'){
      const target=at('--target'),control=target?find(target):controls.get(focused);
      if(!control)throw failure('no focused element');
      if(control.enabled===false)throw failure('element is disabled',3);
      focused=control.selector;
      if(args.includes('--verbatim')){inputs.push({action:'type_text',selector:control.selector,value:args[2]});typeInto(control,args[2]);fire(control,'type_text');}
      else{inputs.push({action:'press_keys',selector:control.selector,keys:args[2]});for(const token of String(args[2]).split(/\s+/).filter(Boolean))press(token);}
      return {keys:args[2],via:at('--via')||'post-message',actionCount:1,target:target||null,hwnd:window.hwnd,warnings:[]};
    }
    throw failure('unknown command');
  };
  return {runner,window:window.hwnd,
    state:()=>({images,inputs:structuredClone(inputs),events:[...events],commands:[...commands],focused,
      controls:Object.fromEntries([...controls].map(([id,control])=>[id,{name:control.name,...(control.value!==undefined?{value:control.value}:{}),...(control.toggle!==undefined?{toggle:control.toggle}:{}),...(control.selected!==undefined?{selected:control.selected}:{}),...(control.expansion!==undefined?{expansion:control.expansion}:{})}]))})};
}
