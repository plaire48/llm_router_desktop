"""Independent local quality gates for newly generated synthetic drafts, never protected originals."""
import argparse
import importlib.util
import json
import os
import subprocess
from pathlib import Path
from pdf2image import convert_from_path
from pypdf import PdfReader

parser=argparse.ArgumentParser()
parser.add_argument('domain',choices=['word','excel','powerpoint'])
parser.add_argument('source',type=Path)
parser.add_argument('output',type=Path)
args=parser.parse_args()
runtime=Path(os.environ['NUBI_QA_RUNTIME'])
bin_dir=runtime/'bin/override'
os.environ['PATH']=str(bin_dir)+os.pathsep+os.environ.get('PATH','')
args.output.mkdir(parents=True,exist_ok=True)
# Reuse the prior independent XML/calculation helper; no golden drafts are loaded.
spec=importlib.util.spec_from_file_location('office_qa',Path(__file__).with_name('qa-office-examples.py'))
helper=importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)
helper.BIN=bin_dir
failed=[]
report={'domain':args.domain,'passed':False,'failed':failed,'calculationVerified':False,'visualReviewRequired':True,'actualOffice2016':False,'nascaVerified':False}
try:
    source=args.source.resolve()
    if args.domain=='excel':
        source=helper.convert(source,args.output/'calculated','xlsx:Calc MS Excel 2007 XML')
        cells=helper.read_book(source)
        totals=[float(cells[0][address]['value']) for address in ['B5','C5','D5','E5']]
        if totals != [6,3,3,.5]: failed.append('calculated_totals')
        report['calculatedTotals']=totals
        report['calculatedArtifact']=str(source)
        for sheet in cells:
            if any(str(c['value']).startswith(('#REF!','#DIV/0!','#VALUE!','#NAME?','#N/A','#NUM!','#NULL!')) for c in sheet.values()): failed.append('formula_error')
        cases=[]
        for name,values,expected in [('changed-review',{'C4':1},[6,4,2,4/6]),('zero-created',{'B2':0,'B3':0,'B4':0,'C2':0,'C3':0,'C4':0},[0,0,0,0])]:
            changed=args.output/name/'draft.xlsx';changed.parent.mkdir(parents=True,exist_ok=True)
            helper.change_inputs(args.source,changed,values)
            recalculated=helper.convert(changed,changed.parent/'calculated','xlsx:Calc MS Excel 2007 XML')
            readback=helper.read_book(recalculated)
            actual=[float(readback[0][a]['value']) for a in ['B5','C5','D5','E5']]
            passed=all(abs(a-b)<1e-12 for a,b in zip(actual,expected))
            cases.append({'case':name,'passed':passed,'actual':actual,'expected':expected})
            if not passed: failed.append(name)
        report['recalculationCases']=cases
        report['calculationVerified']=not failed
    pdf=helper.convert(source,args.output/'render','pdf')
    pages=PdfReader(pdf).pages
    report['pageCount']=len(pages)
    if args.domain=='word' and len(pages)!=1: failed.append('word_one_page')
    if args.domain=='powerpoint' and len(pages)!=3: failed.append('three_slides')
    requirements={'word':[['Word','Excel','PowerPoint','김민수','이지은','박서준','50%']], 'excel':[['50.0%','보류'],['김민수','이지은','박서준']], 'powerpoint':[['50%'],['Word','Excel','PowerPoint','합계'],['김민수','이지은','박서준']]}
    for index,required in enumerate(requirements[args.domain]):
        # The Word task is one page; on overflow verify content globally and report the layout failure separately.
        text=''.join(''.join(p.extract_text().split()) for p in pages) if args.domain=='word' else ''.join(pages[index].extract_text().split()) if index<len(pages) else ''
        if any(label not in text for label in required): failed.append('rendered_content_'+str(index+1))
    previews=[]
    for index,page in enumerate(convert_from_path(pdf,dpi=110,poppler_path=str(bin_dir)),1):
        path=args.output/'render'/f'page-{index}.png';page.save(path);previews.append(str(path))
    report['previews']=previews
    if args.domain=='powerpoint':
        tools=Path(os.environ['NUBI_PPT_SKILL'])/'container_tools'
        structural=[]
        for script,extra in [('inspect_presentation_package_integrity.py',[]),('inspect_presentation_layout_geometry.py',['--expected-slide-size-emu','12192000,6858000','--validate-heading-fit','--require-native-table-slide','2','--require-native-table-slide','3'])]:
            proc=subprocess.run([os.sys.executable,str(tools/script),str(source),*extra],capture_output=True,text=True,timeout=45)
            result=json.loads(proc.stdout);structural.append(result)
            if proc.returncode: failed.append(script.removesuffix('.py'))
        report['structure']=structural
    report['passed']=not failed
except Exception as error:
    # No raw subprocess output, source text, credentials or account diagnostics in logs.
    failed.append('local_artifact_verification_failed')
    report['errorClass']=type(error).__name__
(args.output/'verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report,ensure_ascii=False))
