// The file engine dispatcher of the registration capture: the app follows the extension. Tests and machines without
// Office only (fidelity 'file'); the product registers through the Office host.
import path from 'node:path';
import {docxCapture} from './docx-capture.mjs';
import {xlsxCapture} from './xlsx-capture.mjs';
import {pptxCapture} from './pptx-capture.mjs';
import {fail} from './files.mjs';

export const OFFICE_EXTENSIONS={'.docx':'word','.docm':'word','.dotx':'word','.xlsx':'excel','.xlsm':'excel','.xltx':'excel','.pptx':'powerpoint','.pptm':'powerpoint','.potx':'powerpoint'};
export const officeAppOf=name=>OFFICE_EXTENSIONS[path.extname(String(name??'')).toLowerCase()]??null;
export async function captureOfficeFile(bytes,{name}){
  const app=officeAppOf(name);
  if(app==='word')return docxCapture(bytes,{name});
  if(app==='excel')return xlsxCapture(bytes,{name});
  if(app==='powerpoint')return pptxCapture(bytes,{name});
  fail('form_format_unsupported');
}
