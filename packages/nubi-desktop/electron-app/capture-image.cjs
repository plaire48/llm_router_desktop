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
