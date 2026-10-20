"""Summarize preserved execution records without turning reruns into first passes."""
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
folders=['quality-business-1','quality-old-failure-1','quality-focused-2','quality-cross-review-1','quality-consensus-3','quality-minor-gate-4','quality-observed-pages-5','quality-delivery-6']
summary={}
for name in folders:
 d=ROOT/'artifacts'/name
 records=[]
 paths=sorted(d.glob('*/result.json')) if name!='quality-cross-review-1' else sorted(d.glob('*.json'))
 for p in paths:
  r=json.loads(p.read_text());records.append(dict(id=r.get('id',p.parent.name if p.name=='result.json' else p.stem),status=r['status'],error=r.get('error'),rounds=len(r.get('rounds',[])),initialPassed=bool(r.get('rounds') and r['rounds'][0].get('complete')),reviewPages=[x.get('pages',{}).get('count') for x in r.get('rounds',[])],path=str(p.relative_to(ROOT))))
 summary[name]=dict(records=records,recorded=len(records),verified=sum(r['status'] in ['verified_draft','passed'] for r in records),initialPassed=sum(r['initialPassed'] for r in records),pending=sum(r['status']=='running' for r in records))
(ROOT/'artifacts/quality-cycle-summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
lines=[]
for name,group in summary.items():
 lines+=['### '+name,'','| 문서 | 실행 상태 | 검토 회수 | 회차별 페이지 수 |','|---|---|---:|---|']
 for r in group['records']:
  if name=='quality-cross-review-1':
   detail=json.loads((ROOT/r['path']).read_text());r['rounds']=len(detail['reviews']);r['reviewPages']=[len(rv['reviewedPages']) for rv in detail['reviews']]
  lines.append('| '+r['id']+' | '+r['status']+((' / '+r['error']) if r['error'] else '')+' | '+str(r['rounds'])+' | '+' → '.join(str(n) for n in r['reviewPages'])+' |')
 lines.append('')
text='\n'.join(lines)
report=ROOT.parent.parent/'docs/research/2026-10-16-document-agent-quality-cycle.md';old=report.read_text();a=old.index('<!-- QUALITY_RESULTS -->');b=old.index('<!-- /QUALITY_RESULTS -->',a);report.write_text(old[:a]+'<!-- QUALITY_RESULTS -->\n'+text+'\n'+old[b:])
print(json.dumps({k:{n:v for n,v in group.items() if n!='records'} for k,group in summary.items()},ensure_ascii=False))
