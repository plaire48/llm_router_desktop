const {StringDecoder}=require('node:string_decoder');
const stages={'Enumerating objects':'enumerating','Counting objects':'counting','Compressing objects':'compressing','Receiving objects':'receiving','Resolving deltas':'resolving','Updating files':'checkout','Checking out files':'checkout','Filtering content':'filtering'};
// Git writes CR-delimited progress to stderr. Only recognized numeric fields
// cross IPC; remote messages, URLs, paths and credentials never do.
function createCloneProgress(report){
 const decoder=new StringDecoder('utf8');let pending='',previous='';
 function line(value){
  const match=/^(?:remote:\s*)?(Enumerating objects|Counting objects|Compressing objects|Receiving objects|Resolving deltas|Updating files|Checking out files|Filtering content):\s*(\d{1,3})%\s*\((\d+)\/(\d+)\)(.*)$/.exec(value.trim());
  if(!match)return;const percent=Number(match[2]),current=Number(match[3]),total=Number(match[4]);
  if(percent>100||!Number.isSafeInteger(current)||!Number.isSafeInteger(total)||total<1||current>total)return;
  const sizes=/,\s*(\d+(?:\.\d+)?\s*(?:bytes|[KMGT]iB))(?:\s*\|\s*(\d+(?:\.\d+)?\s*(?:bytes|[KMGT]iB)\/s))?/.exec(match[5]);
  const item={stage:stages[match[1]],percent,current,total,...(sizes?{transferred:sizes[1],...(sizes[2]?{speed:sizes[2]}:{})}:{})};
  const key=JSON.stringify(item);if(key!==previous){previous=key;report(item);}
 }
 function consume(text){pending+=text;const lines=pending.split(/[\r\n]/);pending=lines.pop().slice(-4096);for(const value of lines)line(value);}
 return {write:chunk=>consume(decoder.write(chunk)),end(){consume(decoder.end());line(pending);pending='';}};
}
module.exports={createCloneProgress};
