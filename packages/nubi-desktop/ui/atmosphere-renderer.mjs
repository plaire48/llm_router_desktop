import {ATMOSPHERE_LIMITS,atmosphereSize,atmosphereBlobs} from './atmosphere-model.mjs';
import {waitForWebGLProgram} from './webgl-ready.mjs';
const vertex=`
attribute vec2 a_position;
varying vec2 v_uv;
void main(){v_uv=a_position*.5+.5;gl_Position=vec4(a_position,0.0,1.0);}`;
const fragment=`
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform float u_time;
uniform float u_aspect;
uniform vec3 u_blobs[6];
uniform vec3 u_colors[6];
varying vec2 v_uv;
void main(){
 vec2 p=v_uv;
 // A warped colour field joins soft forms without a fullscreen blur pass.
 p+=.035*vec2(sin(p.y*7.0+u_time*.7)+sin(p.x*5.0-u_time*.4),cos(p.x*6.0-u_time*.6));
 vec3 ink=vec3(0.0);float density=0.0;
 for(int i=0;i<6;i++){
  vec2 d=p-u_blobs[i].xy;
  d.x*=clamp(u_aspect,.65,1.65);
  float angle=u_time*.17+float(i)*1.7;
  d=mat2(cos(angle),-sin(angle),sin(angle),cos(angle))*d;
  d*=vec2(1.0+.13*sin(angle),1.0-.13*sin(angle));
  float w=max(0.0,1.0-dot(d,d)/(u_blobs[i].z*u_blobs[i].z));
  w=w*w*w;ink+=u_colors[i]*w;density+=w;
 }
 vec3 colour=ink/max(density,.0001);
 float alpha=smoothstep(0.0,1.25,density)*.82;
 gl_FragColor=vec4(colour,alpha);
}`;
export function createAtmosphereRenderer(canvas){
 const gl=canvas.getContext('webgl',{alpha:true,antialias:false,depth:false,stencil:false,premultipliedAlpha:false,preserveDrawingBuffer:false,powerPreference:'low-power'});
 if(!gl)return null;
 // Software rasterisers get a smaller field; the same soft palette and paths
 // remain visible, without dropping animation frames to a fixed low rate.
 const info=gl.getExtension('WEBGL_debug_renderer_info');
 const software=info&&/swiftshader|llvmpipe|softpipe|software|microsoft basic render/i.test(String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)));
 const budget=software?ATMOSPHERE_LIMITS.softwarePixels:ATMOSPHERE_LIMITS.pixels;
 let program,vertices,compilation,uniforms,compiled=false,disposed=false;const shaders=[],blobs=new Float32Array(18),palette=new Float32Array(18);
 const dispose=()=>{if(disposed)return;disposed=true;compilation?.cancel();if(vertices)gl.deleteBuffer(vertices);if(program)gl.deleteProgram(program);for(const shader of shaders)gl.deleteShader(shader);};
 try{
  for(const [type,source] of [[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,fragment]]){
   const shader=gl.createShader(type);if(!shader)throw Error('atmosphere_shader');shaders.push(shader);gl.shaderSource(shader,source);gl.compileShader(shader);
  }
  program=gl.createProgram();if(!program)throw Error('atmosphere_program');for(const shader of shaders)gl.attachShader(program,shader);gl.linkProgram(program);
  compilation=waitForWebGLProgram(gl,program);
  const ready=compilation.ready.then(success=>{if(!success||disposed){if(!disposed)dispose();return false;}try{
  vertices=gl.createBuffer();if(!vertices)throw Error('atmosphere_buffer');
  gl.useProgram(program);gl.bindBuffer(gl.ARRAY_BUFFER,vertices);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
  const attribute=gl.getAttribLocation(program,'a_position');gl.enableVertexAttribArray(attribute);gl.vertexAttribPointer(attribute,2,gl.FLOAT,false,0,0);gl.clearColor(0,0,0,0);
  uniforms={time:gl.getUniformLocation(program,'u_time'),aspect:gl.getUniformLocation(program,'u_aspect'),blobs:gl.getUniformLocation(program,'u_blobs[0]'),colors:gl.getUniformLocation(program,'u_colors[0]')};compiled=true;return true;
  }catch{dispose();return false;}});let aspect=1;
  return {
   budget,material:'organic-field',ready,
   resize(width,height,dpr){const size=atmosphereSize(width,height,dpr,budget);aspect=width/height||1;if(canvas.width!==size.width||canvas.height!==size.height){canvas.width=size.width;canvas.height=size.height;gl.viewport(0,0,size.width,size.height);}},
   draw(state,colors){
    if(!compiled||disposed)return;
    atmosphereBlobs(state,blobs);for(let i=0;i<6;i++)palette.set(colors[i],i*3);
    gl.useProgram(program);gl.uniform1f(uniforms.time,state.phase);gl.uniform1f(uniforms.aspect,aspect);gl.uniform3fv(uniforms.blobs,blobs);gl.uniform3fv(uniforms.colors,palette);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
   },
   dispose
  };
 }catch{dispose();return null;}
}
