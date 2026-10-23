// Own only the extra space requested by an auxiliary pane. A user move/resize,
// maximization or display change ends ownership; closing never undoes it.
const same=(a,b)=>a&&b&&['x','y','width','height'].every(key=>Math.abs(a[key]-b[key])<=2);
function expandedBounds(bounds,area,width){
 const target=Math.min(area.width,Math.max(bounds.width,Math.ceil(width)));
 return {...bounds,width:target,x:Math.max(area.x,Math.min(bounds.x,area.x+area.width-target))};
}
class WindowExpansion{
 constructor(window,screen,{duration=280,now=()=>Date.now(),schedule=setTimeout,cancel=clearTimeout}={}){
  Object.assign(this,{window,screen,duration,now,schedule,cancel});this.token=0;this.timer=null;this.owned=null;
  this.release=()=>{this.stop();this.owned=null;};
  for(const event of ['will-move','will-resize','maximize','enter-full-screen'])window.on(event,this.release);
  screen.on('display-metrics-changed',this.release);screen.on('display-removed',this.release);
 }
 stop(){this.token++;if(this.timer!==null)this.cancel(this.timer);this.timer=null;}
 layout({open,minimumWidth,reduced=false}={}){
  if(typeof open!=='boolean'||!Number.isFinite(minimumWidth)||minimumWidth<0||minimumWidth>8000)throw Error('window_layout_invalid');
  const win=this.window;if(win.isDestroyed()||win.isMaximized()||win.isFullScreen()||win.isMinimized()){this.release();return {changed:false};}
  const current=win.getBounds(),area=this.screen.getDisplayMatching(current).workArea;
  if(this.owned&&!same(current,this.owned.latest)){this.release();}
  let target;
  if(open){
   target=expandedBounds(current,area,minimumWidth);
   if(same(current,target)){this.stop();return {changed:false};}
   this.owned??={original:{...current},latest:{...current}};
  }else{
   if(!this.owned)return {changed:false};target=this.owned.original;
   // The display containing the original window must still fit that rectangle.
   if(target.x<area.x||target.y<area.y||target.x+target.width>area.x+area.width||target.y+target.height>area.y+area.height){this.release();return {changed:false};}
  }
  this.stop();const token=this.token,start=this.now(),origin={...current};
  const tick=()=>{
   if(token!==this.token||win.isDestroyed())return;
   if(!this.owned||!same(win.getBounds(),this.owned.latest)){this.release();return;}
   const t=reduced?1:Math.min(1,(this.now()-start)/this.duration),p=1-Math.pow(1-t,3);
   const next=Object.fromEntries(['x','y','width','height'].map(key=>[key,Math.round(origin[key]+(target[key]-origin[key])*p)]));
   win.setBounds(next);this.owned.latest=win.getBounds();
   if(t<1)this.timer=this.schedule(tick,16);else{this.timer=null;if(!open)this.owned=null;}
  };
  tick();return {changed:true,expanding:open};
 }
 dispose(){this.release();for(const event of ['will-move','will-resize','maximize','enter-full-screen'])this.window.removeListener(event,this.release);this.screen.removeListener('display-metrics-changed',this.release);this.screen.removeListener('display-removed',this.release);}
}
module.exports={WindowExpansion,expandedBounds};
