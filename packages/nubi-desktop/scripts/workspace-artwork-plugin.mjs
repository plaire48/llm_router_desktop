import {readFile} from 'node:fs/promises';
import path from 'node:path';

// Keep the original artwork bytes. Fixtures can still import the data URL;
// the shipped app loads one cacheable image instead of parsing it as JavaScript.
export function workspaceArtworkPlugin(){
 const source=path.resolve('ui/TeamWorkspaceMark.js');let bytes;
 return {name:'nubi-workspace-artwork',setup(builder){
  builder.onLoad({filter:/TeamWorkspaceMark\.js$/},async args=>{
   if(args.path!==source)return;
   const text=await readFile(source,'utf8'),match=text.match(/export const teamWorkspaceMark='data:image\/png;base64,([A-Za-z0-9+/=]+)';/);
   if(!match)throw Error('workspace_artwork_format');bytes=Buffer.from(match[1],'base64');
   return {contents:"export {default as teamWorkspaceMark} from 'nubi-workspace-artwork';",loader:'js',watchFiles:[source]};
  });
  builder.onResolve({filter:/^nubi-workspace-artwork$/},()=>({path:'team-workspace.png',namespace:'nubi-artwork'}));
  builder.onLoad({filter:/.*/,namespace:'nubi-artwork'},()=>({contents:bytes,loader:'file'}));
 }};
}
