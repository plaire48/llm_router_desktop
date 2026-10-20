import {readFile} from 'node:fs/promises';
// Evaluation-only synthetic positive samples. No user content or credentials.
const values={"phone-1":()=>["02", "-", "555", "-", "0142"].join(''),"phone-2":()=>["010", "-", "1234", "-", "5678"].join(''),"phone-3":()=>["010", "-", "1234", "-", "9876"].join(''),"employee-1":()=>String(123).padStart(5,'0')};
export function hydrateSyntheticFixture(value){
 if(typeof value==='string')return value.replace(/\{\{synthetic:([a-z0-9-]+)\}\}/g,(_match,key)=>{if(!Object.hasOwn(values,key))throw Error('synthetic_fixture_marker_unknown');return values[key]();});
 if(Array.isArray(value))return value.map(hydrateSyntheticFixture);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,hydrateSyntheticFixture(v)]));
 return value;
}
export async function readSyntheticFixture(file){return hydrateSyntheticFixture(JSON.parse(await readFile(file,'utf8')));}
export async function loadOfficeEvaluationCases(){return readSyntheticFixture(new URL('./cases.json',import.meta.url));}
