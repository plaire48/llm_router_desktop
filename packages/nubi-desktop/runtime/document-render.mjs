// Page renders of a document for the before/after review (document forms plan Task E, 2026-10-21). LibreOffice,
// when it is installed, converts the file to PDF and exports each page as PNG; without it the render is reported as
// unavailable and the review shows the checks only. Mac and Linux test use (§8 답 25); the Windows release judges
// with Office itself. Nothing here writes the source document: LibreOffice reads it and writes into outDir.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,readFile,rename,access,readdir,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const run=promisify(execFile);
const CANDIDATES=process.platform==='win32'?['C:\\Program Files\\LibreOffice\\program\\soffice.exe','C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe']
  :process.platform==='darwin'?['/opt/homebrew/bin/soffice','/usr/local/bin/soffice','/Applications/LibreOffice.app/Contents/MacOS/soffice']:['/usr/bin/soffice','/usr/bin/libreoffice','/snap/bin/libreoffice'];
const FILTERS={'.docx':'writer_png_Export','.doc':'writer_png_Export','.odt':'writer_png_Export','.xlsx':'calc_png_Export','.xls':'calc_png_Export','.pptx':'impress_png_Export','.ppt':'impress_png_Export'};

/** The soffice binary: NUBI_SOFFICE, then the usual places, then PATH. Null when none runs; `soffice:false` looks nowhere. */
export async function findSoffice({soffice=process.env.NUBI_SOFFICE}={}){
  if(soffice===false)return null;
  const named=[soffice,...CANDIDATES].filter(Boolean);
  for(const candidate of named){try{await access(candidate);return candidate;}catch{/* next */}}
  try{const {stdout}=await run(process.platform==='win32'?'where':'which',['soffice'],{timeout:5000});const found=stdout.split(/\r?\n/).map(s=>s.trim()).find(Boolean);if(found)return found;}catch{/* not on PATH */}
  return null;
}
async function pageCount(pdfPath){
  const bytes=await readFile(pdfPath);
  try{
    const pdf=await import('../../../extensions/aipro-chat/node_modules/pdfjs-dist/legacy/build/pdf.mjs');
    const document=await pdf.getDocument({data:new Uint8Array(bytes),useSystemFonts:true,disableFontFace:true}).promise;const count=document.numPages;await document.destroy?.();return count;
  }catch{
    const matches=bytes.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g);return Math.max(1,matches?.length??1);
  }
}
// Headless LibreOffice on macOS draws through fontconfig, which does not see the system fonts: Korean became boxes and
// the PDF embedded LinuxLibertine (measured 2026-10-21, forms baseline renders). A fontconfig file naming the macOS font
// folders gives it Apple SD Gothic Neo and the rest. Elsewhere the system fontconfig is used as it is.
const MAC_FONT_DIRS=['/System/Library/Fonts','/System/Library/Fonts/Supplemental','/Library/Fonts',path.join(process.env.HOME??'','Library/Fonts')];
async function fontEnvironment(profile){
  if(process.platform!=='darwin'||process.env.FONTCONFIG_FILE)return process.env;
  const file=path.join(profile,'fonts.conf'),cache=path.join(profile,'fontconfig-cache');
  const escape=value=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;');
  await writeFile(file,`<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "fonts.dtd">\n<fontconfig>${MAC_FONT_DIRS.map(dir=>`<dir>${escape(dir)}</dir>`).join('')}<cachedir>${escape(cache)}</cachedir></fontconfig>\n`);
  return {...process.env,FONTCONFIG_FILE:file};
}
async function convert(soffice,profile,file,outDir,target,timeoutMs){
  await mkdir(outDir,{recursive:true});
  await run(soffice,[`-env:UserInstallation=${pathToFileURL(profile).href}`,'--headless','--norestore','--nologo','--convert-to',target,'--outdir',outDir,file],{timeout:timeoutMs,maxBuffer:4*1024*1024,env:await fontEnvironment(profile)});
}
/** Renders every page (up to maxPages) of a document to PNG files in outDir. */
export async function renderDocumentPages(file,{outDir,soffice,timeoutMs=120000,maxPages=12}={}){
  if(typeof file!=='string'||!file||typeof outDir!=='string'||!outDir)throw new Error('render_arguments_invalid');
  const binary=await findSoffice({soffice});
  // A file this renderer cannot convert is refused before looking for LibreOffice, on any machine.
  const filter=FILTERS[path.extname(file).toLowerCase()];if(!filter)return {status:'unavailable',reason:'format_unsupported',engine:null,pages:[],pageCount:0};
  if(!binary)return {status:'unavailable',reason:'soffice_missing',engine:null,pages:[],pageCount:0};
  const base=path.basename(file,path.extname(file)),profile=path.join(outDir,'.profile');
  try{
    await mkdir(profile,{recursive:true});
    await convert(binary,profile,file,outDir,'pdf',timeoutMs);
    const pdf=path.join(outDir,base+'.pdf');await access(pdf);
    const count=await pageCount(pdf),pages=[];
    for(let page=1;page<=Math.min(count,maxPages);page++){
      const scratch=path.join(outDir,`.page-${page}`);
      await convert(binary,profile,file,scratch,`png:${filter}:${JSON.stringify({PageRange:{type:'string',value:String(page)}})}`,timeoutMs);
      const made=(await readdir(scratch)).find(name=>name.toLowerCase().endsWith('.png'));if(!made)break;
      const target=path.join(outDir,`page-${page}.png`);await rename(path.join(scratch,made),target);await rm(scratch,{recursive:true,force:true});
      pages.push({index:page,path:target});
    }
    return {status:pages.length?'rendered':'unavailable',...(pages.length?{}:{reason:'no_pages'}),engine:'libreoffice',pdf,pageCount:count,pages};
  }catch(error){
    return {status:'unavailable',reason:error?.killed?'render_timeout':'convert_failed',engine:'libreoffice',pages:[],pageCount:0,detail:String(error?.message??error).slice(0,200)};
  }
}
/** The source and its filled copy side by side, each in its own folder under outDir. */
export async function renderBeforeAfter({source,copy,outDir,soffice,timeoutMs,maxPages}){
  const before=await renderDocumentPages(source,{outDir:path.join(outDir,'before'),soffice,timeoutMs,maxPages});
  const after=await renderDocumentPages(copy,{outDir:path.join(outDir,'after'),soffice,timeoutMs,maxPages});
  return {before,after};
}
