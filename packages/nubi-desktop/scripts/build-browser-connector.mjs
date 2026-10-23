import {mkdir,copyFile,writeFile,readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{portalFetch}=require('../electron-app/mail-portal-contract.cjs');
export async function buildBrowserConnector(directory='generated/browser-connector'){
 await mkdir(directory,{recursive:true});
 for(const file of ['manifest.json','background.js','mirror.js','quick-connect.js','quick-connector.js','connect.html','connect.css','connect.js','window-proof.html','window-proof.js'])await copyFile('browser-connector/'+file,directory+'/'+file);
 await copyFile('../../extensions/aipro-chat/design/brand/bird-master.png',directory+'/nubi.png');
 // Fixed host-owned reader only, not model-provided JS. The existing projection
 // strips portal token fields before any result leaves the browser.
 await writeFile(directory+'/portal-contract.js','export const portalFetch = '+portalFetch.toString()+';\n');
 await writeFile(directory+'/README.txt','누비 Workspace의 웹 > 브라우저 연결 버튼을 누르세요.\n브라우저 확장 관리에서 이 폴더를 로드하고, 다음부터는 누비의 연결 버튼 또는 Windows 창 드래그로 연결하세요.\n현재 탭과 누비가 새로 연 탭만 자동화 대상으로 연결합니다.\n메일은 포털 탭에서 읽기 허용 후 누비 메일 설정에서 연결하세요.\n이 확장은 별도 모델이나 인증 저장소를 실행하지 않습니다. Windows 브라우저와 사내 SSO는 실제 환경 검증이 필요합니다.\n');
}
if(process.argv[1]?.endsWith('/build-browser-connector.mjs'))await buildBrowserConnector();
