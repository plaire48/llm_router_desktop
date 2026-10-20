/** Fixed synthetic business case. Expected values are computed from raw records, never from model formulas. */
export const departments=['기술','운영','보안','교육'];
export const sources={fictional:true,project:'사내 업무 시스템 도입',period:'2027년 1월부터 12월',unit:'만원',approvalLimit:18000,vatRate:.1,reserveRate:.1,decisionDate:'2026-12-18',pilot:'2027년 4월',launch:'2027년 7월',users:240,
 rates:departments.map((department,i)=>({department,monthlyRate:[180,160,200,120][i]})),
 staffing:Array.from({length:48},(_,i)=>({month:Math.floor(i/4)+1,department:departments[i%4],effort:[.8,.6,.4,.3][i%4]+(Math.floor(i/4)<6?.2:0)})),
 expenses:Array.from({length:96},(_,i)=>({id:`E${String(i+1).padStart(3,'0')}`,month:Math.floor(i/8)+1,department:departments[Math.floor(i/2)%4],category:i%2?'외주':'라이선스',quantity:i%2?1:5,unitPrice:i%2?40+(i%4)*5:6+(i%4),status:i%11===0?'보류':'확정'})),
 options:[{name:'일괄 전환',duration:'3개월',risk:'높음',choice:false},{name:'단계 도입',duration:'12개월',risk:'중간',choice:true},{name:'현행 유지',duration:'없음',risk:'업무 단절 지속',choice:false}],
 requirements:['R01 사용자 권한 분리','R02 결재 이력 추적','R03 기존 자료 이관','R04 장애 복구 훈련','R05 사용자 교육','R06 운영 인수인계'],
 exclusions:['기존 NASCA 암호화 정책 변경','실제 기업 데이터 사용','외부 서비스 구매 확정'],
 risks:[['자료 이관 누락','보안','대사표 전수 확인'],['사용자 정착 지연','교육','부서별 시범 운영'],['예산 초과','운영','월별 집행 점검'],['권한 설정 오류','보안','직무별 승인 테스트']],
 milestones:[['1분기','분석과 설계'],['2분기','시범 운영과 보완'],['3분기','전체 전환과 교육'],['4분기','안정화와 인수인계']]};
export function expected(input=sources){
 const labor=input.staffing.map(r=>Math.round(r.effort*input.rates.find(x=>x.department===r.department).monthlyRate*100)/100);
 const expense=input.expenses.map(r=>r.status==='확정'?r.quantity*r.unitPrice:0);
 const monthly=Array.from({length:12},(_,i)=>({month:i+1,labor:input.staffing.reduce((s,r,j)=>s+(r.month===i+1?labor[j]:0),0),expense:input.expenses.reduce((s,r,j)=>s+(r.month===i+1?expense[j]:0),0)}));
 const base=labor.reduce((a,b)=>a+b,0)+expense.reduce((a,b)=>a+b,0),vat=Math.round(base*input.vatRate*100)/100,reserve=Math.round(base*input.reserveRate*100)/100;
 return {laborTotal:labor.reduce((a,b)=>a+b,0),expenseTotal:expense.reduce((a,b)=>a+b,0),base,vat,reserve,total:base+vat+reserve,remaining:input.approvalLimit-base-vat-reserve,held:input.expenses.filter(r=>r.status==='보류').length,monthly,department:departments.map(d=>({name:d,total:input.staffing.reduce((s,r,j)=>s+(r.department===d?labor[j]:0),0)+input.expenses.reduce((s,r,j)=>s+(r.department===d?expense[j]:0),0)}))};
}
export const contract={id:'hard-business-pack-v1',fictional:true,tasks:3,required:{word:{sections:8,nativeTables:6,landscapeSections:1,mergedApprovalCells:true,repeatedTableHeaders:true,pageFields:true,requirementsTraceability:6},excel:{sheets:8,sourceRecords:144,months:12,formulaCellsMin:300,formulaFamiliesMin:6,editableChart:true,inputMutationCases:3},powerpoint:{slides:12,layoutsMin:5,nativeCharts:2,nativeTables:1,speakerNotes:12,decisionAndRisk:true}},gates:['raw input fidelity','independent numerical check','cross document consistency','editable native structures','full render review','change and preservation'],nativeOfficeVerified:false,nascaVerified:false};
