export function processRecoveryView(process,{connected=false,cancelled=false}={}){
 if(!process||cancelled||!['failed','timed_out','interrupted'].includes(process.state))return null;
 const state=process.recoveryState;
 if(['review','waiting_input','cancelled'].includes(state))return null;
 if(['queued','diagnosing'].includes(state)&&connected)return {pending:true,label:state==='queued'?'실행 결과 확인 대기 중':'실행 결과를 확인하고 있어요.'};
 return {pending:false,label:connected?'저장한 결과부터 확인해 이어갑니다.':'AI를 연결하면 저장한 결과부터 이어갑니다.',action:connected?'이어서 해결':'AI 연결'};
}
