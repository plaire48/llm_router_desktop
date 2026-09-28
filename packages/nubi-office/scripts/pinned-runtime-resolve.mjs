const officeManifest=new URL('../package.json',import.meta.url).href;
const pinned=['@earendil-works/pi-agent-core','@earendil-works/pi-ai','@earendil-works/pi-coding-agent'];
export async function resolve(specifier,context,nextResolve){
  if(pinned.some(name=>specifier===name||specifier.startsWith(name+'/')))return nextResolve(specifier,{...context,parentURL:officeManifest});
  // Transitive packages keep their own package-relative resolution.
  return nextResolve(specifier,context);
}
