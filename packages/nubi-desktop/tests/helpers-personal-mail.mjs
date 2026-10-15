import {PersonalMail as RuntimePersonalMail} from '../runtime/mail.mjs';
// Explicit test-only substitute for Electron's OS-backed connection vault.
// Scoped by temporary storage root so reopen tests use the same key.
const stores=new Map();
export class PersonalMail extends RuntimePersonalMail{
 constructor(host,options){
  if(!Object.hasOwn(host,'connectionVault')){
   let values=stores.get(host.storageRoot);if(!values){values=new Map();stores.set(host.storageRoot,values);}
   host={...host,connectionVault:{get:async key=>{if(key!=='mail-raw-key')throw Error('fixture_scope');return values.get(key)||null;},set:async(key,value)=>{if(key!=='mail-raw-key')throw Error('fixture_scope');values.set(key,value);}}};
  }
  super(host,options);
 }
}
