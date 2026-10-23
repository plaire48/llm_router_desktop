import React from 'react';
import './usage-reset-summary.css';

const dateFor=value=>Number.isSafeInteger(value)&&value>0&&Number.isFinite(new Date(value).getTime())?new Date(value):null;
export function UsageResetSummary({usage}){
 const reset=dateFor(usage?.lastResetAt),date=reset||dateFor(usage?.startedAt);
 return <span className="nubi-usage-reset-summary"><span>이 앱에서 사용한 토큰</span>{usage&&<span title={reset?'이 PC의 시간대로 표시한 마지막 앱 집계 초기화 시각':date?'이전 기록은 첫 집계와 초기화를 구분하지 않아 집계 시작 시각으로 표시합니다.':undefined}>{date?<>{reset?'마지막 초기화':'집계 시작'} <time dateTime={date.toISOString()}>{date.toLocaleString('ko-KR',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'})}</time></>:'초기화 기록 없음'}</span>}</span>;
}
