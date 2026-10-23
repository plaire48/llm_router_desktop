import assert from 'node:assert/strict';

export async function assertDesktopIcons(page,{screenshot}={}){
 const icons=await page.locator('svg.ui-icon').evaluateAll(nodes=>nodes.filter(n=>n.checkVisibility()).map(n=>({name:n.dataset.icon,set:n.dataset.iconSet,lucide:n.dataset.lucide})));
 assert(icons.length>=10,'real host exposes a useful icon sample');
 for(const icon of icons)assert(icon.set==='lucide'||icon.set==='brand','common icon adapter: '+JSON.stringify(icon));
 const home=page.getByRole('button',{name:'홈',exact:true}),drawing=home.locator('.nubi-icon-drawing'),box=await home.locator('svg').boundingBox();
 await home.hover();await page.waitForFunction(()=>{const n=document.querySelector('.nubi-workspace-rail button[aria-label="홈"] .nubi-icon-drawing');return n&&new DOMMatrixReadOnly(getComputedStyle(n).transform).a>1.03;});
 const after=await home.locator('svg').boundingBox();assert.deepEqual(after,box,'hover keeps the icon layout box fixed');
 await page.evaluate(()=>{const n=document.createElement('div');n.id='nubi-hourglass-proof';n.setAttribute('role','status');Object.assign(n.style,{position:'fixed',right:'36px',bottom:'36px',padding:'16px',display:'flex',gap:'12px',alignItems:'center',background:'white',color:'var(--deck-ink)',borderRadius:'16px',zIndex:1000});n.innerHTML='<span class="status-spinner" aria-hidden="true" style="width:24px;height:24px"></span><span>로딩 아이콘 확인</span>';document.querySelector('.desktop-shell').append(n);});
 const spinner=page.locator('#nubi-hourglass-proof .status-spinner'),state=await spinner.evaluate(n=>{const s=getComputedStyle(n),a=n.getAnimations()[0];a.pause();a.currentTime=1000;const hold=new DOMMatrixReadOnly(getComputedStyle(n).transform).a;a.currentTime=2100;const flipped=new DOMMatrixReadOnly(getComputedStyle(n).transform).a;a.currentTime=0;return {name:s.animationName,duration:a.effect.getTiming().duration,mask:s.maskImage,fill:s.backgroundImage,border:s.borderWidth,hold,flipped};});
 assert.equal(state.name,'nubi-hourglass-flip');assert.equal(state.duration,4000);assert.match(state.mask,/svg/);assert.match(state.fill,/linear-gradient/);assert.equal(state.border,'0px');assert(state.hold>.99&&state.flipped<-.99,'hourglass holds, then flips instead of continuous spinning');
 if(screenshot)await page.screenshot({path:screenshot});
 await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await drawing.evaluate(n=>getComputedStyle(n).transform),'none','reduced motion stops icon movement');assert.equal(await spinner.evaluate(n=>getComputedStyle(n).animationPlayState),'paused','reduced motion pauses hourglass');
 await page.locator('#nubi-hourglass-proof').evaluate(n=>n.remove());await page.mouse.move(0,0);await page.emulateMedia({reducedMotion:'no-preference'});
 // Restoring the preference can restart finite entrance effects. Audit the
 // stable reading state after those finish, rather than its translucent frame.
 await page.evaluate(()=>Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{}))));
 return {icons:icons.length,lucide:icons.filter(n=>n.set==='lucide').length,hourglass:state,hoverTargetStable:true,reducedMotion:true};
}
