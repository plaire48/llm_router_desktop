import * as THREE from 'three';
import {ATMOSPHERE_LIMITS} from './atmosphere-model.mjs';
const cssColour=(colour,white=0)=>`rgb(${colour.map(c=>Math.round((c*(1-white)+white)*255)).join(',')})`;
function gradientTexture(colours,environment=false){
 const canvas=document.createElement('canvas');canvas.width=256;canvas.height=environment?128:256;
 const ctx=canvas.getContext('2d'),gradient=ctx.createLinearGradient(0,0,canvas.width,canvas.height);
 colours.forEach((c,i)=>gradient.addColorStop(i/(colours.length-1),cssColour(c,environment ? .10 : .62)));ctx.fillStyle=gradient;ctx.fillRect(0,0,canvas.width,canvas.height);
 if(environment){
  // Local softboxes give the glass a readable curved reflection. No HDR/CDN.
  for(const [x,y,w,h] of [[18,12,22,82],[94,8,90,12],[214,24,16,72]]){const glow=ctx.createLinearGradient(x,0,x+w,0);glow.addColorStop(0,'rgba(255,255,255,0)');glow.addColorStop(.35,'rgba(255,255,255,.98)');glow.addColorStop(.65,'rgba(255,255,255,.98)');glow.addColorStop(1,'rgba(255,255,255,0)');ctx.fillStyle=glow;ctx.fillRect(x,y,w,h);}
 }
 const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;return texture;
}
export function createGlassRingRenderer(canvas,{colors}={}){
 const gl=canvas.getContext('webgl2',{alpha:true,antialias:true,powerPreference:'low-power',premultipliedAlpha:true});if(!gl)return null;
 const info=gl.getExtension('WEBGL_debug_renderer_info'),software=info&&/swiftshader|llvmpipe|softpipe|software|microsoft basic render/i.test(String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)));
 const budget=software?ATMOSPHERE_LIMITS.ringSoftwarePixels:ATMOSPHERE_LIMITS.ringPixels;
 let renderer,geometry,material,environment,environmentSource,background,generator;
 const dispose=()=>{geometry?.dispose();material?.dispose();environment?.dispose();environmentSource?.dispose();background?.dispose();generator?.dispose();renderer?.dispose();};
 try{
  renderer=new THREE.WebGLRenderer({canvas,context:gl,alpha:true,antialias:true,powerPreference:'low-power'});renderer.setPixelRatio(1);renderer.transmissionResolutionScale=.5;renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.NoToneMapping;
  renderer.debug.onShaderError=()=>{throw Error('glass_ring_shader');};
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(36,1,.1,20);camera.position.z=4.8;
  background=gradientTexture(colors);scene.background=background;
  environmentSource=gradientTexture(colors,true);environmentSource.mapping=THREE.EquirectangularReflectionMapping;generator=new THREE.PMREMGenerator(renderer);environment=generator.fromEquirectangular(environmentSource);scene.environment=environment.texture;generator.dispose();generator=null;
  geometry=new THREE.TorusGeometry(1,.29,24,96);
  const positions=geometry.attributes.position,colours=new Float32Array(positions.count*3),colour=new THREE.Color();
  // Close the palette around the torus so its first/last colours have no seam.
  for(let i=0;i<positions.count;i++){const angle=(Math.atan2(positions.getY(i),positions.getX(i))+Math.PI)/(Math.PI*2)%1*colors.length,at=Math.floor(angle),next=(at+1)%colors.length,mix=angle-at;colour.setRGB(...colors[at].map((v,k)=>v*(1-mix)+colors[next][k]*mix),THREE.SRGBColorSpace);colour.toArray(colours,i*3);}
  geometry.setAttribute('color',new THREE.BufferAttribute(colours,3));
  material=new THREE.MeshPhysicalMaterial({color:0xffffff,vertexColors:true,metalness:0,roughness:.08,transmission:.65,thickness:.65,ior:1.43,clearcoat:1,clearcoatRoughness:.08,iridescence:.8,iridescenceIOR:1.3,iridescenceThicknessRange:[100,380],envMapIntensity:1});
  const time={value:0};material.onBeforeCompile=shader=>{shader.uniforms.uTime=time;shader.vertexShader='uniform float uTime;\n'+shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
   float angle=atan(position.y,position.x);
   float wave1=sin(angle*3.0-uTime*.67+position.z*2.0);
   float wave2=sin(angle*5.0+uTime*.91-position.z*2.8);
   float wave3=sin(angle*2.0+uTime*.39);
   transformed+=normal*(.025*wave1+.012*wave2+.009*wave3);`);};material.customProgramCacheKey=()=> 'nubi-liquid-ring-v1';
  const ring=new THREE.Mesh(geometry,material);scene.add(ring);
  const key=new THREE.DirectionalLight(0xffffff,1.6);key.position.set(-3,4,4);scene.add(key);const fill=new THREE.DirectionalLight(0xffffff,.8);fill.position.set(3,-1,2);scene.add(fill);
  canvas.dataset.context='webgl2';
  return {budget,material:'liquid-glass-ring',resize(width,height,dpr){const ratio=Math.min(1,dpr,Math.sqrt(budget/(width*height)));renderer.setSize(Math.max(1,Math.floor(width*ratio)),Math.max(1,Math.floor(height*ratio)),false);camera.aspect=width/height||1;camera.updateProjectionMatrix();ring.scale.setScalar(Math.max(.85,Math.min(1.3,camera.aspect)));},draw(state){const t=state.elapsed;time.value=t;ring.rotation.z=-.25+t*.078;ring.rotation.x=-.17+Math.sin(t*.28)*.13;ring.rotation.y=.28+Math.sin(t*.20)*.27;ring.position.y=.06+Math.sin(t*.58)*.065;renderer.render(scene,camera);},dispose};
 }catch{dispose();return null;}
}
