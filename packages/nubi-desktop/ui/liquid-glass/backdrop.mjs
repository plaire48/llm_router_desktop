// Optical calculations use the existing neutral surface. This is an OFFSCREEN
// texture, never an invented coloured scene painted behind application UI.
export function glassPalette(element){
 const style=getComputedStyle(element),color=name=>style.getPropertyValue(name).trim();
 return {base:color('--nuvi-surface')};
}
export function paintGlassBackdrop(canvas,width,height,dpr,palette){
 const ctx=canvas.getContext('2d');if(!ctx)return false;
 canvas.width=Math.max(1,Math.round(width*dpr));canvas.height=Math.max(1,Math.round(height*dpr));
 ctx.setTransform(dpr,0,0,dpr,0,0);ctx.fillStyle=palette.base;ctx.fillRect(0,0,width,height);
 return true;
}
