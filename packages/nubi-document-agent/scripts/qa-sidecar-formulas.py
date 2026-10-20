"""Run the existing independent synthetic formula contracts against pinned GenOffice/IronCalc.
This never edits the source workbooks and never reads company or encrypted documents.
"""
import sys,json,subprocess,select,hashlib,math,os,time
from pathlib import Path
source=Path(sys.argv[1]).resolve();root=Path(sys.argv[2]).resolve();binary=Path(sys.argv[3]).resolve();root.mkdir(parents=True,exist_ok=True)
contract=json.loads((source/'oracle-contracts.json').read_text())
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
report={'kind':'genoffice_ironcalc_formula_execution','actualOffice2016':False,'modelMeasured':False,'binarySha256':sha(binary),'checks':[],'sources':{}}
with (root/'stderr.txt').open('w') as errors:
 proc=subprocess.Popen([str(binary)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=errors,bufsize=0)
 try:
  for fixture in contract['fixtures']:
   path=source/(fixture['name']+'.xlsx');original=sha(path);report['sources'][fixture['name']]=original
   request={'version':1,'requestId':fixture['name'],'command':'recalc_cells','path':str(path),'edits':[],'reads':[{'sheet':'計算','range':{'startRow':0,'endRow':len(fixture['expected'])-1,'startColumn':5,'endColumn':5}}]}
   proc.stdin.write((json.dumps(request)+'\n').encode());proc.stdin.flush()
   # IronCalc's importer emits diagnostic lines on stdout before its JSON response.
   buffer=b'';response=None;diagnostics=[];deadline=time.monotonic()+60
   while response is None:
    if not select.select([proc.stdout],[],[],max(0,deadline-time.monotonic()))[0]:raise RuntimeError('sidecar_timeout')
    chunk=os.read(proc.stdout.fileno(),65536)
    if not chunk:raise RuntimeError('sidecar_closed')
    buffer+=chunk
    if len(buffer)>2_000_000:raise RuntimeError('response_limit')
    while b'\n' in buffer:
     line,buffer=buffer.split(b'\n',1)
     try:
      parsed=json.loads(line)
      if isinstance(parsed,dict) and parsed.get('requestId')==request['requestId']:response=parsed
      else:diagnostics.append(line.decode(errors='replace')[:200])
     except json.JSONDecodeError:diagnostics.append(line.decode(errors='replace')[:200])
   (root/(fixture['name']+'-readback.json')).write_text(json.dumps({'response':response,'diagnostics':diagnostics},ensure_ascii=False,indent=2)+'\n')
   cells={c['row']:c for c in response.get('result',{}).get('cells',[])}
   for index,expected in enumerate(fixture['expected']):
    cell=cells.get(index,{});wanted=expected['value'];number=cell.get('number');formatted=cell.get('formatted')
    # Existing OOXML oracle stores booleans as 0/1; sidecar returns TRUE/FALSE
    # without a numeric field. Normalize only boolean-contract features.
    boolean=expected['feature'] in ['AND','OR','NOT','XOR','ISERROR','ISNUMBER','ISTEXT','EXACT'] and formatted in ['TRUE','FALSE']
    normalized=(1 if formatted=='TRUE' else 0) if boolean else number
    passed=response.get('ok') and cell.get('isFormula') and not cell.get('isError') and (formatted==wanted if isinstance(wanted,str) else isinstance(normalized,(int,float)) and math.isclose(normalized,wanted,rel_tol=1e-10,abs_tol=1e-10))
    report['checks'].append({'case':fixture['name'],**expected,'number':number,'formatted':formatted,'normalizedBoolean':normalized if boolean else None,'isError':cell.get('isError'),'passed':bool(passed),'engineError':response.get('error')})
   if sha(path)!=original:raise RuntimeError('source_changed')
 finally:
  proc.stdin.close();proc.terminate();proc.wait(timeout=10)
report.update(planned=len(report['checks']),passed=sum(c['passed'] for c in report['checks']));report['failed']=report['planned']-report['passed']
(root/'results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:report[k] for k in ['planned','passed','failed']}))
