import {prepareEts,EtsFit,EtsError} from './libreoffice-ets.mjs';
export function etsFunctions(api){
 const cache=new Map(),err=type=>api.ErrorValueObject.create(api.ErrorType[type]),num=n=>Number.isFinite(n)?api.NumberValueObject.create(n):err('NUM');
 const scalar=x=>x?.isArray?.()?x.getFirstCell():x;
 const numeric=(x,fallback)=>{x=scalar(x);if(x===undefined||x.isNull?.())return fallback??0;if(x.isError())throw x;const v=x.convertToNumberObjectValue();if(v.isError())throw v;return v.getValue();};
 const vector=x=>{const cells=x?.isArray?.()?x.getArrayValue():[[x]];if(cells.length>1&&cells[0].length>1)throw err('VALUE');return cells.flat().map(v=>{if(v?.isError?.())throw v;if(!v?.isNumber?.())throw err('VALUE');return v.getValue();});};
 const get=(values,timeline,season,completion,aggregation,fit)=>{
  const args=[vector(values),vector(timeline),numeric(season,1),numeric(completion,1),numeric(aggregation,1)],key=JSON.stringify(args);
  let value=cache.get(key);if(!value){value={prepared:prepareEts(...args)};if(cache.size>=64)cache.delete(cache.keys().next().value);cache.set(key,value);}
  if(fit&&!value.fit)value.fit=new EtsFit(value.prepared);return fit?value.fit:value.prepared;
 };
 const guard=f=>{try{return f();}catch(e){if(e instanceof EtsError)return err(e.code);if(e?.isError?.())return e;throw e;}};
 const normal=api.ALL_IMPLEMENTED_FUNCTIONS.find(([,name])=>name==='NORM.S.INV')?.[0];
 class Forecast extends api.BaseFunction{minParams=3;maxParams=6;calculate(target,values,timeline,season,completion,aggregation){return guard(()=>num(get(values,timeline,season,completion,aggregation,true).forecast(numeric(target))));}}
 class Seasonality extends api.BaseFunction{minParams=2;maxParams=4;calculate(values,timeline,completion,aggregation){return guard(()=>num(get(values,timeline,undefined,completion,aggregation,false).period));}}
 class Statistic extends api.BaseFunction{minParams=3;maxParams=6;calculate(values,timeline,type,season,completion,aggregation){return guard(()=>num(get(values,timeline,season,completion,aggregation,true).statistic(numeric(type))));}}
 class Confidence extends api.BaseFunction{minParams=3;maxParams=7;calculate(target,values,timeline,level,season,completion,aggregation){return guard(()=>num(get(values,timeline,season,completion,aggregation,true).confidence(numeric(target),numeric(level,.95),p=>new normal('NORM.S.INV').calculate(num(p)).getValue())));}}
 return[[Forecast,'FORECAST.ETS'],[Seasonality,'FORECAST.ETS.SEASONALITY'],[Statistic,'FORECAST.ETS.STAT'],[Confidence,'FORECAST.ETS.CONFINT']];
}
