import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileMotion,parseAmbientRegistry,installMotionPolicy} from '../ui/motion-policy.mjs';
import {springSamples} from '../scripts/motion-spring.mjs';

function animation(name,{repeat=false,target={},duration=280,properties=['opacity']}={}){
 const value={animationName:name,currentTime:47,playState:'running',cancelled:false,paused:false,
  effect:{target,getTiming:()=>({duration,iterations:repeat?Infinity:1}),getKeyframes:()=>properties.map(key=>({[key]:'1'}))},
  pause(){this.playState='paused';this.paused=true;},play(){this.playState='running';this.paused=false;},cancel(){this.cancelled=true;this.playState='idle';}};
 return value;
}
const registry=parseAmbientRegistry('bird:8000:transform,opacity;progress:1800:transform');
test('modal surface and live text remain synchronized when a hovered button consumes motion budget',()=>{
 const surface=animation('',{properties:['transform']}),content=animation('',{properties:['transform']});surface.id='nubi-modal-surface';content.id='nubi-modal-content';
 const scrim=animation('nubi-modal-scrim-in'),hover=animation('color');hover.transitionProperty='background-color';
 const stats=reconcileMotion([hover,surface,content,scrim],{registry,paused:true,owned:new Set()});
 assert.equal(stats.interactionTargets,3);assert.equal(surface.cancelled,false);assert.equal(content.cancelled,false);assert.equal(scrim.cancelled,false);assert.equal(hover.cancelled,true);
});
test('ambient registry requires named durations and compositor properties',()=>{
 assert.equal(registry.get('bird').duration,8000);assert.deepEqual(registry.get('bird').properties,['transform','opacity']);
 assert.throws(()=>parseAmbientRegistry('bird:8000:width'),/property/);
 assert.throws(()=>parseAmbientRegistry('bird:0:opacity'),/duration/);
});
test('registered ambient pauses and resumes its exact phase and unknown loops are cancelled',()=>{
 const bird=animation('bird',{repeat:true,duration:8000,properties:['transform']}),unknown=animation('unknown',{repeat:true});
 const owned=new Set();reconcileMotion([bird,unknown],{registry,paused:true,owned});assert.equal(bird.currentTime,47);assert.equal(bird.playState,'paused');assert.equal(unknown.cancelled,true);
 reconcileMotion([bird],{registry,paused:false,owned});assert.equal(bird.currentTime,47);assert.equal(bird.playState,'running');
});
test('externally paused ambient is not resumed by motion cleanup',()=>{
 const bird=animation('bird',{repeat:true,duration:8000,properties:['opacity']});bird.playState='paused';
 reconcileMotion([bird],{registry,paused:false,owned:new Set()});assert.equal(bird.playState,'paused');
});
test('top-modal progress fills continue over paused decoration and stop in hidden windows',()=>{
 const progressRegistry=parseAmbientRegistry('nubi-progress-pending:12000:transform');
 const target={matches:selector=>selector==='.nubi-progress>span',closest:selector=>selector==='.cx-panel-backdrop[data-modal-top=true]'?{}:null};
 const fill=animation('nubi-progress-pending',{duration:12000,properties:['transform'],target}),owned=new Set();
 reconcileMotion([fill],{registry:progressRegistry,paused:true,progressPaused:false,owned});assert.equal(fill.playState,'running');assert.equal(fill.cancelled,false);
 reconcileMotion([fill],{registry:progressRegistry,paused:true,progressPaused:true,owned});assert.equal(fill.playState,'paused');assert.equal(fill.currentTime,47);
 reconcileMotion([fill],{registry:progressRegistry,paused:true,progressPaused:false,owned});assert.equal(fill.playState,'running');assert.equal(fill.currentTime,47);
 const covered=animation('nubi-progress-pending',{duration:12000,properties:['transform'],target:{matches:()=>true,closest:()=>null}});
 reconcileMotion([covered],{registry:progressRegistry,paused:true,progressPaused:false,owned});assert.equal(covered.playState,'paused','only the top modal bypasses the background pause');
});
test('only the registered progress fill can use a slow transform transition',()=>{
 const progressRegistry=parseAmbientRegistry('nubi-progress-fill:600:transform'),owned=new Set();
 const fill=animation('',{duration:600,properties:['transform'],target:{matches:()=>true}});fill.transitionProperty='transform';
 const unrelated=animation('',{duration:600,properties:['transform'],target:{matches:()=>false}});unrelated.transitionProperty='transform';
 const wrong=animation('',{duration:800,properties:['transform'],target:{matches:()=>true}});wrong.transitionProperty='transform';
 const layout=animation('',{duration:600,properties:['width'],target:{matches:()=>true}});layout.transitionProperty='width';
 reconcileMotion([fill,unrelated,wrong,layout],{registry:progressRegistry,paused:false,owned});
 assert.equal(fill.cancelled,false);assert([unrelated,wrong,layout].every(value=>value.cancelled));
});
test('project opening holds covered motion while visible progress respects visibility and reduced motion',()=>{
 const bird=animation('bird',{repeat:true,duration:8000,properties:['opacity']}),progress=animation('progress',{repeat:true,duration:1800,properties:['transform'],target:{closest:selector=>selector==='.nubi-project-switch-cover'?{}:null}}),owned=new Set();
 reconcileMotion([bird,progress],{registry,paused:false,projectSwitching:true,owned});assert.equal(bird.playState,'paused');assert.equal(progress.playState,'running');
 reconcileMotion([bird,progress],{registry,paused:true,projectSwitching:true,owned});assert.equal(progress.playState,'paused','hidden/reduced motion still holds the visible loader');
 reconcileMotion([bird,progress],{registry,paused:false,projectSwitching:true,owned});assert.equal(bird.playState,'paused');assert.equal(progress.playState,'running');
 reconcileMotion([bird,progress],{registry,paused:false,projectSwitching:false,owned});assert.equal(bird.playState,'running');assert.equal(bird.currentTime,47,'completion resumes the previous ambient phase');
});
test('interaction budget counts targets and retains modal before decorative entrances',()=>{
 const target={},a=animation('nubi-modal-sheet-in',{target}),b=animation('color',{target}),c=animation('nubi-modal-scrim-in'),d=animation('press'),extra=animation('decoration');
 const stats=reconcileMotion([extra,a,b,c,d],{registry,paused:true,owned:new Set()});
 assert.equal(stats.interactionTargets,3);assert.equal(extra.cancelled,true);assert.equal(a.cancelled,false);assert.equal(b.cancelled,false);
});
test('project loading entrance and stage change remain visible when covered controls are transitioning',()=>{
 const hover=animation('hover'),sidebar=animation('sidebar'),press=animation('press'),entrance=animation('nubi-view-project-loader-enter',{properties:['opacity','transform']}),stage=animation('nubi-view-project-stage-reveal');
 for(const effect of [hover,sidebar])effect.transitionProperty='opacity';
 const stats=reconcileMotion([hover,sidebar,press,entrance,stage],{registry,paused:false,projectSwitching:true,owned:new Set()});
 assert.equal(stats.interactionTargets,3);assert.equal(entrance.cancelled,false);assert.equal(stage.cancelled,false);assert.ok([hover,sidebar,press].some(effect=>effect.cancelled));
});
test('unregistered long, non-compositor and incorrect ambient duration fail closed',()=>{
 const long=animation('long',{duration:900}),layout=animation('layout',{properties:['width']}),wrong=animation('bird',{duration:900,repeat:true,properties:['opacity']});
 reconcileMotion([long,layout,wrong],{registry,paused:false,owned:new Set()});assert.ok([long,layout,wrong].every(a=>a.cancelled));
});
test('state colors and bounded list height are the only property exceptions',()=>{
 const color=animation('state',{properties:['backgroundColor']}),list=animation('nubi-list-enter',{duration:180,properties:['height','opacity']}),shadow=animation('shadow',{properties:['boxShadow']});
 reconcileMotion([color,list,shadow],{registry,paused:false,owned:new Set()});assert.equal(color.cancelled,false);assert.equal(list.cancelled,false);assert.equal(shadow.cancelled,true);
});
test('reduced motion preserves paused ambient and rejects spatial interactions',()=>{
 const bird=animation('bird',{repeat:true,duration:8000,properties:['opacity']}),spatial=animation('slide',{duration:120,properties:['transform']}),fade=animation('fade',{duration:120});
 reconcileMotion([bird,spatial,fade],{registry,paused:true,reduced:true,owned:new Set()});assert.equal(bird.playState,'paused');assert.equal(spatial.cancelled,true);assert.equal(fade.cancelled,false);
});
test('reduced state changes retain a 120ms color crossfade',()=>{
 const color=animation('state',{duration:120,properties:['backgroundColor']});reconcileMotion([color],{registry,paused:true,reduced:true,owned:new Set()});assert.equal(color.cancelled,false);
});
test('generated spring uses 300/26/1, starts at zero, finishes at one and overshoots at most 3 percent',()=>{
 const result=springSamples();assert.deepEqual(result.physics,{stiffness:300,damping:26,mass:1});assert.equal(result.values[0],0);assert.equal(result.values.at(-1),1);assert.ok(Math.max(...result.values)>1);assert.ok(Math.max(...result.values)<=1.03);assert.match(result.css,/^linear\(/);
});
test('shared policy owners dispose idempotently and do not remove another owner',()=>{
 const saved=Object.fromEntries(['matchMedia','getComputedStyle','MutationObserver','requestAnimationFrame','cancelAnimationFrame'].map(key=>[key,globalThis[key]]));let observers=0,disconnected=0;
 globalThis.matchMedia=()=>Object.assign(new EventTarget(),{matches:false});globalThis.getComputedStyle=()=>({getPropertyValue:()=>''});globalThis.MutationObserver=class{constructor(){observers++;}observe(){}disconnect(){disconnected++;}};globalThis.requestAnimationFrame=()=>1;globalThis.cancelAnimationFrame=()=>{};
 const doc=Object.assign(new EventTarget(),{hidden:false,documentElement:{hasAttribute:()=>false},getAnimations:()=>[]});
 try{const a=installMotionPolicy(doc),b=installMotionPolicy(doc);assert.equal(observers,1);a();a();assert.equal(disconnected,0);b();b();assert.equal(disconnected,1);}
 finally{for(const [key,value] of Object.entries(saved))if(value===undefined)delete globalThis[key];else globalThis[key]=value;}
});
test('stable named ambient effects read their property metadata once while duration remains live',()=>{
 const bird=animation('bird',{repeat:true,duration:8000,properties:['opacity']}),cache=new WeakMap(),owned=new Set();let reads=0;
 const frames=bird.effect.getKeyframes;bird.effect.getKeyframes=()=>{reads++;return frames();};
 for(let index=0;index<20;index++)reconcileMotion([bird],{registry,paused:false,owned,metadataCache:cache});
 assert.equal(reads,1,'repeated policy boundaries must not re-read stable CSS keyframes');
 bird.effect.getTiming=()=>({duration:900,iterations:Infinity});reconcileMotion([bird],{registry,paused:false,owned,metadataCache:cache});assert.equal(bird.cancelled,true,'duration changes are checked despite metadata reuse');
});
test('ambient metadata invalidates on name or effect replacement and arbitrary WAAPI frames stay live',()=>{
 const bird=animation('bird',{repeat:true,duration:8000,properties:['opacity']}),cache=new WeakMap(),owned=new Set();let reads=0;
 bird.effect.getKeyframes=()=>{reads++;return [{opacity:'1'}];};reconcileMotion([bird],{registry,paused:false,owned,metadataCache:cache});
 bird.animationName='progress';bird.effect.getTiming=()=>({duration:1800,iterations:Infinity});reconcileMotion([bird],{registry,paused:false,owned,metadataCache:cache});assert.equal(reads,2);assert.equal(bird.cancelled,true,'new name cannot reuse the old allowed property set');
 bird.playState='running';bird.cancelled=false;bird.animationName='bird';bird.effect={target:{},getTiming:()=>({duration:8000,iterations:Infinity}),getKeyframes:()=>[{width:'10px'}]};reconcileMotion([bird],{registry,paused:false,owned,metadataCache:cache});assert.equal(bird.cancelled,true,'a replaced effect is revalidated');
 const dynamic=animation('',{repeat:true,duration:8000,properties:['opacity']});dynamic.id='bird';let changed=false;dynamic.effect.getKeyframes=()=>changed?[{width:'10px'}]:[{opacity:'1'}];
 reconcileMotion([dynamic],{registry,paused:false,owned,metadataCache:cache});changed=true;reconcileMotion([dynamic],{registry,paused:false,owned,metadataCache:cache});assert.equal(dynamic.cancelled,true,'unnamed WAAPI effects are never cached');
});

test('stylesheet changes invalidate previously cached effect properties',()=>{
 const saved=Object.fromEntries(['matchMedia','getComputedStyle','MutationObserver','requestAnimationFrame','cancelAnimationFrame'].map(key=>[key,globalThis[key]])),listeners=new Map(),observers=[];let next,reads=0;const head=new EventTarget(),root={hasAttribute:()=>false,removeAttribute(){}},bird=animation('bird',{repeat:true,duration:8000}),keyframe={style:['opacity']};bird.effect.target={};
 globalThis.matchMedia=()=>Object.assign(new EventTarget(),{matches:false});globalThis.getComputedStyle=element=>element===root?{getPropertyValue:()=> 'bird:8000:opacity'}:{animationName:'bird',animationDuration:'8s'};globalThis.MutationObserver=class{constructor(callback){this.callback=callback;observers.push(this);}observe(target){this.target=target;}disconnect(){}};globalThis.requestAnimationFrame=callback=>{next=callback;return 1;};globalThis.cancelAnimationFrame=()=>{};
 const doc={hidden:false,head,documentElement:root,styleSheets:[{cssRules:[{type:7,name:'bird',cssRules:[keyframe]}]}],getAnimations:()=>{reads++;return [bird];},addEventListener:(name,listener)=>listeners.set(name,listener),removeEventListener(){}};let stop;
 try{stop=installMotionPolicy(doc);reads=0;listeners.get('animationstart')({type:'animationstart',animationName:'bird',target:bird.effect.target});next();assert.equal(reads,1);reads=0;
 keyframe.style=['width'];bird.effect.getKeyframes=()=>[{width:'10px'}];observers.find(observer=>observer.target===head).callback();next();assert.equal(reads,1);assert.equal(bird.cancelled,true,'a changed sheet cannot keep a stale allowed opacity signature');}
 finally{stop?.();for(const[key,value]of Object.entries(saved))if(value===undefined)delete globalThis[key];else globalThis[key]=value;}
});

test('view and modal boundaries coalesce animation discovery before the next paint',()=>{
 const saved=Object.fromEntries(['matchMedia','getComputedStyle','MutationObserver','requestAnimationFrame','cancelAnimationFrame'].map(key=>[key,globalThis[key]])),listeners=new Map(),observers=[];let next,reads=0,styles=0;
 const root={hasAttribute:()=>false,removeAttribute(){}},head=new EventTarget(),bird=animation('bird',{repeat:true,duration:8000,properties:['opacity']});
 globalThis.matchMedia=()=>Object.assign(new EventTarget(),{matches:false});globalThis.getComputedStyle=()=>{styles++;return {getPropertyValue:()=> 'bird:8000:opacity'};};globalThis.MutationObserver=class{constructor(callback){this.callback=callback;observers.push(this);}observe(target){this.target=target;}disconnect(){}};globalThis.requestAnimationFrame=callback=>{next=callback;return 1;};globalThis.cancelAnimationFrame=()=>{};
 const doc={hidden:false,head,documentElement:root,getAnimations:()=>{reads++;return [bird];},addEventListener:(name,listener)=>listeners.set(name,listener),removeEventListener(){}};let stop;
 try{stop=installMotionPolicy(doc);assert.equal(styles,0,'installation must not force style while React is mounting');assert.equal(reads,0,'initial discovery belongs to the next paint');for(let i=0;i<5;i++)listeners.get('nubi-motion-change')();observers.find(observer=>observer.target===root).callback();assert.equal(reads,0,'phase notifications must not repeatedly flush the whole document before React commits');next();assert.equal(reads,1,'one read reconciles all boundaries in the paint');assert.equal(styles,1);doc.hidden=true;listeners.get('visibilitychange')();assert.equal(bird.playState,'paused','a hidden window pauses immediately even without another paint');}
 finally{stop?.();for(const[key,value]of Object.entries(saved))if(value===undefined)delete globalThis[key];else globalThis[key]=value;}
});
// Decorative ambient loops are held while idle; status loops and the brand bird run (design light-flow §6).
test('decorative ambient loops are held, status loops and the brand bird keep running',async()=>{
 const {IDLE_AMBIENT_HELD}=await import('../ui/motion-policy.mjs');
 for(const name of ['nubi-pastel-flow','deck-twinkle','nubi-water-aura','bird-blink','bird-idle-base','nubi-bird-flight'])assert.ok(IDLE_AMBIENT_HELD.has(name),name);
 for(const name of ['nubi-brand-float','master-spin','nubi-live-spin','nubi-live-breathe','nubi-wiki-scan','nubi-progress-breathe'])assert.ok(!IDLE_AMBIENT_HELD.has(name),name);
 const reg=parseAmbientRegistry('nubi-pastel-flow:26000:transform;deck-twinkle:3000:opacity;nubi-brand-float:4000:transform;master-spin:800:transform');
 const pastel=animation('nubi-pastel-flow',{repeat:true,duration:26000,properties:['transform']}),twinkle=animation('deck-twinkle',{repeat:true,duration:3000,properties:['opacity']}),brand=animation('nubi-brand-float',{repeat:true,duration:4000,properties:['transform']}),spin=animation('master-spin',{repeat:true,duration:800,properties:['transform']});
 const owned=new Set();reconcileMotion([pastel,twinkle,brand,spin],{registry:reg,paused:false,owned,held:IDLE_AMBIENT_HELD});
 assert.deepEqual([pastel,twinkle,brand,spin].map(a=>a.playState),['paused','paused','running','running']);
 assert.equal(pastel.currentTime,47,'held, not cancelled');
});
test('a window shown again does not revive held decoration, while the brand bird resumes',()=>{
 const reg=parseAmbientRegistry('nubi-pastel-flow:26000:transform;nubi-brand-float:4000:transform');const held=new Set(['nubi-pastel-flow']);
 const pastel=animation('nubi-pastel-flow',{repeat:true,duration:26000,properties:['transform']}),brand=animation('nubi-brand-float',{repeat:true,duration:4000,properties:['transform']});
 const owned=new Set();
 reconcileMotion([pastel,brand],{registry:reg,paused:false,owned,held});
 reconcileMotion([pastel,brand],{registry:reg,paused:true,owned,held});assert.equal(brand.playState,'paused');
 reconcileMotion([pastel,brand],{registry:reg,paused:false,owned,held});
 assert.equal(pastel.playState,'paused');assert.equal(brand.playState,'running');
});
test('the installed policy holds a disallowed ambient loop while the app is idle',()=>{
 const saved=Object.fromEntries(['matchMedia','getComputedStyle','MutationObserver','requestAnimationFrame','cancelAnimationFrame'].map(key=>[key,globalThis[key]])),listeners=new Map();let next;const head=new EventTarget(),root={hasAttribute:()=>false,removeAttribute(){}},pastel=animation('nubi-pastel-flow',{repeat:true,duration:26000,properties:['transform']});pastel.effect.target={};
 globalThis.matchMedia=()=>Object.assign(new EventTarget(),{matches:false});globalThis.getComputedStyle=element=>element===root?{getPropertyValue:()=>'nubi-pastel-flow:26000:transform'}:{animationName:'nubi-pastel-flow',animationDuration:'26s'};globalThis.MutationObserver=class{constructor(callback){this.callback=callback;}observe(){}disconnect(){}};globalThis.requestAnimationFrame=callback=>{next=callback;return 1;};globalThis.cancelAnimationFrame=()=>{};
 const doc={hidden:false,head,documentElement:root,styleSheets:[{cssRules:[{type:7,name:'nubi-pastel-flow',cssRules:[{style:['transform']}]}]}],getAnimations:()=>[pastel],addEventListener:(name,listener)=>listeners.set(name,listener),removeEventListener(){}};let stop;
 try{stop=installMotionPolicy(doc);listeners.get('animationstart')({type:'animationstart',animationName:'nubi-pastel-flow',target:pastel.effect.target});next?.();assert.equal(pastel.playState,'paused');assert.equal(pastel.cancelled,false);}
 finally{stop?.();for(const[key,value]of Object.entries(saved))if(value===undefined)delete globalThis[key];else globalThis[key]=value;}
});
