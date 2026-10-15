// Both manual navigation and agent tools use the same HTTP address contract.
function httpBrowserAddress(input){
 if(typeof input!=='string'||input.length>8000)throw Error('browser_url_invalid');
 const value=input.trim();
 const local=/^(?:localhost|0\.0\.0\.0|127\.\d+\.\d+\.\d+|\[::(?:1)?\])(?::\d+)?(?:[/?#]|$)/i.test(value);
 const host=/^[\w.-]+\.[a-z]{2,}(?::\d+)?(?:[/?#]|$)/i.test(value);
 let url;try{url=new URL(local?`http://${value}`:host?`https://${value}`:value);}catch{throw Error('browser_url_invalid');}
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('browser_url_invalid');
 // A server bind address is not a destination; connect to this machine.
 if(['0.0.0.0','[::]'].includes(url.hostname))url.hostname='127.0.0.1';
 return url.href;
}
module.exports={httpBrowserAddress};
