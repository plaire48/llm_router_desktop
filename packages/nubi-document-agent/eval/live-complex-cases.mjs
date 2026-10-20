import {cases, expected, authorInput, variants} from './quality-business-cases.mjs';
import {isDeepStrictEqual} from 'node:util';

export function complexBusiness(domain) {
  const c=structuredClone(cases.find(c=>c.id===(domain==='powerpoint'?'delivery':'renewal')));
  if(c.id==='renewal') {
    c.datasets.contracts=Array.from({length:24},(_,i)=>({id:'CT-'+(i+1),team:['개발','운영','기획','보안'][i%4],state:i%7===0?'종료':i%5===0?'보류':'승인',monthly:[18,24,15,32,27][i%5],months:i%2?12:6,discount:i%3===0?.1:0}));
    c.datasets.usage=Array.from({length:72},(_,i)=>({id:'US-'+(i+1),contract:'CT-'+(i%24+1),state:i%11===0?'취소':i%5===0?'미확정':'확정',quantity:2+i%5,price:[3,5,2,7][i%4]}));
    c.datasets.settings[0].budget=4200;
    c.request=c.request.replaceAll('계약 12건과 추가 사용 24건','계약 24건과 추가 사용 72건').replaceAll('예산1700만원','예산4200만원');
  } else {
    c.datasets.shipments=Array.from({length:32},(_,i)=>({id:'DL-'+(i+1),region:['동부','서부','남부','북부'][i%4],state:i%9===0?'취소':i%6===0?'보류':'확정',delivered:8+i%5,returned:1+i%4,refundUnit:[3,4,5][i%3],reship:i%4,shippingUnit:[2,3][i%2],minutes:12+i%4*6}));
    c.datasets.settings[0].budget=500;
    c.request=c.request.replaceAll('배송20건','배송32건').replaceAll('예산400만원','예산500만원');
  }
  c.variant='2026-10-17-expanded-live-host';
  return c;
}

export function creationRequest(c,domain) {
  const input=authorInput(c,domain);
  const extra={
    word:'원천 전체 행은 호스트가 따로 동결 보관한다. 본문에는 의사결정에 필요한 집계와 팀별 근거를 제시한다. 금액 비교표, 역할별 승인/중단 통제표, 예외 및 교대 인계 표를 포함한다. 표 글자 크기, 문단 줄간격과 앞뒤 간격, 머리글과 쪽수를 실제 문서에서 사용한다. 읽기 좋은 4~7페이지 안팎으로 구성하되 정확한 페이지 수나 양식을 맞출 필요는 없다.',
    excel:'원천 3개 dataset의 모든 행/필드를 보존한다. 계약 상태를 VLOOKUP 또는 INDEX/MATCH로 연결하고, SUMIFS 등 Office 2016 수식으로 승인/보류/종료를 구분한다. 팀별 집계와 독자가 읽을 요약/위험 판단을 포함한다. 필요한 시트는 직접 정하되 추가 수정 공간을 위해 6개 이내로 작성한다. 여러 표/수식/서식을 사용하고 단위, 인쇄 제목, 범위와 줄바꿈을 점검한다.',
    powerpoint:'운영 책임자가 실제 회의를 진행할 수 있는 6~9장 정도로 구성한다. 편집 가능한 표와 차트, 여러 도형을 포함한다. 음수 처리시간 여유를 올바르게 보이고, 예정 지급과 실제 지급을 구분한다. 원천 전체 행의 덤프 대신 지역 비교, 비용과 인력 병목, 결정 요청, 승인 전 통제 및 교대 인계를 설명한다. 후속 슬라이드 추가를 위해 최대 10장으로 제한한다.'
  }[domain];
  return {...input,request:input.request+'\n'+extra};
}

export function followupRequest(domain) {
  return {
    word:'기존 문단과 표의 내용, 수치, 서식, 순서와 머리글/꼬리글은 모두 보존한다. 문서 끝에 새 구역 「실행 전 확인」을 추가한다. 요청 역할, 승인 역할, 인계 역할별로 확인할 증빙/중단 조건/다음 행동을 담은 체크리스트 표를 작성한다. 검수 완료나 계약 체결을 새로 단정하지 않는다. 기존 블록을 재작성하지 말고 필요한 새 블록만 추가한다.',
    excel:'기존 모든 시트와 outputs의 위치/값/수식/서식은 그대로 보존한다. 새 시트 「비용 민감도」만 추가한다. extraDiscount 입력 0.05일 때 승인 계약의 기존 discount에서 추가 5%p 할인을 적용한 갱신료(할인 후 비용은 0 미만 금지)에 기존 승인 추가사용료와 부가세를 더한 총액을 수식으로 계산하고 outputs metric discountScenario로 등록한다. 원천의 discount는 바꾸지 않는다. 현재 예산을 15% 축소한 경우의 예산 잔여도 기존 총 승인비용에서 연결해 outputs metric reducedBudgetGap으로 등록한다. 원천 데이터와 기존 결과는 바꾸지 않고 가정 셀을 독자가 직접 바꿀 수 있게 한다. 독립 기대값을 셀 상수로 넣지 않는다.',
    powerpoint:'기존 모든 슬라이드의 개체, 좌표, 글과 수치, 차트/표, 발표자 노트 및 순서는 그대로 보존한다. 맨 뒤에 「실행 전 확인」 슬라이드 1장만 추가한다. 승인 역할/현장 실행 역할/다음 교대 역할의 증빙, 중단 조건과 인계 항목을 편집 가능한 표와 필요한 도형으로 표현한다. 실제 환불 지급이나 재배송 완료를 새로 단정하지 않는다.'
  }[domain];
}

export function extraExpected(data) {
  const active=data.contracts.filter(x=>x.state==='승인'),ids=new Set(active.map(x=>x.id));
  const usage=data.usage.filter(x=>ids.has(x.contract)&&x.state==='확정').reduce((sum,x)=>sum+x.quantity*x.price,0);
  const base=active.reduce((sum,x)=>sum+x.monthly*x.months*(1-x.discount),0);
  const discounted=active.reduce((sum,x)=>sum+x.monthly*x.months*Math.max(0,1-x.discount-.05),0);
  const round=n=>Math.round((n+Number.EPSILON)*100)/100;
  return {discountScenario:round(discounted+usage+round((discounted+usage)*data.settings[0].vat)),reducedBudgetGap:round(data.settings[0].budget*.85-round(base+usage+round((base+usage)*data.settings[0].vat)))};
}

export function preservedPlanUnits(domain,before,after) {
  const key={word:'blocks',excel:'sheets',powerpoint:'slides'}[domain];
  const old=before[key],next=after[key];
  return before.title===after.title && next.length>old.length && old.every((item,i)=>isDeepStrictEqual(item,next[i])) && (domain!=='powerpoint'||next.length===old.length+1) && (domain!=='word'||before.header===after.header&&before.footer===after.footer) && (domain!=='excel'||before.outputs.every(o=>after.outputs.some(n=>isDeepStrictEqual(o,n))));
}

export function preservationPaths(domain,plan) {
  const key={word:'blocks',excel:'sheets',powerpoint:'slides'}[domain];
  return ['/title',...plan[key].map((_,i)=>`/${key}/${i}`),...(domain==='excel'?plan.outputs.map((_,i)=>`/outputs/${i}`):[]),...(domain==='word'?['header','footer'].filter(key=>Object.hasOwn(plan,key)).map(key=>'/'+key):[])];
}

export {expected,variants};
