import {parentPort,workerData} from 'node:worker_threads';
import {normalizePortalMail} from './mail-portal-content.mjs';
try{parentPort.postMessage({result:await normalizePortalMail(Buffer.from(workerData.raw,'base64'),{includePresentation:workerData.includePresentation===true})});}
catch(error){parentPort.postMessage({error:['mail_size_limit','mail_parse_failed'].includes(error.message)?error.message:'mail_parse_failed'});}
