import {SKILL_NAME} from './skillPackage.js';
import {validVersion} from './skillModel.js';

export const SKILL_DESKTOP_APPS=[{key:'codex',label:'ChatGPT'},{key:'claude-desktop',label:'Claude'},{key:'claude',label:'Claude Code'},{key:'aipro',label:'AIPro'}];
export const SKILL_INSTALL_GUIDES={
  codex:{folder:'.agents',prefix:'$'},
  'claude-desktop':{},
  claude:{folder:'.claude',prefix:'/'},
  aipro:{folder:'.aipro'},
};
export const skillTalkTag=name=>`[skill:${name}]`;
export function skillTalkContext(hash) {
  if(!hash.startsWith('#talk?'))return null;
  const params=new URLSearchParams(hash.slice(6)),name=params.get('skill'),version=params.get('version');
  return name&&name.length<=64&&SKILL_NAME.test(name)&&validVersion(version)?{name,version}:null;
}
export const skillTalkHash=item=>`#talk?skill=${encodeURIComponent(item.name)}&version=${encodeURIComponent(item.version)}`;
export function skillTalkDraft(context) {
  if(!context||!SKILL_NAME.test(context.name)||!validVersion(context.version))return null;
  return {title:`${skillTalkTag(context.name)} v${context.version} `,html:`<p>스킬: ${context.name} (v${context.version})</p><h2>실행 환경</h2><p>도구, 도구 버전, 모델, 운영체제, 필요한 MCP 또는 프로그램</p><h2>입력과 요청</h2><p>재현할 수 있는 예시를 작성하세요.</p><h2>기대 결과와 실제 결과</h2><p>통과 여부와 근거를 작성하세요.</p><h2>호출 확인</h2><p>직접 호출, 설명과 맞는 요청, 관계없는 요청에서의 동작을 확인하세요.</p>`};
}
