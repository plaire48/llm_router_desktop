export function inquiryStatus(post) {
  if(post.state==='closed')return post.stateReason==='completed'?{key:'completed',label:'완료'}:{key:'closed',label:'종료'};
  return {key:'open',label:post.labels?.includes('답변 대기')?'답변 대기':post.labels?.includes('처리 중')?'처리 중':'진행 중'};
}

export function filterInquiries(posts,{query='',mine=false,userId,type='',status=''}={}) {
  const words=query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return posts.filter(post=>(!mine||post.user?.id===userId)&&(!type||post.type===type)&&(!status||inquiryStatus(post).key===status)&&words.every(word=>`${post.number} ${post.title} ${post.body} ${post.type} ${post.user?.name||''} ${post.user?.login||''}`.toLocaleLowerCase().includes(word)));
}
