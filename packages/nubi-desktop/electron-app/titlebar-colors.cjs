// Composite the same CSS surfaces used by the renderer over the native caption.
const DEFAULT_TITLEBAR = Object.freeze({color:'#FAFCFF',symbolColor:'#26334B',height:48});
function rgba(value) {
 const hex=/^#([\da-f]{6})([\da-f]{2})?$/i.exec(value||'');
 if(hex)return [...[0,2,4].map(i=>parseInt(hex[1].slice(i,i+2),16)),hex[2]?parseInt(hex[2],16)/255:1];
 // Chromium preserves CSS color-mix tokens as color(srgb ...), not rgb(...).
 const srgb=/^color\(srgb\s+([-\d.e]+)\s+([-\d.e]+)\s+([-\d.e]+)(?:\s*\/\s*([\d.]+))?\s*\)$/i.exec(value||'');
 if(srgb)return [Number(srgb[1])*255,Number(srgb[2])*255,Number(srgb[3])*255,srgb[4]===undefined?1:Number(srgb[4])];
 const rgb=/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/.exec(value||'');
 return rgb?[Number(rgb[1]),Number(rgb[2]),Number(rgb[3]),rgb[4]===undefined?1:Number(rgb[4])]:null;
}
const hex=channels=>'#'+channels.slice(0,3).map(value=>Math.max(0,Math.min(255,Math.round(value))).toString(16).padStart(2,'0')).join('');
function captionColors(background,symbol,overlays=[]) {
 let color=rgba(background)||rgba(DEFAULT_TITLEBAR.color),ink=rgba(symbol)||rgba(DEFAULT_TITLEBAR.symbolColor);
 for(const value of overlays){const layer=rgba(value);if(!layer)continue;const alpha=Math.max(0,Math.min(1,layer[3]));color=color.map((c,i)=>i<3?layer[i]*alpha+c*(1-alpha):1);ink=ink.map((c,i)=>i<3?layer[i]*alpha+c*(1-alpha):1);}
 return {color:hex(color),symbolColor:hex(ink)};
}
// The toolbar is glass: a transparent background colour under a gradient. Composite the backgrounds from the nearest
// opaque surface up (layers run outermost first) and the gradient's last stop, which sits under the controls on the right.
const COLOR_TOKEN=/color\(srgb[^)]*\)|rgba?\([^)]*\)|#[\da-f]{6}(?:[\da-f]{2})?\b/gi;
function surfaceColor(layers,gradient='') {
 const stops=String(gradient||'').match(COLOR_TOKEN)||[];
 let color=rgba(DEFAULT_TITLEBAR.color);
 for(const value of [...layers,stops.at(-1)]){const layer=rgba(value);if(!layer)continue;const alpha=Math.max(0,Math.min(1,layer[3]));color=color.map((c,i)=>i<3?layer[i]*alpha+c*(1-alpha):1);}
 return hex(color);
}
function validateCaptionColors(colors) {
 if(!colors||!['color','symbolColor'].every(key=>/^#[\da-f]{6}$/i.test(colors[key]||'')))throw Error('titlebar_color_invalid');
}
function applyCaptionColors(window,colors,platform=process.platform) {
 validateCaptionColors(colors);
 if(!['win32','linux'].includes(platform)||window.isDestroyed())return;
 window.setTitleBarOverlay({color:colors.color,symbolColor:colors.symbolColor,height:DEFAULT_TITLEBAR.height});
}
module.exports={DEFAULT_TITLEBAR,captionColors,surfaceColor,applyCaptionColors,validateCaptionColors};
