// Organic 44-point quadratic outline extracted from the user supplied Calm Liquid theme.
// Evaluate once; compositor-only drift owns ambient motion and its pause policy.
export function createCalmLiquidPath(x,y,r,sx,sy,t,seed,complexity=.145){
   const pts=[], N=44;
   for(let i=0;i<N;i++){
     const a=i*2*Math.PI/N;
     const phase=seed*1.618;
     const wobble=1+complexity*(.68*Math.sin(3*a+t*.58+phase)+.42*Math.sin(5*a-t*.41+phase*1.7)+.33*Math.sin(2*a+t*.28+phase*2.1));
     const breathe=1+.022*Math.sin(t*.75+phase);
     pts.push({x:x+Math.cos(a)*r*sx*wobble*breathe, y:y+Math.sin(a)*r*sy*wobble*breathe});
   }
   const mid=(a,b)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
   let d='',start=mid(pts[N-1],pts[0]);
   d+=`M${start.x.toFixed(1)},${start.y.toFixed(1)}`;
   for(let i=0;i<N;i++){const p=pts[i],m=mid(p,pts[(i+1)%N]);d+=` Q${p.x.toFixed(1)},${p.y.toFixed(1)} ${m.x.toFixed(1)},${m.y.toFixed(1)}`}
   return d+' Z';
 }
