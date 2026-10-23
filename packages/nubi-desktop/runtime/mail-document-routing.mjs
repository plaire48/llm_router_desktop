import {officeDocumentFormat} from './office-document.mjs';

export function officeCacheUsable(attachment,platform=process.platform){
 return platform!=='win32'||!officeDocumentFormat(attachment.filename,attachment.contentType)||attachment.reader==='office_com'||attachment.originalStored===false;
}
// Office owns Windows Office formats, including protected originals. A COM
// failure remains a reading failure; a parser cannot stand in for that receipt.
export async function readAttachmentDocument({attachment,office,parse,platform=process.platform}){
 return platform==='win32'&&officeDocumentFormat(attachment.filename,attachment.contentType)?office():parse();
}
