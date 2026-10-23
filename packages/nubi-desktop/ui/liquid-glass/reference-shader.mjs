// Extracted from the user supplied design-reference/nubi-liquid-glass-demo.html.
// The reference shader is retained verbatim; the adapter below emits only lens coverage.
export const vertexShader=`attribute vec2 a_position; void main(){gl_Position=vec4(a_position,0.0,1.0);}`;
export const referenceFragmentShader=`precision highp float;
  uniform sampler2D u_bg;
  uniform vec2 u_size;
  uniform float u_dpr;
  uniform float u_strength;
  uniform float u_time;
  uniform vec2 u_pointer;
  uniform int u_count;
  uniform vec4 u_rects[12];
  uniform float u_radii[12];
  uniform float u_modes[12];
  float sdfBox(vec2 p,vec2 halfSize,float radius){vec2 q=abs(p)-halfSize+radius;return length(max(q,0.0))+min(max(q.x,q.y),0.0)-radius;}
  vec3 backdrop(vec2 p){vec2 uv=vec2(p.x/u_size.x,1.0-p.y/u_size.y);return texture2D(u_bg,clamp(uv,vec2(0.001),vec2(0.999))).rgb;}
  void main(){
    vec2 p=vec2(gl_FragCoord.x/u_dpr,u_size.y-gl_FragCoord.y/u_dpr);
    vec3 color=backdrop(p);
    for(int i=0;i<12;i++){
      if(i>=u_count) break;
      vec4 rc=u_rects[i];
      vec2 center=rc.xy+.5*rc.zw;
      vec2 local=p-center;
      float r=min(u_radii[i],min(rc.z,rc.w)*.5);
      float d=sdfBox(local,.5*rc.zw,r);
      if(d>28.0)continue;
      float mode=u_modes[i];
      float shadow=(1.0-smoothstep(0.0,24.0,max(d,0.0)))*smoothstep(-1.0,3.0,d);
      color *= (1.0-.082*shadow);
      if(d>2.0)continue;
      float dx=sdfBox(local+vec2(1.0,0.0),.5*rc.zw,r)-sdfBox(local-vec2(1.0,0.0),.5*rc.zw,r);
      float dy=sdfBox(local+vec2(0.0,1.0),.5*rc.zw,r)-sdfBox(local-vec2(0.0,1.0),.5*rc.zw,r);
      vec2 n=normalize(vec2(dx,dy)+vec2(.00001));
      float rimProximity=exp(-pow((d+9.0)/16.0,2.0));
      float power=mode>2.5?22.0:mode>1.5?14.0:mode>0.5?12.0:9.0;
      vec2 shift=n*power*u_strength*rimProximity;
      vec3 refracted=vec3(backdrop(p-shift*1.17).r,backdrop(p-shift).g,backdrop(p-shift*.82).b);
      float whiten=mode>2.5?.145:mode>1.5?.24:mode>.5?.12:.17;
      vec3 glass=mix(refracted,vec3(.99,.995,1.0),whiten);
      float rim=exp(-pow((d+1.0)/1.75,2.0));
      float inner=exp(-pow((d+7.0)/5.5,2.0));
      float light=pow(max(dot(n,normalize(vec2(-.73,-.68))),0.0),1.6);
      float dark=pow(max(dot(n,normalize(vec2(.75,.7))),0.0),1.8);
      float pointerSpec=exp(-length(p-u_pointer)/170.0)*.08;
      glass+=vec3(1.0,.99,.995)*rim*(.16+.50*light+.10*sin(u_time*.5)+pointerSpec);
      glass+=vec3(.97,.98,1.0)*inner*(.034+.13*light);
      glass-=vec3(.07,.09,.1)*rim*dark*.6;
      if(mode>1.5&&mode<2.5){glass=mix(glass,vec3(.83,.88,1.0),.08);glass+=vec3(.015,.012,.045);}
      if(mode>2.5){glass+=rim*vec3(.05,.08,.12)*.26;}
      glass=clamp(glass,0.0,1.0);
      float coverage=1.0-smoothstep(-1.25,1.6,d);
      color=mix(color,glass,coverage);
    }
    gl_FragColor=vec4(color,1.0);
  }`;

// DOM labels remain above the canvases. Only the owned Canvas backdrop is sampled.
export const fragmentShader=referenceFragmentShader
.replace('if(mode>1.5&&mode<2.5){glass=mix(glass,vec3(.83,.88,1.0),.08);glass+=vec3(.015,.012,.045);}','')
.replace('glass+=vec3(1.0,.99,.995)*rim*(.16+.50*light+.10*sin(u_time*.5)+pointerSpec);','glass+=vec3(1.0)*rim*(.08+.24*light+pointerSpec*.5);')
.replace(
  'gl_FragColor=vec4(color,1.0);',
  `float lensAlpha=0.0;
    for(int i=0;i<12;i++){
      if(i>=u_count)break;
      vec4 rc=u_rects[i];
      float radius=min(u_radii[i],min(rc.z,rc.w)*.5);
      float distance=sdfBox(p-rc.xy-.5*rc.zw,.5*rc.zw,radius);
      float coverage=1.0-smoothstep(-1.25,1.6,distance);
      float edge=exp(-pow((distance+1.0)/2.0,2.0));
      float insetLight=exp(-pow((distance+7.0)/5.5,2.0));
      lensAlpha=max(lensAlpha,coverage*(.055+.42*edge+.08*insetLight));
    }
    gl_FragColor=vec4(color,lensAlpha);`
);
