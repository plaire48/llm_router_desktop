export function pageRank(graph,{damping=0.85,iterations=60,teleport=null}={}){
 const nodes=Object.keys(graph).sort();if(!nodes.length)return {};
 const index=new Map(nodes.map((node,i)=>[node,i])),n=nodes.length;
 const out=nodes.map(node=>[...new Set((graph[node]||[]).filter(target=>index.has(target)&&target!==node))].sort());
 const seeds=teleport&&teleport.length?teleport.filter(node=>index.has(node)):[];
 const base=new Array(n).fill(0);if(seeds.length)for(const seed of seeds)base[index.get(seed)]+=1/seeds.length;else base.fill(1/n);
 let rank=[...base];
 for(let step=0;step<iterations;step++){
  const next=new Array(n).fill(0);let dangling=0;
  for(let i=0;i<n;i++){if(!out[i].length){dangling+=rank[i];continue;}const share=rank[i]/out[i].length;for(const target of out[i])next[index.get(target)]+=share;}
  for(let i=0;i<n;i++)next[i]=(1-damping)*base[i]+damping*(next[i]+dangling*base[i]);
  const total=next.reduce((sum,value)=>sum+value,0)||1;for(let i=0;i<n;i++)next[i]/=total;
  rank=next;
 }
 return Object.fromEntries(nodes.map((node,i)=>[node,rank[i]]));
}
