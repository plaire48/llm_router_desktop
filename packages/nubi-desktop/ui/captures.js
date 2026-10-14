// Crop a window capture to the rectangle the user dragged (CSS pixels of the viewport). The capture may be scaled
// down by the host, so the crop scales with it. Returns the PNG without the data URL prefix, for the host record.
export const CAPTURE_LIMIT=3;
export function cropCapture(shot,rect){
  return new Promise((resolve,reject)=>{
    const image=new Image();
    image.onload=()=>{
      try{
        const scale=rect.imagePixels?1:shot.width/Math.max(1,window.innerWidth);
        const x=Math.max(0,Math.round(rect.x*scale)),y=Math.max(0,Math.round(rect.y*scale));
        const width=Math.max(1,Math.min(shot.width-x,Math.round(rect.width*scale))),height=Math.max(1,Math.min(shot.height-y,Math.round(rect.height*scale)));
        const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
        canvas.getContext('2d').drawImage(image,x,y,width,height,0,0,width,height);
        const dataUrl=canvas.toDataURL('image/png');
        resolve({id:crypto.randomUUID(),dataUrl,image:dataUrl.slice(dataUrl.indexOf(',')+1),width,height});
      }catch(error){reject(error);}
    };
    image.onerror=()=>reject(Error('capture_unreadable'));
    image.src='data:image/png;base64,'+shot.image;
  });
}
// What goes with the message: the host keeps the PNG in its own record and returns ids.
export const captureAttachments=captures=>captures.map(({image,width,height})=>({image,width,height}));
