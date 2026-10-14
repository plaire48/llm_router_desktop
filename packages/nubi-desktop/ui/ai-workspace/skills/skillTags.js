export const SKILL_TAG_LIMIT=3;
const key = tag => tag.toLocaleLowerCase();
const fail = message => {throw Object.assign(new Error(message),{field:'tags'});};

export function addSkillTag(tags, value, options=[]) {
  const text=value.trim();
  if(!text)return tags;
  if(text.length>24)fail('태그는 24자까지 입력하세요.');
  if(tags.some(tag=>key(tag)===key(text)))return tags;
  if(tags.length>=SKILL_TAG_LIMIT)fail(`태그는 최대 ${SKILL_TAG_LIMIT}개까지 추가할 수 있습니다.`);
  return [...tags,options.find(tag=>key(tag)===key(text))||text];
}

export function skillTagOptions(skills) {
  const tags=new Map();
  for(const skill of skills)for(const tag of skill.tags)if(!tags.has(key(tag)))tags.set(key(tag),tag);
  return [...tags.values()].sort((a,b)=>a.localeCompare(b,'ko'));
}

export function matchingSkillTags(options, selected, query) {
  const chosen=new Set(selected.map(key)),term=key(query.trim());
  return options.filter(tag=>!chosen.has(key(tag))&&key(tag).includes(term));
}
