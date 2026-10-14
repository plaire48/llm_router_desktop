// First-person flight for the opening scene (user request 2026-10-14: "광속으로 하늘을 빠르게 날아가는 느낌", not
// linked photos). Soft cloud puffs come at the camera in perspective from a vanishing point at
// the sun, speed streaks stretch as we accelerate to warp, the view banks and lifts a little on each wingbeat. Canvas
// 2D at a capped pixel ratio; stops by itself after `length` ms or when the returned function is called.
const CLOUDS=22,STREAKS=280,FAR=36,NEAR=.35;
// Soft cumulus puffs: many overlapping light blobs, brighter on top and warm underneath, with an uneven outline.
// Near the camera they read as haze rushing past, far away as small clouds.
function cloudSprites(){
  const sprites=[];
  for(let index=0;index<10;index++){
    const W=320,H=220,canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;
    const ctx=canvas.getContext('2d');
    const blobs=14+Math.floor(Math.random()*10);
    for(let b=0;b<blobs;b++){
      const angle=Math.random()*Math.PI*2,distance=Math.random()*.42;
      const x=W/2+Math.cos(angle)*distance*W*.9,y=H*.55+Math.sin(angle)*distance*H*.55-Math.random()*H*.12;
      const r=(.16+Math.random()*.22)*W*(1-distance*.8);
      const top=y<H*.5,gradient=ctx.createRadialGradient(x,y-r*.25,r*.05,x,y,r);
      gradient.addColorStop(0,top?'rgba(255,255,255,.55)':'rgba(255,246,236,.48)');
      gradient.addColorStop(.55,top?'rgba(255,252,248,.28)':'rgba(250,228,212,.24)');
      gradient.addColorStop(1,'rgba(255,240,230,0)');
      ctx.fillStyle=gradient;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();
    }
    sprites.push(canvas);
  }
  return sprites;
}
export function startIntroFlight(canvas,{length=2700,vanish={x:.43,y:.5}}={}){
  let stopped=false,frame=0;
  const ctx=canvas.getContext('2d',{alpha:true});
  // Rendered a little below screen resolution: haze and streaks stay soft and slower PCs keep their frame rate.
  const ratio=Math.min(1,window.devicePixelRatio||1)*.8;
  const size=()=>{canvas.width=Math.round(innerWidth*ratio);canvas.height=Math.round(innerHeight*ratio);};
  size();window.addEventListener('resize',size);
  const spread=()=>({x:(Math.random()*2-1)*FAR*.9,y:(Math.random()*2-1)*FAR*.55});
  const clouds=Array.from({length:CLOUDS},()=>({...spread(),z:NEAR+Math.random()*FAR,s:4+Math.random()*5,sprite:0,turn:Math.random()*Math.PI*2}));
  const streaks=Array.from({length:STREAKS},()=>({...spread(),z:NEAR+Math.random()*FAR}));
  let sprites=[];
  sprites=cloudSprites();for(const cloud of clouds)cloud.sprite=Math.floor(Math.random()*sprites.length);
  const start=performance.now();let last=start;
  // Speed: a calm glide, then acceleration to warp near the end.
  // A slow glide, then exponential acceleration (user request 2026-10-14: "점점 천천히 날다가 기하급수적으로 빠르게"):
  // after the cruise the speed doubles about every 0.4 s, up to warp.
  const CRUISE=length*.42;
  const speedAt=t=>t<CRUISE?3+t/CRUISE*2:Math.min(800,5*Math.pow(2,(t-CRUISE)/400));
  const draw=now=>{
    if(stopped)return;
    const t=now-start,dt=Math.min(.05,(now-last)/1000);last=now;
    const W=canvas.width,H=canvas.height,f=Math.min(W,H)*.9,speed=speedAt(t),warp=Math.min(1,Math.log2(speed/5)/7);
    ctx.clearRect(0,0,W,H);
    ctx.save();
    // Bank into a gentle turn and lift on each wingbeat; the beat fades as we reach warp.
    const cx=W*vanish.x,cy=H*vanish.y+Math.sin(t/1000*Math.PI*3.2)*H*.012*Math.max(0,1-warp*1.6);
    ctx.translate(cx,cy);ctx.rotate(Math.sin(t/1000*1.4)*.07);
    // Clouds coming at the camera, far ones faint, near ones large and fading as they pass.
    if(sprites.length){
      clouds.sort((a,b)=>b.z-a.z);
      for(const cloud of clouds){
        cloud.z-=speed*dt*.6;if(cloud.z<NEAR){Object.assign(cloud,spread(),{z:FAR});}
        const scale=f/cloud.z,px=cloud.x*scale,py=cloud.y*scale,r=cloud.s*scale;
        if(Math.abs(px)-r>W||Math.abs(py)-r>H)continue;
        const fadeIn=Math.min(1,(FAR-cloud.z)/6),fadeOut=Math.min(1,(cloud.z-NEAR)/1.6);
        ctx.globalAlpha=.32*fadeIn*fadeOut;
        // Stretch along the flight line from the centre: faster means longer haze trails.
        const stretch=1+Math.min(3,speed/45)*Math.min(1,Math.hypot(px,py)/(f*.6));
        ctx.save();ctx.translate(px,py);ctx.rotate(Math.atan2(py,px));ctx.scale(stretch,1);ctx.drawImage(sprites[cloud.sprite],-r*1.2,-r*.8,r*2.4,r*1.65);ctx.restore();
      }
    }
    // Speed streaks: their length follows the speed, so they stretch into warp lines.
    ctx.lineCap='round';
    for(const streak of streaks){
      const before=streak.z;streak.z-=speed*dt;if(streak.z<NEAR){Object.assign(streak,spread(),{z:FAR});continue;}
      const a=f/streak.z,b=f/Math.min(FAR,before+speed*.04+.3),p=Math.max(0,warp);
      const x1=streak.x*a,y1=streak.y*a,x2=streak.x*b,y2=streak.y*b;
      // Streaks start short and faint and grow long, bright and thick as we accelerate.
      ctx.globalAlpha=Math.min(1,(FAR-streak.z)/8)*(.08+.9*p);
      ctx.strokeStyle='rgba(255,249,238,1)';ctx.lineWidth=Math.max(.8,(.8+3.2*p)*Math.min(3,a/f*2.4)*ratio);
      ctx.beginPath();ctx.moveTo(x2,y2);ctx.lineTo(x1,y1);ctx.stroke();
    }
    ctx.restore();ctx.globalAlpha=1;
    if(t<length+600)frame=requestAnimationFrame(draw);
  };
  frame=requestAnimationFrame(draw);
  return()=>{stopped=true;cancelAnimationFrame(frame);window.removeEventListener('resize',size);};
}
