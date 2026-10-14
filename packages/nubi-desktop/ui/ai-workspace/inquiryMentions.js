const loginPattern=/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i;
const marker='<!-- e2e-inquiry-notify:v1 -->\n';

export function inquiryMentionLogins(users,excluded=[]) {
  const omitted=new Set(excluded.filter(login=>typeof login==='string').map(login=>login.toLowerCase()));
  const found=new Set();
  for(const user of users){
    const login=typeof user==='string'?user:user?.login;
    if(typeof login==='string'&&loginPattern.test(login)&&!omitted.has(login.toLowerCase()))found.add(login.toLowerCase());
  }
  return [...found];
}

// Put generated mentions before user Markdown so an unfinished code block in
// the reply cannot turn the recipients into code instead of GHES mentions.
export function inquiryMentionPrefix(users,excluded=[]) {
  const names=inquiryMentionLogins(users,excluded);
  return names.length?`${marker}${names.map(login=>`@${login}`).join(' ')}\n\n`:'';
}

export function stripInquiryMentionPrefix(value) {
  const text=String(value||'');
  if(!text.startsWith(marker))return text;
  const end=text.indexOf('\n\n',marker.length);
  if(end<0)return text;
  const names=text.slice(marker.length,end).split(' ');
  if(!names.length||names.some(name=>!name.startsWith('@')||!loginPattern.test(name.slice(1))))return text;
  return text.slice(end+2);
}
