"""Independent LibreOffice recalculation of authored synthetic matrix files."""
import json,sys,subprocess,tempfile,hashlib
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as ET
import importlib.util
module_spec=importlib.util.spec_from_file_location('matrix_oracles',Path(__file__).resolve().parent.parent/'eval/office2016-independent-oracles.py');oracles=importlib.util.module_from_spec(module_spec);module_spec.loader.exec_module(oracles)
root=Path(sys.argv[1]).resolve();out=Path(sys.argv[2]).resolve();out.mkdir(parents=True,exist_ok=True)
runtime=Path('/Users/ganadi/.cache/codex-runtimes/codex-primary-runtime/dependencies')
ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main','r':'http://schemas.openxmlformats.org/package/2006/relationships'}
contracts=json.loads((root/'contracts.json').read_text());report={'kind':'libreoffice_and_explicit_independent_matrix_reference','actualOffice2016':False,'sourceContractHash':hashlib.sha256((root/'contracts.json').read_bytes()).hexdigest(),'referenceScriptHash':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'independentOracleScriptHash':hashlib.sha256(Path(module_spec.origin).read_bytes()).hexdigest(),'fixtures':[]}
for fixture in contracts['fixtures']:
    source=Path(fixture['path']);folder=out/fixture['name'];folder.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='nubi-matrix-reference-',dir='/private/tmp') as profile:
        run=subprocess.run([str(runtime/'bin/override/soffice'),'-env:UserInstallation='+Path(profile).as_uri(),'--headless','--convert-to','xlsx:Calc MS Excel 2007 XML','--outdir',str(folder),str(source)],capture_output=True,timeout=90)
    if run.returncode or not (folder/source.name).exists():raise RuntimeError('reference_recalculation_failed')
    with ZipFile(folder/source.name) as z:
        strings=[''.join(si.itertext()) for si in ET.fromstring(z.read('xl/sharedStrings.xml'))] if 'xl/sharedStrings.xml' in z.namelist() else []
        sheets=ET.fromstring(z.read('xl/workbook.xml')).findall('s:sheets/s:sheet',ns);rels={r.get('Id'):r.get('Target') for r in ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))};data={}
        for sheet in sheets:
            target=rels[sheet.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')];path=target.lstrip('/') if target.startswith('/') else 'xl/'+target;cells={}
            for c in ET.fromstring(z.read(path)).findall('.//s:sheetData/s:row/s:c',ns):
                value=c.findtext('s:v',default=None,namespaces=ns);kind=c.get('t')
                if kind=='s' and value is not None:value=strings[int(value)]
                elif kind=='inlineStr':value=''.join(c.find('s:is',ns).itertext())
                elif kind=='b':value=value=='1'
                elif kind not in ['str','e'] and value is not None:value=float(value)
                cells[c.get('r')]={'value':value,'error':kind=='e','formula':c.findtext('s:f',default=None,namespaces=ns)}
            data[sheet.get('name')]=cells
        n=[1,3,0][len(report['fixtures'])];checks=[]
        for case in fixture['checks']:
            original=data[case['sheet']].get(case['address'],{});override=oracles.oracle(case,n)
            checks.append({**case,'reference':override or original,**({'originalLibreOffice':original} if override else {})})
        report['fixtures'].append({'name':fixture['name'],'sourceHash':fixture['sourceHash'],'referenceFileHash':hashlib.sha256((folder/source.name).read_bytes()).hexdigest(),'checks':checks})
(out/'reference.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'fixtures':len(report['fixtures']),'checks':sum(len(f['checks']) for f in report['fixtures'])}))
