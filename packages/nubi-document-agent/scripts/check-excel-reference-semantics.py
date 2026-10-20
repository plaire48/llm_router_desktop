"""Calculate the preserved full-grid expressions; do not truncate blank cells."""
from pathlib import Path
import sys,json,tempfile,subprocess,os
from openpyxl import load_workbook
root=Path(sys.argv[1]).resolve();contract=json.loads((root/'contract.json').read_text());runtime=Path('/Users/ganadi/.cache/codex-runtimes/codex-primary-runtime/dependencies');binary=runtime/'bin/override/soffice';rows=[]
for variant in ['base','edited']:
 out=root/('calculated-'+variant);out.mkdir(exist_ok=True)
 with tempfile.TemporaryDirectory(prefix='nubi-reference-calc-',dir='/private/tmp') as profile:
  r=subprocess.run([str(binary),'-env:UserInstallation='+Path(profile).as_uri(),'--headless','--convert-to','xlsx:Calc MS Excel 2007 XML','--outdir',str(out),str(root/(variant+'.xlsx'))],capture_output=True,timeout=90,env={**os.environ,'TMPDIR':'/private/tmp'})
  if r.returncode:raise RuntimeError('calculation_failed')
 book=load_workbook(out/(variant+'.xlsx'),data_only=True);formulas=load_workbook(out/(variant+'.xlsx'),data_only=False)
 for check in contract['checks']:
  actual=book['Checks'][check['cell']].value;preserved=formulas['Checks'][check['cell']].data_type=='f';rows.append(dict(variant=variant,metric=check['metric'],expected=check[variant],actual=actual,formulaPreserved=preserved,passed=actual==check[variant] and preserved))
(root/'result.json').write_text(json.dumps(dict(checks=rows,passed=sum(r['passed'] for r in rows),total=len(rows),nonTargetPreserved=contract['nonTargetPreserved']),indent=2)+'\n');assert all(r['passed'] for r in rows),rows;print(json.dumps(dict(passed=len(rows),total=len(rows),nonTargetPreserved=contract['nonTargetPreserved'])))
