const {StringDecoder}=require('node:string_decoder');
const stages=new Set(['destination','connecting','enumerating','counting','compressing','receiving','resolving','checkout','filtering','opening']);
const codes=new Set(['clone_failed','clone_gateway','clone_server','clone_target_exists','clone_destination_missing','clone_permission','clone_disk_full','clone_path_long','clone_path_invalid','clone_auth','clone_login_required','clone_repository_unavailable','clone_tls','clone_proxy','clone_dns','clone_network','clone_timeout','clone_ssh_key','clone_ssh_host','clone_ssh_unavailable','clone_checkout','clone_transfer','clone_git_missing','clone_git_blocked','clone_auth_helper','clone_interrupted']);
// Inspect only a bounded rolling buffer in memory. Raw Git output never becomes
// an error message, persisted diagnostic, progress event or renderer payload.
function cloneErrorCode(text='',error={}){
 if(error.code==='ENOENT')return 'clone_git_missing';
 if(['EACCES','EPERM'].includes(error.code))return 'clone_git_blocked';
 if(error.code==='ENOSPC'||/no space left on device|disk full/i.test(text))return 'clone_disk_full';
 if(error.code==='ENAMETOOLONG'||/filename too long|file name too long/i.test(text))return 'clone_path_long';
 if(/cannot run ssh|cannot spawn ssh|ssh: (?:command )?not found/i.test(text))return 'clone_ssh_unavailable';
 if(/host key verification failed|remote host identification has changed/i.test(text))return 'clone_ssh_host';
 if(/permission denied \(publickey/i.test(text))return 'clone_ssh_key';
 if(/returned error: (?:502|504)\b/i.test(text))return 'clone_gateway';
 if(/returned error: 5\d\d\b/i.test(text))return 'clone_server';
 if(/proxy authentication|required.*407|returned error: 407|could not resolve proxy|failed to connect to proxy|CONNECT tunnel failed/i.test(text))return 'clone_proxy';
 if(/SSL certificate|server certificate|certificate (?:verify|verification)|unable to get local issuer|self.signed certificate|schannel:|TLS (?:handshake|connection)|SSL connect error/i.test(text))return 'clone_tls';
 if(/could not resolve host|could not resolve hostname|name or service not known|no such host is known/i.test(text))return 'clone_dns';
 if(/authentication failed|could not read (?:Username|Password)|terminal prompts disabled|HTTP Basic: Access denied|returned error: (?:401|403)/i.test(text))return 'clone_auth';
 if(/repository .*not found|repository not found|does not appear to be a git repository|returned error: 404/i.test(text))return 'clone_repository_unavailable';
 if(/timed out|timeout was reached/i.test(text))return 'clone_timeout';
 if(/connection refused|failed to connect|network is unreachable|connection reset|connection closed|could not read from remote repository/i.test(text))return 'clone_network';
 if(/invalid path|invalid argument|unable to create file.*invalid/i.test(text))return 'clone_path_invalid';
 if(/permission denied|access is denied|read.only file system/i.test(text))return 'clone_permission';
 if(/clone succeeded, but checkout failed|unable to checkout/i.test(text))return 'clone_checkout';
 if(/early EOF|index-pack failed|invalid index-pack|RPC failed|fetch-pack:|smudge filter.*failed/i.test(text))return 'clone_transfer';
 return 'clone_failed';
}
function createCloneErrorCapture(){
 const decoder=new StringDecoder('utf8');let tail='',observed='clone_failed',httpStatus;
 const inspect=text=>{tail=(tail+text).slice(-16384);const status=/returned error: ([45]\d\d)\b/i.exec(tail);if(status)httpStatus=Number(status[1]);const code=cloneErrorCode(tail);if(code!=='clone_failed'&&observed==='clone_failed')observed=code;};
 return {get httpStatus(){return httpStatus;},write(chunk){inspect(decoder.write(chunk));},finish(error={}){inspect(decoder.end());const code=cloneErrorCode('',error);tail='';return code==='clone_failed'?observed:code;}};
}
function safeCloneFailure(value){
 if(!value||!codes.has(value.code))return null;
 return {code:value.code,stage:stages.has(value.stage)?value.stage:'connecting',...(Number.isInteger(value.exitCode)&&value.exitCode>=0&&value.exitCode<=255?{exitCode:value.exitCode}:{}),...(['SIGTERM','SIGKILL','SIGINT'].includes(value.signal)?{signal:value.signal}:{}),...(Number.isInteger(value.httpStatus)&&value.httpStatus>=400&&value.httpStatus<=599?{httpStatus:value.httpStatus}:{}),retained:value.retained===true};
}
function cloneFailure(code,details={}){const failure=safeCloneFailure({code,...details})||{code:'clone_failed',stage:'connecting',retained:false};return Object.assign(Error(failure.code),{cloneFailure:failure});}
module.exports={cloneErrorCode,createCloneErrorCapture,safeCloneFailure,cloneFailure};
