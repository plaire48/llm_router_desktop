import {installAtmosphereWorker} from './atmosphere-worker-host.mjs';
export {installAtmosphereWorker} from './atmosphere-worker-host.mjs';

// A dynamic module entry keeps the worker in the renderer's source/asset closure.
// No blob/eval/CDN, provider, project or document data is used.
export const atmosphereWorkerURL=import.meta.url;
if(typeof WorkerGlobalScope!=='undefined'&&globalThis instanceof WorkerGlobalScope)installAtmosphereWorker(globalThis);
