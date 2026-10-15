// clip uses CSS viewport pixels; crop before resizing so only requested pixels leave main.
function captureImage(image,{clip,maxWidth=1600}={},viewport=image.getSize()){
 const original=image.getSize();if(!original.width||!original.height)throw Error('browser_capture_unavailable');
 if(!Number.isInteger(maxWidth)||maxWidth<128||maxWidth>2400)throw Error('capture_size_invalid');
 if(clip!==undefined){
  if(!clip||!['x','y','width','height'].every(key=>Number.isFinite(clip[key]))||clip.x<0||clip.y<0||clip.width<1||clip.height<1||clip.x+clip.width>viewport.width||clip.y+clip.height>viewport.height)throw Error('capture_region_invalid');
  const sx=original.width/viewport.width,sy=original.height/viewport.height;
  const x=Math.floor(clip.x*sx),y=Math.floor(clip.y*sy),right=Math.min(original.width,Math.ceil((clip.x+clip.width)*sx)),bottom=Math.min(original.height,Math.ceil((clip.y+clip.height)*sy));
  image=image.crop({x,y,width:right-x,height:bottom-y});
 }
 if(image.getSize().width>maxWidth)image=image.resize({width:maxWidth});
 const bytes=image.toPNG();if(bytes.length>6*1024*1024)throw Error('browser_capture_limit');
 return {image:bytes.toString('base64'),...image.getSize(),viewport:{width:viewport.width,height:viewport.height},...(clip?{clip}:{}),mimeType:'image/png'};
}
module.exports={captureImage};

// DOM readiness can precede the first compositor surface. Retry only this
// transient Electron condition, never arbitrary failures or white page pixels.
async function captureSurface(contents){
 let resumeThrottling=false;
 try{
  for(let attempt=0;attempt<4;attempt++){
   if(contents.isDestroyed())throw Error('browser_capture_unavailable');
   try{return await contents.capturePage();}catch(error){
    if(!/Current display surface not available for capture/.test(error?.message||''))throw error;
    if(attempt===3)throw Error('browser_capture_unavailable');
    // Occluded windows can have a ready DOM but no frame. Allow painting only
    // during capture, without focusing, showing or navigating the page.
    if(!resumeThrottling&&contents.getBackgroundThrottling()){
     contents.setBackgroundThrottling(false);resumeThrottling=true;
    }
    await new Promise(resolve=>setTimeout(resolve,50));
   }
  }
 }finally{if(resumeThrottling&&!contents.isDestroyed())contents.setBackgroundThrottling(true);}
}
module.exports.captureSurface=captureSurface;
