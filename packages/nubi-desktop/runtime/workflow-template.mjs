// Deliberately small data expressions, never JavaScript execution.
const forbidden=new Set(['__proto__','constructor','prototype']);
const invalid=()=>{throw new Error('template_invalid');};
const filters={default:(v,d)=>v==null||v===''?d:v,trim:v=>String(v??'').trim(),upper:v=>String(v??'').toUpperCase(),lower:v=>String(v??'').toLowerCase(),json:v=>JSON.stringify(v??null)};

function tokenize(text){
  if(!text||text.length>8192)invalid();
  const tokens=[];let i=0;
  while(i<text.length){
    const rest=text.slice(i);if(/^\s/.test(rest)){i++;continue;}
    const operator=/^(==|!=|&&|\|\||[!().|,])/.exec(rest);
    if(operator){tokens.push({kind:operator[0]});i+=operator[0].length;}
    else if(rest[0]==='"'||rest[0]==="'"){
      const quote=text[i++];let value='',closed=false;
      while(i<text.length){let c=text[i++];if(c===quote){closed=true;break;}if(c==='\\'){
        c=text[i++];const escapes={n:'\n',r:'\r',t:'\t','\\':'\\','"':'"',"'":"'"};
        if(!Object.hasOwn(escapes,c))invalid();c=escapes[c];
      }value+=c;}
      if(!closed)invalid();tokens.push({kind:'literal',value});
    }else{
      const number=/^-?(?:0|[1-9]\d*)(?:\.\d+)?\b/.exec(rest),name=/^[A-Za-z_][A-Za-z0-9_-]*/.exec(rest);
      if(number){tokens.push({kind:'literal',value:Number(number[0])});i+=number[0].length;}
      else if(name){const word=name[0];tokens.push(Object.hasOwn({true:true,false:false,null:null},word)?{kind:'literal',value:{true:true,false:false,null:null}[word]}:{kind:'name',value:word});i+=word.length;}
      else invalid();
    }
    if(tokens.length>2048)invalid();
  }
  return tokens;
}

class Parser{
  constructor(tokens,scope){this.tokens=tokens;this.scope=scope;this.index=0;this.depth=0;this.missing=false;}
  take(kind){if(this.tokens[this.index]?.kind!==kind)return false;return this.tokens[this.index++];}
  need(kind){return this.take(kind)||invalid();}
  or(){let value=this.and();while(this.take('||')){const right=this.and();value=value||right;}return value;}
  and(){let value=this.compare();while(this.take('&&')){const right=this.compare();value=value&&right;}return value;}
  compare(){let value=this.unary();for(;;){if(this.take('=='))value=value===this.unary();else if(this.take('!='))value=value!==this.unary();else return value;}}
  unary(){if(++this.depth>64)invalid();let value;if(this.take('!'))value=!this.unary();else value=this.filtered();this.depth--;return value;}
  filtered(){
    let value=this.atom();while(this.take('|')){
      const name=this.need('name').value;if(!Object.hasOwn(filters,name))invalid();const args=[];
      if(this.take('(')){if(!this.take(')')){args.push(this.or());this.need(')');}}
      if(args.length!==(name==='default'?1:0))invalid();value=filters[name](value,...args);
    }return value;
  }
  atom(){
    const literal=this.take('literal');if(literal)return literal.value;
    if(this.take('(')){const value=this.or();this.need(')');return value;}
    const parts=[this.need('name').value];while(this.take('.'))parts.push(this.need('name').value);
    let value=this.scope;
    for(const key of parts){
      if(forbidden.has(key))invalid();
      if(value==null||typeof value!=='object'){value=undefined;continue;}
      const property=Object.getOwnPropertyDescriptor(value,key);
      if(property&&!Object.hasOwn(property,'value'))invalid();value=property?.value;if(value===undefined)this.missing=true;
    }return value;
  }
}

export function evaluateExpression(expr,scope={}){
  if(typeof expr!=='string')invalid();const parser=new Parser(tokenize(expr.trim()),scope),value=parser.or();
  if(parser.index!==parser.tokens.length)invalid();return value;
}
export function evaluateCondition(expr,scope={}){
 if(typeof expr!=='string')invalid();const parser=new Parser(tokenize(expr.trim()),scope),value=parser.or();
 if(parser.index!==parser.tokens.length)invalid();return !parser.missing&&!!value;
}
export function evaluateTemplate(text,scope={}){
  let rest=String(text??''),result='';
  while(rest.includes('{{')){
    const begin=rest.indexOf('{{'),end=rest.indexOf('}}',begin+2);if(end<0||rest.slice(0,begin).includes('}}'))invalid();
    const value=evaluateExpression(rest.slice(begin+2,end),scope);result+=rest.slice(0,begin)+(value==null?'':String(value));rest=rest.slice(end+2);
  }
  if(rest.includes('}}'))invalid();return result+rest;
}
