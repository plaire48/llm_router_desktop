export function rewriteCssReferences(source,resolve){
  return source.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi,(_,double,single,bare)=>`url(${JSON.stringify(resolve(double??single??bare.trim()))})`).replace(/@import\s+(['"])([^'"]+)\1/gi,(_,quote,url)=>`@import ${JSON.stringify(resolve(url))}`);
}

export function rewriteSourceSet(source,resolve){
  const values=[];let cursor=0;
  while(cursor<source.length){
    while(/[\s,]/.test(source[cursor]||'')&&cursor<source.length)cursor++;
    if(cursor>=source.length)break;
    const start=cursor,isData=source.slice(cursor,cursor+5).toLowerCase()==='data:';
    while(cursor<source.length&&!/\s/.test(source[cursor])&&(isData||source[cursor]!==','))cursor++;
    let url=source.slice(start,cursor),descriptor='';
    if(url.endsWith(',')){url=url.replace(/,+$/,'');}
    else{const start=cursor;while(cursor<source.length&&source[cursor]!==',')cursor++;descriptor=source.slice(start,cursor).trim();}
    if(url)values.push(resolve(url)+(descriptor?' '+descriptor:''));
  }
  return values.join(', ');
}
