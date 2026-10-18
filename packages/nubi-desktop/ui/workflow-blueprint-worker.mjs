import {previewBlueprint} from '../runtime/workflow-import-blueprint.mjs';
self.onmessage=({data})=>{try{self.postMessage({id:data.id,preview:previewBlueprint(data.source)});}catch(error){self.postMessage({id:data.id,error:/^workflow_/.test(error.message)?error.message:'workflow_import_invalid'});}};
