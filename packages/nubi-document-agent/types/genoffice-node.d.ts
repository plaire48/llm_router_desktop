import type {FileEnginePort} from '../dist/types/src/file-operations.js';
/** Host owns the executable paths and deployment of the pinned existing engines. */
export function createNodeGenOfficeEngine(options:{wordExcelEnginePath:string;slideEnginePath:string;nodePath?:string;xlsxSidecarPath?:string;xlsxEditorEnginePath?:string}):FileEnginePort;
