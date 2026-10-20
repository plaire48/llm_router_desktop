"""Calculate actual GenOffice VLOOKUP writes in independent LibreOffice copies."""
import json,subprocess,tempfile,sys
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as E
root=Path(sys.argv[1]).resolve();runtime=Path('/Users/ganadi/.cache/codex-runtimes/codex-primary-runtime/dependencies')
ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'};rows=[]
for n in range(1,4):
    source=root/f'excel-{n}'/'candidate.xlsx';out=source.parent/'calculated';out.mkdir(exist_ok=True)
    record=dict(repetition=n,expected=15*n,passed=False)
    try:
        with tempfile.TemporaryDirectory(prefix='nubi-rich-lo-',dir='/private/tmp') as profile:
            result=subprocess.run([str(runtime/'bin/override/soffice'),'-env:UserInstallation='+Path(profile).as_uri(),'--headless','--convert-to','xlsx:Calc MS Excel 2007 XML','--outdir',str(out),str(source)],capture_output=True,timeout=90)
        if result.returncode:raise ValueError('calculation_failed')
        with ZipFile(out/source.name) as z:
            tree=E.fromstring(z.read('xl/worksheets/sheet1.xml'));cell=next(c for c in tree.findall('.//s:c',ns) if c.get('r')=='H2');actual=cell.findtext('s:v',namespaces=ns)
            record.update(actual=actual,formula=cell.findtext('s:f',namespaces=ns),passed=cell.get('t')!='e' and actual is not None and abs(float(actual)-15*n)<1e-9)
    except Exception as error:record['errorClass']=type(error).__name__
    rows.append(record)
report=dict(kind='actual_vlookup_on_native_pivot_values',planned=3,passed=sum(x['passed']for x in rows),actualOffice2016=False,pivotRefreshVerified=False,checks=rows)
(root/'calculation-results.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
