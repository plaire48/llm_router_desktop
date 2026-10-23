const {DEFAULT_TITLEBAR,applyCaptionColors,validateCaptionColors}=require('./titlebar-colors.cjs');

// Windows WCO cannot be switched off after creation. Min/max disappear when
// disabled; the remaining disabled close button must also have transparent ink
// and background so it cannot reveal a red hover target above the flight.
const HIDDEN_CAPTION=Object.freeze({color:'#00000000',symbolColor:'#00000000',height:DEFAULT_TITLEBAR.height});
function openingCaptionOptions(platform=process.platform){
 return platform==='win32'?{titleBarOverlay:HIDDEN_CAPTION,minimizable:false,maximizable:false,closable:false}:{};
}
class OpeningCaption {
 constructor(window,platform=process.platform){
  this.window=window;this.platform=platform;this.active=platform==='win32';this.colors=DEFAULT_TITLEBAR;
 }
 appearance(colors){
  validateCaptionColors(colors);
  this.colors={color:colors.color,symbolColor:colors.symbolColor};
  // Theme observers may run before the scene ends. Cache their latest colors
  // without making the caption reappear above the body portal.
  if(!this.active)applyCaptionColors(this.window,this.colors,this.platform);
 }
 opening(active){
  if(typeof active!=='boolean')throw Error('opening_scene_invalid');
  if(this.platform!=='win32'||this.window.isDestroyed()||this.active===active)return;
  this.active=active;
  this.window.setMinimizable(!active);this.window.setMaximizable(!active);this.window.setClosable(!active);
  if(active)this.window.setTitleBarOverlay(HIDDEN_CAPTION);
  else applyCaptionColors(this.window,this.colors,this.platform);
 }
}
module.exports={HIDDEN_CAPTION,openingCaptionOptions,OpeningCaption};
