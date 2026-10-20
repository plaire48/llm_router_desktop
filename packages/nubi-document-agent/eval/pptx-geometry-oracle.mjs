const array=x=>x===undefined?[]:Array.isArray(x)?x:[x];
const find=(x,key)=>!x||typeof x!=='object'?[]:Object.entries(x).flatMap(([k,v])=>k===key?array(v):array(v).flatMap(n=>find(n,key)));
export function shapeBoxes(xml,labels){
 const shapes=find(xml,'p:sp'),result=[];
 for(const label of labels){const matches=shapes.filter(s=>find(s,'a:t').join('')===label);if(matches.length!==1)return [];
  const shape=matches[0],transform=shape['p:spPr']?.['a:xfrm'],off=transform?.['a:off'],ext=transform?.['a:ext'];
  const box={label,x:Number(off?.['@_x']),y:Number(off?.['@_y']),cx:Number(ext?.['@_cx']),cy:Number(ext?.['@_cy']),roundRect:shape['p:spPr']?.['a:prstGeom']?.['@_prst']==='roundRect'};
  if(![box.x,box.y,box.cx,box.cy].every(Number.isFinite)||box.cx<=0||box.cy<=0)return [];result.push(box);
 }return result;
}
export function inspectFlowGeometry(xml,labels){
 const b=shapeBoxes(xml,labels),complete=b.length===labels.length&&b.length===3;
 return {threeShapes:complete&&b.every(x=>x.roundRect),alignment:complete&&new Set(b.map(x=>x.y)).size===1&&new Set(b.map(x=>`${x.cx},${x.cy}`)).size===1,spacing:complete&&Math.abs((b[1].x-b[0].x-b[0].cx)-(b[2].x-b[1].x-b[1].cx))<=1,order:complete&&b.every((box,i)=>i===0||box.x>b[i-1].x),withinSlide:complete&&b.every(x=>x.x>=0&&x.y>=0&&x.x+x.cx<=12192000&&x.y+x.cy<=6858000)};
}
