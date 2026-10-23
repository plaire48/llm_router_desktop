import path from 'node:path';
import {readFile} from 'node:fs/promises';
// Adapt the pinned CX source at the Desktop build boundary. The portal and its
// children stay mounted; CX releases/reacquires its own focus/inert lifecycle.
export function adaptBackgroundModal(source,hook){
 const replacements=[
  ['  const titleId=useId(),panel=useRef(null),close=useRef(onClose);','  const titleId=useId(),panel=useRef(null),close=useRef(onClose);\n  const background=useBackgroundModal(panel,busy,onClose);'],
  ['useEffect(()=>embedded?undefined:activateModal(panel.current,','useEffect(()=>embedded||background.hidden?undefined:activateModal(panel.current,'],
  ['),[embedded]);','),[embedded,background.hidden]);'],
  ["role={embedded?'region':role}","role={embedded||background.hidden?'region':role}"],
  ['aria-modal={embedded?undefined:true}','aria-modal={embedded||background.hidden?undefined:true}'],
  ['<div className="cx-panel-header-actions">','<div className="cx-panel-header-actions"><BackgroundModalAction controller={background}/>'],
  ['<div className={`cx-panel-backdrop ', '<div hidden={background.hidden} inert={background.hidden||undefined} data-task-background={background.hidden||undefined} className={`cx-panel-backdrop ']
 ];
 for(const [from,to]of replacements){if(source.split(from).length!==2)throw Error('cx_background_modal_contract');source=source.replace(from,to);}
 return `import {useBackgroundModal,BackgroundModalAction} from ${JSON.stringify(hook)};\n${source}`;
}
export function backgroundModalPlugin(){return {name:'nubi-background-modal',setup(builder){builder.onLoad({filter:/[\\/]@e2e[\\/]cx-design-system[\\/]src[\\/]DetailPanel\.jsx$/},async({path:file})=>({contents:adaptBackgroundModal(await readFile(file,'utf8'),path.resolve('ui/background-modal.jsx')),loader:'jsx',resolveDir:path.dirname(file)}));}};}
