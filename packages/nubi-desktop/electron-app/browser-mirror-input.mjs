export function mirrorModifiers(event){return (event.altKey?1:0)|(event.ctrlKey?2:0)|(event.metaKey?4:0)|(event.shiftKey?8:0);}
export function mirrorPoint(rect,viewport,clientX,clientY){
 if(!rect||!viewport||rect.width<=0||rect.height<=0||!Number.isFinite(clientX)||!Number.isFinite(clientY))return null;
 const x=(clientX-rect.left)/rect.width*viewport.width,y=(clientY-rect.top)/rect.height*viewport.height;
 if(x<0||y<0||x>viewport.width||y>viewport.height)return null;
 return {x:Math.min(viewport.width-.01,x),y:Math.min(viewport.height-.01,y)};
}
export const mirrorButton=button=>({0:'left',1:'middle',2:'right'})[button]||'none';
