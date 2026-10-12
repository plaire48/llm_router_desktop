// Keeps ONE model login alive for repeated evaluation runs, so a source change
// does not require a new login. Run this first, log in once in the browser,
// then start eval/run.mjs from another terminal. Evaluation-only.
import {createDesktopProviders as createProviders} from '../runtime/desktop-providers.mjs';
import {startRelayServer,defaultSocketPath} from './relay.mjs';

const option=name=>{const index=process.argv.indexOf('--'+name);return index>0?process.argv[index+1]:undefined;};
const provider=option('provider')||'claude',model=option('model')||(provider==='claude'?'claude-opus-5-5':'gpt-5.6-luna'),socketPath=option('socket')||defaultSocketPath();
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
if(!['chatgpt','aipro','claude'].includes(provider)){console.error('평가 제공자는 chatgpt, aipro, claude입니다.');process.exit(2);}
const providers=createProviders({hostLabel:'누비 워크스페이스 평가'});
console.log(provider==='claude'?'Claude Code의 기존 로그인 상태를 확인합니다.':'브라우저에서 로그인해 주세요. 3분 안에 완료해야 합니다.');
await providers.login(provider);
while(providers.status().pending)await pause(200);
if(!providers.status().connected){console.error('로그인을 완료하지 못했습니다: '+(providers.status().loginError||'no_credential'));providers.dispose();process.exit(1);}
try{await providers.model(model);}catch{console.error('이 계정의 모델 목록에 없는 모델입니다: '+model);providers.dispose();process.exit(1);}
if(provider==='claude')await providers.reasoning(option('effort')||'medium');
if(provider==='claude'){
  await providers.complete([{role:'user',content:'연결 확인이라고만 답하세요.'}],[]);
  const selected=providers.status().models.find(item=>item.id===providers.status().model);
  if(providers.status().model==='claude-opus-5-5'&&selected?.resolvedModel!=='claude-opus-5-5'){providers.dispose();throw Error('evaluation_model_mismatch');}
}
const server=await startRelayServer({providers,socketPath});
const stop=async()=>{await server.close();providers.dispose();process.exit(0);};
process.on('SIGINT',stop);process.on('SIGTERM',stop);
console.log('READY '+JSON.stringify({provider,model:providers.status().model,requestedEffort:providers.status().reasoningEffort,modelInfo:providers.status().models.find(item=>item.id===providers.status().model),socket:socketPath}));
