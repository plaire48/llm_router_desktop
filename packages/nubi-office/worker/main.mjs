import {packageMetadata} from './skill-package.mjs';
import {startSkillIntake} from './skill-intake.mjs';
import {createInterface} from 'node:readline';
import {pathToFileURL} from 'node:url';
import {createProviders, safeError} from './providers.mjs';
import {startAgent} from './agent.mjs';
import {startDocumentAgent} from './document-agent.mjs';
import {startIntentAgent} from './intent-agent.mjs';
import {createHash} from 'node:crypto';
import {startContentAgent} from './content-agent.mjs';
import {officeHost} from './office-hosts.mjs';

export function createWorker(providers = createProviders(), {host='excel'}={}) {
  officeHost(host);
  const session=value=>({...value,host});
  let run, requestId, requestSignature;
  const snapshot=()=>({...run.status(),...(requestId?{requestId}:{})});
  const bound=payload=>run&&(payload.id?run.id===payload.id:payload.requestId&&requestId===payload.requestId);
  return {async dispatch(method, payload = {}) {
    const busy = run?.status().state === 'running';
    if (busy && ['connect', 'login', 'disconnect', 'selectProvider', 'selectModel', 'refreshModels'].includes(method)) throw new Error('run_busy');
    switch (method) {
      case 'skillPackageMetadata': return packageMetadata(payload.content);
      case 'session': return session(providers.status());
      case 'connect': return session(await providers.connect(payload));
      case 'login': return session(await providers.login(payload.provider));
      case 'cancelLogin': return session(await providers.cancelLogin());
      case 'disconnect': return session(await providers.disconnect(payload.provider));
      case 'selectProvider': return session(await providers.select(payload.provider));
      case 'selectModel': return session(await providers.model(payload.model));
      case 'refreshModels': return session(await providers.refreshModels());
      case 'runStart': {
        const key=payload.requestId;
        if(key!==undefined&&(typeof key!=='string'||!/^[a-zA-Z0-9_-]{16,100}$/.test(key)))throw new Error('invalid_request');
        const signature=createHash('sha256').update(JSON.stringify(payload)).digest('hex');
        if(key&&key===requestId){if(signature!==requestSignature)throw new Error('operation_collision');return snapshot();}
        if (busy) throw new Error('run_busy');
        const start=options=>host!=='excel'?startContentAgent(options):!options.mode||options.mode==='auto'?startIntentAgent(options):options.mode==='document'?startDocumentAgent(options):startAgent(options);
        const options={...payload,providers,host};
        const next=payload.documentSkill?startSkillIntake(options,start):start(options);
        run=next;requestId=key;requestSignature=signature;return snapshot();
      }
      case 'runLookup': if (!run || !payload.requestId || requestId!==payload.requestId) throw new Error('run_expired'); return snapshot();
      case 'runStatus': if (!run || run.id !== payload.id) throw new Error('run_expired'); return snapshot();
      case 'runCancel': if (!bound(payload)) throw new Error('run_expired'); run.cancel(); return snapshot();
      case 'toolResult': if (!run || run.id !== payload.id) throw new Error('run_expired'); run.respond(payload.callId, payload.result); return {accepted: true};
      default: throw new Error('unknown_method');
    }
  }, dispose() { run?.cancel(); providers.dispose(); }};
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const worker = createWorker(createProviders(),{host:process.env.NUBI_OFFICE_HOST||'excel'}), lines = createInterface({input: process.stdin, crlfDelay: Infinity});
  const send = value => process.stdout.write(JSON.stringify(value) + '\n');
  lines.on('line', line => {
    if (line.length > 250000) {worker.dispose(); process.exitCode = 1; lines.close(); return;}
    // .NET Framework StandardInput may emit a UTF-8 preamble on Windows.
    let request; try {request = JSON.parse(line.charCodeAt(0)===0xfeff?line.slice(1):line);} catch {return;}
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(request.id || '')) return;
    void worker.dispatch(request.method, request.payload).then(result => send({id: request.id, ok: true, result}), error => send({id: request.id, ok: false, error: safeError(error)}));
  });
  lines.on('close', () => {worker.dispose(); process.exit(0);});
}
