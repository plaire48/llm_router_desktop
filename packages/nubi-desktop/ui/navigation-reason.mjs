// Project tools are disabled until a project is open; the disabled button says so instead of staying silent.
export const NO_PROJECT_REASON='프로젝트를 열면 쓸 수 있어요';
export function navigationTitle({disabled,title}){return disabled?NO_PROJECT_REASON:title;}
