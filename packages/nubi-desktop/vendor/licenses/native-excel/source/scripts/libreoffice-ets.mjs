/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. See ../vendor/calculation-reference/libreoffice/COPYING.MPL.
 * Adapted from ScETSForecastCalculation in LibreOffice interpr8.cxx,
 * revision 9d375606275c5e71391d905e68d2e59a51d9833f.
 * Changes: bounded JS arrays; corrected duplicate averaging and gap validation;
 * additive base initialization subtracts the seasonal effect; analytic additive
 * confidence intervals replace random simulation (no reproducibility claim for
 * LibreOffice's seasonal intervals). See the accompanying provenance manifest.
 */
export class EtsError extends Error {constructor(code){super(code);this.code=code;}}
const fail=code=>{throw new EtsError(code);};
const mean=a=>sum(a)/a.length;
// Stable sums matter when the search compares almost identical squared errors.
function sum(a){let result=0,c=0;for(const x of a){const y=x-c,t=result+y;c=(t-result)-y;result=t;}return result;}
function date(serial){return new Date((Math.trunc(serial)-25569)*86400000);}
function month(serial,day){const d=date(serial),length=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();return d.getUTCFullYear()*12+d.getUTCMonth()+1+(d.getUTCDate()-day)/length;}
function seasonLength(y){
 let best=y.length,error=Infinity;
 for(let p=Math.floor(y.length/2);p>=1;p--){const periods=Math.floor(y.length/p),start=y.length-periods*p+1,errors=[];for(let i=start;i<y.length-p;i++)errors.push(Math.abs(y[i]-y[i-1]-y[p+i]+y[p+i-1]));const count=(periods-1)*p-1;if(count<=0)continue;const e=sum(errors)/count;if(e<=error||e===0){best=p;error=e;}}
 return best===y.length?1:best;
}
export function prepareEts(values,timeline,seasonality=1,completion=1,aggregation=1){
 if(values.length!==timeline.length)fail('NA');
 if(values.length<2||values.length>400||![...values,...timeline].every(Number.isFinite))fail('VALUE');
 if(!Number.isInteger(seasonality)||seasonality<0||seasonality>8760||![0,1].includes(completion)||!Number.isInteger(aggregation)||aggregation<1||aggregation>7)fail('NUM');
 let data=timeline.map((x,i)=>({x,y:values[i]})).sort((a,b)=>a.x-b.x);
 const day=date(data[0].x).getUTCDate(),monthly=data.every(p=>date(p.x).getUTCDate()===day)&&new Set(data.map(p=>month(p.x,day))).size>1;
 if(monthly)data=data.map(p=>({x:month(p.x,day),y:p.y}));
 const grouped=[];
 for(let i=0;i<data.length;){const x=data[i].x,ys=[];while(i<data.length&&data[i].x===x)ys.push(data[i++].y);const sorted=[...ys].sort((a,b)=>a-b),middle=Math.floor(ys.length/2);const y=aggregation===1?mean(ys):aggregation===2||aggregation===3?ys.length:aggregation===4?Math.max(...ys):aggregation===5?ys.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2:aggregation===6?Math.min(...ys):sum(ys);grouped.push({x,y});}
 if(grouped.length<2)fail('VALUE');
 const step=Math.min(...grouped.slice(1).map((p,i)=>p.x-grouped[i].x));
 if(!(step>0))fail('VALUE');
 const filled=[grouped[0]];let missing=0;
 for(let i=1;i<grouped.length;i++){
  const count=(grouped[i].x-grouped[i-1].x)/step,nearest=Math.round(count);
  if(Math.abs(count-nearest)>1e-8)fail('NUM');if(nearest>600)fail('NUM');
  missing+=nearest-1;if(missing/(grouped.length+missing)>.3)fail('VALUE');
  for(let j=1;j<nearest;j++)filled.push({x:grouped[i-1].x+j*step,y:completion?mean([grouped[i-1].y,grouped[i].y]):0});
  filled.push(grouped[i]);
 }
 if(filled.length>600)fail('NUM');
 const y=filled.map(p=>p.y),period=seasonality===1?seasonLength(y):seasonality;
 if(period>1&&y.length<period*2)fail('VALUE');
 return {data:filled,step,period,monthly,day};
}
export class EtsFit{
 constructor(prepared){
  Object.assign(this,prepared);this.y=this.data.map(p=>p.y);const n=this.y.length,p=this.period;
  this.level=Array(n).fill(0);this.trend=Array(n).fill(0);this.season=Array(n).fill(0);this.fitted=Array(n).fill(0);this.fitted[0]=this.y[0];this.alpha=0;this.beta=0;this.gamma=0;
  if(p<=1){this.level[0]=this.y[0];this.trend[0]=(this.y[n-1]-this.y[0])/(n-1);}
  else{
   this.trend[0]=sum(Array.from({length:p},(_,i)=>this.y[i+p]-this.y[i]))/(p*p);
   const periods=Math.floor(n/p),averages=Array.from({length:periods},(_,i)=>mean(this.y.slice(i*p,(i+1)*p)));
   for(let j=0;j<p;j++)this.season[j]=mean(averages.map((a,i)=>this.y[i*p+j]-(a+(j-.5*(p-1))*this.trend[0])));
   this.level[0]=this.y[0]-this.season[0];
  }
  this.initialSeason=this.season.slice(0,p);
  // Nested bounded optimization retains the upstream 0.001 coefficient resolution.
  this.optimize('alpha',()=>p<=1?this.optimize('gamma'):this.optimize('beta',()=>this.optimize('gamma')));
 }
 refill(){
  const n=this.y.length,p=this.period;
  if(p>1)for(let i=0;i<p;i++)this.season[i]=this.initialSeason[i];
  for(let i=1;i<n;i++){
   if(p<=1){this.level[i]=this.alpha*this.y[i]+(1-this.alpha)*(this.level[i-1]+this.trend[i-1]);this.fitted[i]=this.level[i-1]+this.trend[i-1];}
   else{const j=i>=p?i-p:i,season=this.season[j];this.level[i]=this.alpha*(this.y[i]-season)+(1-this.alpha)*(this.level[i-1]+this.trend[i-1]);this.season[i]=this.beta*(this.y[i]-this.level[i])+(1-this.beta)*season;this.fitted[i]=this.level[i-1]+this.trend[i-1]+season;}
   this.trend[i]=this.gamma*(this.level[i]-this.level[i-1])+(1-this.gamma)*this.trend[i-1];
  }
  const errors=this.y.slice(1).map((v,i)=>this.fitted[i+1]-v),absolute=errors.map(Math.abs);
  this.mae=mean(absolute);this.mse=mean(errors.map(e=>e*e));this.rmse=Math.sqrt(this.mse);
  const divisor=mean(this.y.slice(2).map((v,i)=>Math.abs(v-this.y[i+1])));this.mase=divisor===0?(this.mae===0?0:Infinity):this.mae/divisor;
  this.smape=mean(errors.map((e,i)=>{const d=Math.abs(this.fitted[i+1])+Math.abs(this.y[i+1]);return d===0?0:2*Math.abs(e)/d;}));
 }
 optimize(key,nested=()=>{}){
  let lo=0,hi=1,mid=.5;
  const run=value=>{this[key]=value;nested();this.refill();return this.mse;};
  let elo=run(lo),ehi=run(hi),e=run(mid);
  if(elo===e&&e===ehi){run(0);return;}
  while(hi-mid>.001){if(ehi>elo){hi=mid;ehi=e;mid=(lo+mid)/2;}else{lo=mid;elo=e;mid=(mid+hi)/2;}e=run(mid);}
  if(ehi>elo){if(elo<e)run(lo);}else if(ehi<e)run(hi);
 }
 target(x){return this.monthly?month(x,this.day):x;}
 forecast(x){
  const target=this.target(x),first=this.data[0].x,last=this.data.at(-1).x,n=this.y.length,p=this.period;
  if(!Number.isFinite(target)||target<last)fail('NUM');
  if(target<=last){const position=(target-first)/this.step,index=Math.floor(position),fraction=position-index;return this.y[index]+(fraction?fraction*(this.fitted[index+1]-this.y[index]):0);}
  const distance=(target-last)/this.step,h=Math.floor(distance),fraction=distance-h;
  const ahead=k=>this.level[n-1]+k*this.trend[n-1]+(p>1?this.season[n-p+((k-1)%p+p)%p]:0);
  return ahead(h)+(fraction?fraction*(ahead(h+1)-ahead(h)):0);
 }
 statistic(type){if(!Number.isInteger(type)||type<1||type>8)fail('NUM');return[this.alpha,this.gamma,this.beta,this.mase,this.smape,this.mae,this.rmse,this.step][type-1];}
 // Additive state-space variance: each innovation contributes level, trend and
 // (at multiples of the period) seasonal effects. The caller supplies the existing
 // normal inverse implementation; no pseudo-random confidence bounds are used.
 confidence(x,level,normalInverse){
  if(!(level>=0&&level<1))fail('NUM');const horizon=(this.target(x)-this.data.at(-1).x)/this.step;
  if(!(horizon>0)||horizon>2000)fail('NUM');if(level===0||this.rmse===0)return 0;
  const variance=h=>{let v=1;for(let j=1;j<h;j++){const effect=this.alpha+this.alpha*this.gamma*j+(this.period>1&&j%this.period===0?this.beta*(1-this.alpha):0);v+=effect*effect;}return v;};
  const lower=Math.floor(horizon),fraction=horizon-lower;
  const width=h=>normalInverse((1+level)/2)*this.rmse*Math.sqrt(variance(h));
  return width(Math.max(1,lower))+(fraction?fraction*(width(lower+1)-width(Math.max(1,lower))):0);
 }
}
