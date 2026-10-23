import {vertexShader,fragmentShader} from './reference-shader.mjs';

export function createGlassRenderer(canvas){
 const gl=canvas.getContext('webgl',{alpha:true,antialias:false,depth:false,stencil:false,premultipliedAlpha:false,preserveDrawingBuffer:false,powerPreference:'low-power'});
 if(!gl)return null;
 let program,buffer,texture;const shaders=[];
 const dispose=()=>{if(texture)gl.deleteTexture(texture);if(buffer)gl.deleteBuffer(buffer);if(program)gl.deleteProgram(program);for(const shader of shaders)gl.deleteShader(shader);};
 try {
  for(const [type,source]of [[gl.VERTEX_SHADER,vertexShader],[gl.FRAGMENT_SHADER,fragmentShader]]){
   const shader=gl.createShader(type);if(!shader)throw Error('glass_shader');shaders.push(shader);gl.shaderSource(shader,source);gl.compileShader(shader);
  }
  program=gl.createProgram();if(!program)throw Error('glass_program');for(const shader of shaders)gl.attachShader(program,shader);gl.linkProgram(program);
  if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error('glass_link');
  gl.useProgram(program);buffer=gl.createBuffer();texture=gl.createTexture();if(!buffer||!texture)throw Error('glass_resource');
  gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
  const attribute=gl.getAttribLocation(program,'a_position');gl.enableVertexAttribArray(attribute);gl.vertexAttribPointer(attribute,2,gl.FLOAT,false,0,0);
  gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);
  for(const [name,value]of [[gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE],[gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE],[gl.TEXTURE_MIN_FILTER,gl.LINEAR],[gl.TEXTURE_MAG_FILTER,gl.LINEAR]])gl.texParameteri(gl.TEXTURE_2D,name,value);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
  const uniforms=Object.fromEntries(['bg','size','dpr','strength','time','pointer','count','rects','radii','modes'].map(name=>[name,gl.getUniformLocation(program,'u_'+name+(['rects','radii','modes'].includes(name)?'[0]':''))]));
  gl.uniform1i(uniforms.bg,0);
  let width=1,height=1,dpr=1;
  const rects=new Float32Array(48),radii=new Float32Array(12),modes=new Float32Array(12);modes[0]=2;
  return {
   gl,
   resize(w,h,ratio,backdrop){width=w;height=h;dpr=ratio;canvas.width=Math.max(1,Math.round(w*ratio));canvas.height=Math.max(1,Math.round(h*ratio));gl.viewport(0,0,canvas.width,canvas.height);gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,backdrop);},
   draw(rect,{pointer=[-1000,-1000],strength=.78,time=0,radius=14}={}){
    gl.useProgram(program);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
    rects.fill(0);if(rect){rects.set([rect.x,rect.y,Math.max(1,rect.width),Math.max(1,rect.height)]);radii[0]=radius;}
    gl.uniform2f(uniforms.size,width,height);gl.uniform1f(uniforms.dpr,dpr);gl.uniform1f(uniforms.strength,strength);gl.uniform1f(uniforms.time,time);gl.uniform2fv(uniforms.pointer,pointer);gl.uniform1i(uniforms.count,rect?1:0);gl.uniform4fv(uniforms.rects,rects);gl.uniform1fv(uniforms.radii,radii);gl.uniform1fv(uniforms.modes,modes);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
   },
   dispose(){dispose();gl.getExtension('WEBGL_lose_context')?.loseContext();}
  };
 }catch{dispose();return null;}
}
