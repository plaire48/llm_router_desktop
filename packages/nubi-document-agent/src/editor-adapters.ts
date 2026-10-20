import {canonical,fail} from './contracts.js';
import type {EditorBinding,EditorSnapshot,LiveEditorPort,EditorPatch,EditorReceipt} from './editors.js';

interface MonacoPosition {lineNumber:number;column:number}
interface MonacoRange {startLineNumber:number;startColumn:number;endLineNumber:number;endColumn:number}
export interface MonacoModel {
  getValue():string;
  getVersionId():number;
  getPositionAt(offset:number):MonacoPosition;
  getOffsetAt(position:MonacoPosition):number;
  isDisposed():boolean;
}
export interface MonacoEditor {
  getModel():MonacoModel|null;
  getSelection():MonacoRange|null;
  pushUndoStop():boolean;
  executeEdits(source:string,edits:Array<{range:MonacoRange;text:string;forceMoveMarkers?:boolean}>):boolean;
}
export interface MonacoConnection {
  connectionId:string;
  documentId:string;
  editor:MonacoEditor;
  /** Check the actual editor's readOnly option, not just the file extension. */
  readOnly():boolean;
  dirty():boolean;
  isConnected():boolean;
}
interface EditorPosition {line:number;ch:number}
export interface ObsidianEditor {
  getValue():string;
  getCursor(which:'from'|'to'):EditorPosition;
  posToOffset(position:EditorPosition):number;
  offsetToPos(offset:number):EditorPosition;
  replaceRange(text:string,from:EditorPosition,to?:EditorPosition,origin?:string):void;
}
export interface ObsidianConnection {
  connectionId:string;
  documentId:string;
  editor:ObsidianEditor;
  /** Host checks the pinned MarkdownView/editor and file identity. */
  isConnected():boolean;
  readOnly():boolean;
  /** Monotonic host counter from Obsidian's editor-change event. */
  revision():number;
  /** Obsidian may autosave. Unknown is more accurate than an invented saved flag. */
  dirty():boolean|'unknown';
}
const check = (signal:AbortSignal) => {if(signal.aborted)fail('operation_cancelled');};
function validatePatch(before:EditorSnapshot,patch:EditorPatch) {
  if(!Number.isSafeInteger(patch.start)||!Number.isSafeInteger(patch.end)||patch.start<0||patch.end<patch.start||patch.end>before.text.length||typeof patch.newText!=='string'||patch.newText.length>12000||patch.newText.includes('\0')||before.text.slice(patch.start,patch.end)!==patch.oldText)fail('editor_patch_invalid');
}
function writable(current:EditorSnapshot,before:EditorSnapshot,patch:EditorPatch) {
  validatePatch(before,patch);
  if(current.readOnly||canonical(current.binding)!==canonical(before.binding)||current.revision!==before.revision||current.text!==before.text)fail('editor_changed');
}
const receipt = ():EditorReceipt => ({status:'confirmed',receiptId:crypto.randomUUID()});

export function createMonacoEditorPort(connection:MonacoConnection):LiveEditorPort {
  const editor=connection.editor,model=editor.getModel();
  if(!model)fail('editor_missing');
  const binding:EditorBinding={connectionId:connection.connectionId,documentId:connection.documentId,mode:'internal',app:'monaco'};
  function inspect():EditorSnapshot {
    if(!connection.isConnected()||connection.editor!==editor||model!.isDisposed()||editor.getModel()!==model)fail('editor_disconnected');
    const selection=editor.getSelection();
    return {binding:{...binding},revision:String(model!.getVersionId()),text:model!.getValue(),selection:selection?{start:model!.getOffsetAt({lineNumber:selection.startLineNumber,column:selection.startColumn}),end:model!.getOffsetAt({lineNumber:selection.endLineNumber,column:selection.endColumn})}:{start:0,end:0},readOnly:connection.readOnly(),dirty:connection.dirty()};
  }
  return {
    async inspect(signal){check(signal);return inspect();},
    async replaceIfCurrent(before,patch,signal){
      check(signal);writable(inspect(),before,patch);
      const start=model!.getPositionAt(patch.start),end=model!.getPositionAt(patch.end);
      // No await between current-buffer comparison and the UI-thread transaction.
      editor.pushUndoStop();
      const applied=editor.executeEdits('nubi.document-agent',[{range:{startLineNumber:start.lineNumber,startColumn:start.column,endLineNumber:end.lineNumber,endColumn:end.column},text:patch.newText,forceMoveMarkers:true}]);
      editor.pushUndoStop();
      return applied?receipt():{status:'not_started'};
    }
  };
}

export function createObsidianEditorPort(connection:ObsidianConnection):LiveEditorPort {
  const editor=connection.editor;
  const binding:EditorBinding={connectionId:connection.connectionId,documentId:connection.documentId,mode:'external',app:'obsidian'};
  function inspect():EditorSnapshot {
    if(!connection.isConnected()||connection.editor!==editor)fail('editor_disconnected');
    return {binding:{...binding},revision:String(connection.revision()),text:editor.getValue(),selection:{start:editor.posToOffset(editor.getCursor('from')),end:editor.posToOffset(editor.getCursor('to'))},readOnly:connection.readOnly(),dirty:connection.dirty()};
  }
  return {
    async inspect(signal){check(signal);return inspect();},
    async replaceIfCurrent(before,patch,signal){
      check(signal);writable(inspect(),before,patch);
      // Public Editor API retains the active buffer, undo and normal app autosave behavior.
      editor.replaceRange(patch.newText,editor.offsetToPos(patch.start),editor.offsetToPos(patch.end),'nubi.document-agent');
      return receipt();
    }
  };
}
