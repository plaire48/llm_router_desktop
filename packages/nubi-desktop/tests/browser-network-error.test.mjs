import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {loadFailure,networkDiagnostic,networkMessage}=require('../electron-app/browser-network-error.cjs');
test('certificate, TLS negotiation and proxy failures stay distinct',()=>{
 for(const [code,category] of [[-202,'certificate'],[-113,'tls'],[-130,'proxy'],[-115,'proxy']])assert.equal(loadFailure(code),`browser_${category}_failed`);
 assert.equal(loadFailure(-118),'browser_timeout');
 assert.match(networkMessage(networkDiagnostic(-201,'ERR_CERT_DATE_INVALID')),/유효기간/);
 assert.match(networkMessage(networkDiagnostic(-200,'ERR_CERT_COMMON_NAME_INVALID')),/서버 이름/);
 assert.match(networkMessage(networkDiagnostic(-202,'ERR_CERT_AUTHORITY_INVALID')),/발급 기관/);
 assert.match(networkMessage(networkDiagnostic(-136,'ERR_PROXY_CERTIFICATE_INVALID')),/프록시/);
});
test('diagnostics keep only a fixed native code and navigation stage',()=>{
 assert.deepEqual(networkDiagnostic(-202,'ERR_CERT_AUTHORITY_INVALID','redirect'),{category:'browser_certificate_failed',stage:'redirect',netCode:-202,netError:'ERR_CERT_AUTHORITY_INVALID'});
 assert.deepEqual(networkDiagnostic(undefined,'https://user:SECRET@example.test/?token=SECRET','SECRET'),{category:'browser_load_failed',stage:'opening'});
});
