const {nativeImage}=require('electron');
const {captureImage,captureSurface}=require('./capture-image.cjs');

// WebContents captures do not include sibling WebContentsViews. Compose only the
// visible browser surface; never reveal a hidden tab or an authentication view.
async function captureWindow(window,browserHost,options={}){
 if(!window||window.isDestroyed())throw Error('browser_unavailable');
 const [width,height]=window.getContentSize();
 const row=browserHost?.visible?browserHost.tabs.get(browserHost.active):null;
 const visible=row?.view.getVisible()===true;
 if(visible&&(row.authentication||row.companyLogin||row.session))throw Error('browser_auth_protected');
 const bounds=visible?row.view.getBounds():null;
 const revision=visible?row.revision:0;
 const [base,page]=await Promise.all([
  captureSurface(window.webContents),
  visible?browserHost.capture(row.id,{maxWidth:2400}):null,
 ]);
 if(window.isDestroyed()||window.getContentSize().some((n,i)=>n!==[width,height][i]))throw Error('browser_document_changed');
 if(visible&&(!browserHost.visible||browserHost.active!==row.id||row.revision!==revision||!row.view.getVisible()||JSON.stringify(row.view.getBounds())!==JSON.stringify(bounds)))throw Error('browser_document_changed');
 let image=base;
 if(page){
  const size=base.getSize(),sx=size.width/width,sy=size.height/height;
  const x=Math.round(bounds.x*sx),y=Math.round(bounds.y*sy);
  const w=Math.min(size.width-x,Math.round(bounds.width*sx)),h=Math.min(size.height-y,Math.round(bounds.height*sy));
  if(w<1||h<1)throw Error('browser_capture_unavailable');
  const pixels=base.toBitmap(),overlay=nativeImage.createFromBuffer(Buffer.from(page.image,'base64')).resize({width:w,height:h}).toBitmap();
  for(let line=0;line<h;line++)overlay.copy(pixels,((y+line)*size.width+x)*4,line*w*4,(line+1)*w*4);
  image=nativeImage.createFromBitmap(pixels,size);
 }
 return {...captureImage(image,options,{width,height}),url:'nubi://workspace',title:window.getTitle()||'누비 Workspace'};
}
module.exports={captureWindow};
