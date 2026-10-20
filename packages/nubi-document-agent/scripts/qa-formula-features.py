"""Calculate synthetic outputs in bundled LO and independently inspect cached values."""
import sys,json,subprocess,tempfile,os
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as ET
root=Path(sys.argv[1]).resolve()
runtime=Path('/Users/ganadi/.cache/codex-runtimes/codex-primary-runtime/dependencies')
ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
contract=json.loads((root/'contracts.json').read_text())
report={'kind':'libreoffice_formula_execution','actualOffice2016':False,'modelMeasured':False,'checks':[]}
for fixture in contract['fixtures']:
    source=Path(fixture['path']);out=root/fixture['name'];out.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='nubi-formula-',dir='/private/tmp') as profile:
        run=subprocess.run([str(runtime/'bin/override/soffice'),'-env:UserInstallation='+Path(profile).as_uri(),'--headless','--convert-to','xlsx:Calc MS Excel 2007 XML','--outdir',str(out),str(source)],capture_output=True,timeout=60)
    try:
        if run.returncode:raise ValueError('calculation_failed')
        with ZipFile(out/source.name) as z:
            strings=[''.join(si.itertext()) for si in ET.fromstring(z.read('xl/sharedStrings.xml'))] if 'xl/sharedStrings.xml' in z.namelist() else []
            cells={}
            for c in ET.fromstring(z.read('xl/worksheets/sheet1.xml')).findall('.//s:sheetData/s:row/s:c',ns):
                value=c.find('s:v',ns);value=value.text if value is not None else None
                if c.get('t')=='s' and value is not None:value=strings[int(value)]
                if c.get('t')=='inlineStr':value=''.join(c.find('s:is',ns).itertext())
                cells[c.get('r')]={'value':value,'error':c.get('t')=='e','formula':c.findtext('s:f',default='',namespaces=ns)}
            for expected in fixture['expected']:
                actual=cells.get(expected['address'],{});value=actual.get('value');wanted=expected['value']
                passed=not actual.get('error') and (value==wanted if isinstance(wanted,str) else value is not None and abs(float(value)-wanted)<1e-10)
                report['checks'].append({'case':fixture['name'],**expected,'actual':value,'savedFormula':actual.get('formula'),'passed':passed})
    except Exception as error:
        report['checks'].extend({'case':fixture['name'],**expected,'passed':False,'errorClass':type(error).__name__} for expected in fixture['expected'])
report['passed']=sum(c['passed'] for c in report['checks']);report['planned']=sum(len(f['expected']) for f in contract['fixtures']);report['failed']=report['planned']-report['passed']
(root/'calculation-results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:report[k] for k in ['planned','passed','failed']}))
