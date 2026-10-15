import {createWikiLayout,advanceWikiLayout,wikiLayoutPositions} from './wiki-graph.mjs';
// Dedicated worker, terminated when its map closes or changes grouping. Source
// bodies, mail addresses and credentials are never needed for layout.
self.onmessage=({data})=>{
 const layout=createWikiLayout(data.graph,data.size);let last=0;
 while(layout.steps<layout.maxSteps){
  const done=advanceWikiLayout(layout,1),now=performance.now();
  if(done||now-last>=80){self.postMessage({positions:[...wikiLayoutPositions(layout)],done});last=now;}
 }
};
