import JSZip from 'jszip';
import {XMLValidator} from 'fast-xml-parser';
import {fail} from './contracts.js';
/** Bounded structural check for our own new, unencrypted output only. Not a general document reader. */
export async function inspectPackage(bytes:Uint8Array,domain:string) {
  const bad=()=>fail(`generated_${domain}_invalid`);
  if(!(bytes instanceof Uint8Array)||bytes.length>8_000_000||bytes[0]!==0x50||bytes[1]!==0x4b)bad();
  const zip=await JSZip.loadAsync(bytes),entries=Object.values(zip.files);let total=0,external=false;
  if(entries.length>300)bad();
  for(const entry of entries){
    const size=(entry as unknown as {_data?:{uncompressedSize:number}})._data?.uncompressedSize??0;total+=size;
    if(size>4_000_000||total>16_000_000)bad();
    if(entry.name.endsWith('.xml')||entry.name.endsWith('.rels')){
      const xml=await entry.async('string');if(xml.length>4_000_000||/<!DOCTYPE|<!ENTITY/i.test(xml)||XMLValidator.validate(xml)!==true)bad();
      if(entry.name.endsWith('.rels')&&/TargetMode\s*=\s*['"]External['"]/i.test(xml))external=true;
    }
  }
  return {zip,hasExternalRelationships:external,hasMacros:entries.some(e=>/vbaProject/i.test(e.name))};
}
