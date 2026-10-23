import React from 'react';
import {CxButton,Icon} from '@e2e/cx-design-system';
import './chapter-marks.css';
export function ChapterDivider({chapter}){
 return <div className="nubi-chapter" id={'chapter-'+chapter.id} role="separator" aria-label={`챕터 ${chapter.title}`}><Icon name="bookmark" size={14}/><strong>{chapter.title}</strong>{chapter.summary&&<span title={chapter.summary}>{chapter.summary}</span>}</div>;
}
export function ChapterContents({chapters=[],onJump}){
 if(chapters.length<2)return null;
 return <nav className="nubi-chapter-contents" aria-label="챕터 목차">{chapters.map((chapter,index)=><CxButton key={chapter.id} onClick={()=>onJump(chapter)}><span>{index+1}</span><span title={chapter.summary}>{chapter.title}</span></CxButton>)}</nav>;
}
