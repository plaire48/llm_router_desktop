import test from 'node:test';import assert from 'node:assert/strict';
import {prepareEts,EtsFit} from '../scripts/libreoffice-ets.mjs';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
test('ETS rejects a target inside the historical timeline instead of returning observed data',()=>{
 const fit=new EtsFit(prepareEts([1,3,5,7],[1,2,3,4],0));assert.throws(()=>fit.forecast(3),e=>e.code==='NUM');
});
test('ETS rejects an irregular timeline and checks every gap',()=>{
 assert.throws(()=>prepareEts([1,2,3,4,5],[1,2,4,5,6.5],0),e=>e.code==='NUM');
});
test('ETS averages duplicate times, supports every aggregation and fills missing points',()=>{
 const wanted=[3,2,2,5,3,1,6];
 for(let a=1;a<=7;a++){const p=prepareEts([1,5,7,9],[1,1,2,3],0,1,a);near(p.data[0].y,wanted[a-1]);}
 assert.deepEqual(prepareEts([2,6,8],[1,3,4],0).data.map(p=>p.y),[2,4,6,8]);
 assert.deepEqual(prepareEts([2,6,8],[1,3,4],0,0).data.map(p=>p.y),[2,0,6,8]);
 assert.deepEqual(prepareEts([2,10],[1,5],0).data.map(p=>p.x),[1,5]); // Step 4, no invented missing data.
});
test('ETS additive seasonality handles zero-mean cycles, scales and shifts',()=>{
 const x=Array.from({length:24},(_,i)=>i+1),season=[3,-2,1,-2];
 for(const scale of [-2,0,3])for(const offset of [0,100]){const y=x.map((v,i)=>offset+scale*(10+2*i+season[i%4])),fit=new EtsFit(prepareEts(y,x,4));near(fit.forecast(25),offset+scale*61);near(fit.forecast(26),offset+scale*58);}
});
test('ETS confidence uses additive innovation variance across horizons and confidence levels',()=>{
 const fit=new EtsFit(prepareEts([1,3,5,7],[1,2,3,4],0));
 // Fit parameters fixed to isolate interval propagation; the one-step variance
 // is 4, then 4*(1+(0.2+0.2*0.5)^2) = 4.36.
 Object.assign(fit,{alpha:.2,gamma:.5,beta:.4,rmse:2});
 near(fit.confidence(5,.95,()=>1.959963984540054),3.919927969080108);
 near(fit.confidence(6,.95,()=>1.959963984540054),4.092524949004757);
 assert.throws(()=>fit.confidence(5,1,()=>Infinity),e=>e.code==='NUM');
});
test('ETS repeated fit evaluation keeps the same initial seasonal state',()=>{
 const x=Array.from({length:24},(_,i)=>i+1),y=x.map((i)=>20+2*i+[3,-2,1,-2][(i-1)%4]+(i%5-2));
 const fit=new EtsFit(prepareEts(y,x,4)),before=[fit.forecast(28),fit.rmse,...fit.season];fit.refill();const after=[fit.forecast(28),fit.rmse,...fit.season];
 assert.deepEqual(after,before);
});
test('ETS one-step seasonal residual uses the prior season, before updating it',()=>{
 const fit=new EtsFit(prepareEts([13,14,15,16,17,18,19,20],[1,2,3,4,5,6,7,8],4));
 Object.assign(fit,{alpha:.2,beta:.4,gamma:.5,level:[10],trend:[2],season:[3,-2,1,-2,0,0,0,0],initialSeason:[3,-2,1,-2]});fit.refill();
 // Prior base 10 + trend 2 + seasonal effect -2 = 10. Y=14's
 // residual must not be reduced by updating its own seasonal effect first.
 near(fit.fitted[1],10);
});
