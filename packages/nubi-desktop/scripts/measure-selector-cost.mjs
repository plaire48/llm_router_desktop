// Plan 2a task 1: does a rightmost :is() (checked against every element) cost more than the same rules expanded into
// class-keyed selectors? Chrome headless, CPU 4x slower, 3,000 elements, 1,000 rules, a full-document recalculation
// forced by toggling a class on <body>; median of 20 timings per form.
import {chromium} from 'playwright';
const ELEMENTS=3000,RULES=1000,ROUNDS=20;
const body=Array.from({length:ELEMENTS},(_,i)=>`<div class="c${i%RULES}"><span data-k class="${i%2?'k1':'k2'}">x</span><i>y</i></div>`).join('');
const forms={
 is:Array.from({length:RULES},(_,i)=>`.t .c${i} :is(.k1,.k2){color:rgb(${i%255},0,0)}`).join('\n'),
 expanded:Array.from({length:RULES},(_,i)=>`.t .c${i} .k1,.t .c${i} .k2{color:rgb(${i%255},0,0)}`).join('\n'),
 star:Array.from({length:RULES},(_,i)=>`.t .c${i} *{color:rgb(${i%255},0,0)}`).join('\n'),
 attribute:Array.from({length:RULES},(_,i)=>`.t .c${i} [data-k]{color:rgb(${i%255},0,0)}`).join('\n'),
 tag:Array.from({length:RULES},(_,i)=>`.t .c${i} span{color:rgb(${i%255},0,0)}`).join('\n')};
const browser=await chromium.launch({channel:'chrome',headless:true});const result={};
try{for(const [name,css] of Object.entries(forms)){
 const page=await browser.newPage();await page.setContent(`<style>${css}</style>${body}`);
 const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
 const times=await page.evaluate(rounds=>{const out=[];const probe=document.querySelector('span');for(let r=0;r<rounds;r++){document.body.classList.toggle('t');const start=performance.now();getComputedStyle(probe).color;document.body.offsetHeight;out.push(performance.now()-start);}return out;},ROUNDS);
 times.sort((a,b)=>a-b);result[name]={medianMs:Math.round(times[Math.floor(times.length/2)]*10)/10,minMs:Math.round(times[0]*10)/10,maxMs:Math.round(times.at(-1)*10)/10};await page.close();}}
finally{await browser.close();}
console.log(JSON.stringify(result));
