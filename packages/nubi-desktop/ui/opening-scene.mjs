export const OPENING_SCENE_KEY='nubi-opening-scene-v1';
export const openingSceneId=(version,installationId)=>installationId?`${version}:${installationId}`:version;
export function needsOpeningScene(storage,id){
 try{return storage.getItem(OPENING_SCENE_KEY)!==id;}catch{return true;}
}
export function rememberOpeningScene(storage,id){
 try{storage.setItem(OPENING_SCENE_KEY,id);}catch{/* Failure must not suppress the next opening. */}
}
