import { ACTIONS } from './ActionButton';
import {SearchField} from './SearchField';
import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { DetailPanel } from './DetailPanel';
import { Icon } from './Icon';
import { HELP_TOPICS, searchHelp } from './helpContent';
import './help.css';

const helpSentences = text => String(text).split(/\n+|(?<=[.!?])\s+/u);
function HelpText({text, emphasizeFirst = false}) {
  // Separate complete sentences; decimal points and file extensions stay intact.
  return helpSentences(text).map((sentence,index) => emphasizeFirst && index === 0 ? <strong className="help-answer-summary" key={index}>{sentence}</strong> : <span className="help-copy-sentence" key={index}>{sentence}</span>);
}

export default function HelpPanel({onClose, initialTopic = 'skills', user}) {
  const [active, setActive] = useState(HELP_TOPICS.some(topic => topic.id === initialTopic) ? initialTopic : 'skills');
  const [query, setQuery] = useState(''), [expanded, setExpanded] = useState(null);
  const [jump, setJump] = useState(null);
  const id = useId(), article = useRef(null), content = useRef(null), navigation = useRef(null), searchInput = useRef(null), questionRefs = useRef({});
  const topic = HELP_TOPICS.find(item => item.id === active), searching = Boolean(query.trim());
  useEffect(() => {
    if (window.matchMedia('(max-width:700px)').matches) navigation.current?.querySelector('[aria-current="page"]')?.scrollIntoView({block:'nearest',inline:'nearest'});
  }, [active, searching]);
  const results = searchHelp(query);
  const clearSearch = () => { setQuery(''); searchInput.current?.focus(); };
  useLayoutEffect(() => {
    if (!jump) return;
    const target = jump.question ? questionRefs.current[jump.question] : article.current;
    if (jump.question) target?.scrollIntoView({block:'start'});
    else content.current?.scrollTo({top:0});
    if (jump.focus) target?.focus({preventScroll:true});
  }, [jump]);
  const choose = (next, question, focus = false) => {
    setActive(next); setExpanded(question || null); setQuery('');
    setJump({question,focus});
  };
  const related={skills:[['skill-install',null,'스킬 설치'],['skill-upload',null,'업로드와 수정'],['skill-history',null,'변경 이력']], 'skill-install':[['skill-history',null,'변경 이력'],['talk',null,'AI Talk']], 'skill-history':[['skill-install','install-update','버전 변경과 설치']], 'skill-upload':[['skill-install',null,'설치와 실행 확인'],['skill-history',null,'변경 이력']], interface:[['skills',null,'Skill']], talk:[['account',null,'작성자 프로필'],['notifications','notification-missing','알림과 이메일']],support:[['talk','talk-editor','에디터 사용'],['notifications','notification-missing','알림과 이메일']],account:[['admin',null,'역할과 권한 관리']],admin:[['support','support-assignee','문의 담당자 배정']]}[active]||[];
  return <DetailPanel title="도움말" className="help-panel" variant="drawer" hideHelp footer={false} onClose={onClose}>
    <div className="help-search-bar"><SearchField className="help-search" ref={searchInput} label="도움말 검색" placeholder="예: 설치, 변경 이력, 권한" value={query} onChange={setQuery} clearLabel="도움말 검색 지우기"/></div>
    <div className="help-layout"><nav ref={navigation} className="help-navigation" aria-label="도움말 주제">{HELP_TOPICS.map(item => <button key={item.id} type="button" className={item.id === active && !searching ? 'is-active' : ''} aria-current={item.id === active && !searching ? 'page' : undefined} onClick={() => choose(item.id, null, true)}><Icon name={item.icon} size={19}/><span>{item.title}</span></button>)}</nav>
      <div ref={content} className="help-content">
        {searching ? <section aria-label="도움말 검색 결과"><h3 className="help-results-title" role="status">검색 결과 {results.length}개</h3>{results.length ? <ul className="help-search-results">{results.map(result => <li key={`${result.topic}/${result.question || 'guide'}`}><button type="button" onClick={() => choose(result.topic, result.question, true)}><span className="help-result-topic">{HELP_TOPICS.find(item => item.id === result.topic).title}</span><strong>{result.title}<Icon name="chevronRight" size={18}/></strong><span><HelpText text={helpSentences(result.excerpt)[0]}/></span></button></li>)}</ul> : <div className="help-no-results"><Icon name="search" size={28}/><p>일치하는 안내가 없습니다.</p><span>짧은 단어로 다시 검색하거나 주제를 선택하세요.</span><button type="button" className="cx-button" onClick={clearSearch}>검색 지우기</button></div>}</section> : <article key={active} aria-labelledby={`${id}-topic`}>
          {(topic.path.length!==1||topic.path[0]!==topic.title)&&<div className="help-location">{topic.path.map((part,index) => <React.Fragment key={part}>{index > 0 && <Icon name="chevronRight" size={13}/>}<span>{part}</span></React.Fragment>)}</div>}
          <h3 ref={article} tabIndex={-1} id={`${id}-topic`} className="help-topic-title">{topic.title}</h3>
          <p className="help-topic-lead">{topic.lead}</p>
          {topic.actions&&<ul className="help-action-key" aria-label="화면 아이콘">{topic.actions.map(([action,label])=><li key={action}><Icon name={ACTIONS[action][0]} size={20}/><span>{label}</span></li>)}</ul>}
          <ol className="help-instructions">{topic.steps.map(([,title,description],index) => <li key={title}><span className="help-step-number">{index + 1}</span><div><h4>{title}</h4><p><HelpText text={description}/></p></div></li>)}</ol>

          {related.length>0&&<nav className="help-related" aria-label="관련 도움말">{related.map(([next,question,label])=><button type="button" key={`${next}/${question}`} onClick={()=>choose(next,question,true)}>{label}<Icon name="chevronRight" size={16}/></button>)}</nav>}
          <section className="help-questions" aria-labelledby={`${id}-questions`}><h4 id={`${id}-questions`}>이럴 때는</h4>{topic.questions.map(([key,title,answer]) => <div className="help-question" key={key}><button ref={element => {questionRefs.current[key] = element;}} type="button" aria-expanded={expanded === key} aria-controls={expanded === key ? `${id}-${key}` : undefined} onClick={() => setExpanded(expanded === key ? null : key)}><span>{title}</span><Icon name={expanded === key ? 'chevronUp' : 'chevronDown'} size={18}/></button>{expanded === key && <p id={`${id}-${key}`}><HelpText text={answer} emphasizeFirst/></p>}</div>)}</section>
        </article>}
      </div>
    </div>
  </DetailPanel>;
}
