// Optional headless draft functions. No network, Office process or DLL is opened.
import {DOMParser} from '@xmldom/xmldom';
import xpath from 'xpath';
import {XMLValidator} from 'fast-xml-parser';
import {decliningDepreciation} from './libreoffice-depreciation.mjs';
const rates={EUR:[1,2],BEF:[40.3399,0],LUF:[40.3399,0],DEM:[1.95583,2],ESP:[166.386,0],FRF:[6.55957,2],IEP:[0.787564,2],ITL:[1936.27,0],NLG:[2.20371,2],ATS:[13.7603,2],PTE:[200.482,0],FIM:[5.94573,2],GRD:[340.75,0],SIT:[239.64,2]};
// Excel's Euro Currency Tools rounds the intermediary to decimal places (the
// official worked example uses 0.152 EUR), then applies target calculation precision.
const round=(n,p)=>{const scale=10**p;if(!Number.isFinite(scale)||Math.abs(n)*scale>=2**52)return n;return Math.sign(n)*Math.round(Math.abs(n)*scale*(1+Number.EPSILON))/scale;};
export function missingFunctions(api,context){
 const err=type=>api.ErrorValueObject.create(api.ErrorType[type]),num=n=>Number.isFinite(n)?api.NumberValueObject.create(n):err('NUM'),text=s=>api.StringValueObject.create(s);
 const scalar=x=>x?.isArray?.()?x.getFirstCell():x;
 const number=(x,fallback)=>{x=scalar(x);if(x===undefined||x.isNull?.())return num(fallback??0);return x.convertToNumberObjectValue();};
 const yearfrac=api.ALL_IMPLEMENTED_FUNCTIONS.find(([,name])=>name==='YEARFRAC')?.[0];
 class EuroConvert extends api.BaseFunction{
  minParams=3;maxParams=5;
  calculate(amount,source,target,full,precision){
   if([amount,source,target,full,precision].some(x=>x?.isArray?.()&&(x.getRowCount()>1||x.getColumnCount()>1)))return err('VALUE');
   const args=[number(amount),scalar(source),scalar(target),number(full,0),precision===undefined||precision.isNull?.()?undefined:number(precision)],error=args.find(x=>x?.isError?.());if(error)return error;
   const [a,s,t,f,p]=args,from=rates[String(s.getValue()).toUpperCase()],to=rates[String(t.getValue()).toUpperCase()];
   if(!from||!to||(p&&Math.trunc(p.getValue())<3))return err('VALUE');
   if(String(s.getValue()).toUpperCase()===String(t.getValue()).toUpperCase())return a;
   let euros=a.getValue()/from[0];
   if(p&&from[0]!==1)euros=round(euros,Math.min(308,Math.trunc(p.getValue())));
   const result=euros*to[0];return num(f.getValue()?result:round(result,to[1]));
  }
 }
 class AmorDegrc extends api.BaseFunction{
  minParams=6;maxParams=7;
  calculate(...input){
   const values=Array.from({length:7},(_,i)=>number(input[i],0)),error=values.find(v=>v.isError());if(error)return error;
   let [cost,start,end,salvage,period,rate,basis]=values.map(v=>v.getValue());start=Math.trunc(start);end=Math.trunc(end);period=Math.trunc(period);basis=Math.trunc(basis);
   if(cost<=0||start<0||end<start||salvage<0||salvage>cost||period<0||rate<=0||![0,1,3,4].includes(basis)||period>100000)return err('NUM');
   const life=1/rate;if(life<3||(life>4&&life<5))return err('NUM');
   const fraction=new yearfrac('YEARFRAC').calculate(num(start),num(end),num(basis));if(fraction.isError())return fraction;
   return num(decliningDepreciation(cost,salvage,period,rate,fraction.getValue()));
  }
 }
 class FilterXml extends api.BaseFunction{
  minParams=2;maxParams=2;
  calculate(xml,path){
   const input=[scalar(xml),scalar(path)],error=input.find(v=>v?.isError?.());if(error)return error;
   if(!input.every(v=>v?.isString?.()))return err('VALUE');const [source,query]=input.map(v=>v.getValue());
   // Bounded local XML only. DTDs have no Office draft requirement and must not
   // trigger external entity access or expansion. Use full XPath, not path splitting.
   if(!source||source.length>32767||!query||query.length>8192||/<!DOCTYPE|<!ENTITY/i.test(source)||XMLValidator.validate(source)!==true)return err('VALUE');
   try{
    let invalid=false;const document=new DOMParser({errorHandler:{warning(){invalid=true;},error(){invalid=true;},fatalError(){invalid=true;}}}).parseFromString(source,'application/xml');if(invalid)return err('VALUE');
    const nodes=xpath.selectWithResolver(query,document,{lookupNamespaceURI:prefix=>document.documentElement.lookupNamespaceURI(prefix)});if(!Array.isArray(nodes)||!nodes.length||nodes.length>400)return err('VALUE');
    return api.ArrayValueObject.create({calculateValueList:nodes.map(node=>[text(node.nodeType===2?node.value:node.textContent??node.nodeValue??'')]),rowCount:nodes.length,columnCount:1,unitId:'',sheetId:'',row:-1,column:-1});
   }catch{return err('VALUE');}
  }
 }
 class Info extends api.BaseFunction{
  minParams=1;maxParams=1;
  calculate(kind){kind=scalar(kind);if(kind?.isError?.())return kind;if(!kind?.isString?.())return err('VALUE');const key=kind.getValue().toLowerCase();if(['memavail','memused','totmem'].includes(key))return err('NA');const value=context[key];return typeof value==='number'?num(value):typeof value==='string'?text(value):err('VALUE');}
 }
 return [[EuroConvert,'EUROCONVERT'],[AmorDegrc,'AMORDEGRC'],[FilterXml,'FILTERXML'],[Info,'INFO']];
}
