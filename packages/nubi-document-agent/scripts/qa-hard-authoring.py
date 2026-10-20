import sys,json,os,subprocess,tempfile,copy,re
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
import xml.etree.ElementTree as ET
from pypdf import PdfReader
from pdf2image import convert_from_path
root=Path(sys.argv[1]).resolve();runtime=Path('/Users/ganadi/.cache/codex-runtimes/codex-primary-runtime/dependencies');bin_dir=runtime/'bin/override';qa=root/'qa';qa.mkdir(exist_ok=True)
fonts=qa/'fonts';fonts.mkdir(exist_ok=True);conf=fonts/'fonts.conf';conf.write_text(f'<?xml version="1.0"?><fontconfig><dir>/System/Library/Fonts</dir><dir>/System/Library/Fonts/Supplemental</dir><cachedir>{fonts}/cache</cachedir></fontconfig>')
os.environ.update(FONTCONFIG_FILE=str(conf),SAL_FONTPATH='/System/Library/Fonts',TMPDIR='/private/tmp',PATH=str(bin_dir)+os.pathsep+os.environ.get('PATH',''))
ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main','r':'http://schemas.openxmlformats.org/officeDocument/2006/relationships','w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main','a':'http://schemas.openxmlformats.org/drawingml/2006/main','p':'http://schemas.openxmlformats.org/presentationml/2006/main'}
def convert(source,out,fmt):
 out.mkdir(parents=True,exist_ok=True)
 with tempfile.TemporaryDirectory(prefix='nubi-hard-lo-',dir='/private/tmp') as profile:
  run=subprocess.run([str(bin_dir/'soffice'),'-env:UserInstallation='+Path(profile).as_uri(),'--headless','--convert-to',fmt,'--outdir',str(out),str(source)],capture_output=True,timeout=60)
 dest=out/(source.stem+'.'+fmt.split(':')[0])
 if run.returncode or not dest.exists():raise RuntimeError('conversion_failed '+source.name+' '+run.stdout.decode(errors='replace')[-200:])
 return dest
def values(path):
 with ZipFile(path) as z:
  rels={r.attrib['Id']:r.attrib['Target'] for r in ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))};out={};errors=[];formulas=[]
  for s in ET.fromstring(z.read('xl/workbook.xml')).find('s:sheets',ns):
   target=rels[s.attrib['{'+ns['r']+'}id']];part=target.lstrip('/') if target.startswith('/') else 'xl/'+target
   cells={}
   for c in ET.fromstring(z.read(part)).findall('.//s:c',ns):
    v=c.find('s:v',ns);f=c.find('s:f',ns)
    if c.attrib.get('t')=='e':errors.append((s.attrib['name'],c.attrib['r'],v.text if v is not None else ''))
    if f is not None:formulas.append((s.attrib['name'],c.attrib['r'],f.text));cells[c.attrib['r']]=float(v.text) if v is not None and v.text is not None and c.attrib.get('t') not in ['s','str','e'] else (v.text if v is not None else None)
   out[s.attrib['name']]=cells
  return out,errors,formulas
def expected(data):
 labor=[round(r['effort']*next(x['monthlyRate'] for x in data['rates'] if x['department']==r['department']),2) for r in data['staffing']]
 expense=[r['quantity']*r['unitPrice'] if r['status']=='확정' else 0 for r in data['expenses']];base=sum(labor)+sum(expense);vat=round(base*data['vatRate'],2);reserve=round(base*data['reserveRate'],2)
 return labor,expense,{'B2':sum(labor),'B3':sum(expense),'B4':base,'B5':vat,'B6':reserve,'B7':base+vat+reserve,'B8':data['approvalLimit'],'B9':data['approvalLimit']-base-vat-reserve,'B10':sum(r['status']=='확정' for r in data['expenses']),'B11':sum(r['status']=='보류' for r in data['expenses']),'B12':(base+vat+reserve)/data['approvalLimit'] if data['approvalLimit'] else 0}
data=json.loads((root/'sources.json').read_text());report={'nativeOfficeVerified':False,'nascaVerified':False,'calculationEngine':'bundled LibreOffice','excel':[],'renders':[]}
book=root/'candidates/annual-budget.xlsx'
def mutate(path,out,changes):
 with ZipFile(path) as z,ZipFile(out,'w',ZIP_DEFLATED) as target:
  for name in z.namelist():
   raw=z.read(name)
   if name in changes or re.match(r'xl/worksheets/sheet\d+\.xml$',name):
    tree=ET.fromstring(raw)
    for addr,value in changes.get(name,{}).items():
     c=next(c for c in tree.findall('.//s:c',ns) if c.attrib['r']==addr)
     for child in list(c):c.remove(child)
     if isinstance(value,str):c.attrib['t']='inlineStr';ET.SubElement(ET.SubElement(c,'{'+ns['s']+'}is'),'{'+ns['s']+'}t').text=value
     else:c.attrib.pop('t',None);ET.SubElement(c,'{'+ns['s']+'}v').text=str(value)
    # Imported calculated files carry caches. Invalidate them after real input edits.
    for c in tree.findall('.//s:c',ns):
     if c.find('s:f',ns) is not None:
      v=c.find('s:v',ns)
      if v is not None:c.remove(v)
    raw=ET.tostring(tree,encoding='utf-8',xml_declaration=True)
   target.writestr(name,raw)
for case in ['base','rate_change','release_hold','zero']:
 case_data=copy.deepcopy(data);case_dir=qa/case;case_dir.mkdir(exist_ok=True);source=book
 if case!='base':
  changes={}
  if case=='rate_change':case_data['rates'][0]['monthlyRate']=198;changes={'xl/worksheets/sheet3.xml':{'B2':198}}
  if case=='release_hold':case_data['expenses'][0]['status']='확정';changes={'xl/worksheets/sheet5.xml':{'G2':'확정'}}
  if case=='zero':
   for r in case_data['rates']:r['monthlyRate']=0
   for r in case_data['expenses']:r['quantity']=0
   case_data['approvalLimit']=0;changes={'xl/worksheets/sheet3.xml':{**{f'B{i}':0 for i in range(2,6)},'B8':0},'xl/worksheets/sheet5.xml':{f'E{i}':0 for i in range(2,98)}}
  source=case_dir/'input.xlsx';mutate(book,source,changes)
 recalced=convert(source,case_dir/'calculated','xlsx');actual,errors,formulae=values(recalced);labor,expense,want=expected(case_data);checks=[]
 def check(label,got,wanted):checks.append({'check':label,'passed':isinstance(got,(float,int)) and abs(got-wanted)<1e-7,'actual':got,'expected':wanted})
 for a,v in want.items():check('대시보드!'+a,actual['대시보드'].get(a),v)
 for i,v in enumerate(labor,2):check('인력!E'+str(i),actual['인력'].get('E'+str(i)),v)
 for i,v in enumerate(expense,2):check('지출!H'+str(i),actual['지출'].get('H'+str(i)),v)
 cumulative=0
 for m in range(1,13):
  row=m+1;l=sum(v for r,v in zip(case_data['staffing'],labor) if r['month']==m);e=sum(v for r,v in zip(case_data['expenses'],expense) if r['month']==m);cumulative+=l+e
  for a,v in [('B',l),('C',e),('D',l+e),('E',cumulative),('F',(l+e)/want['B4'] if want['B4'] else 0),('G',1500),('H',1500-l-e),('I',(l+e)/1500)]:check('월별실적!'+a+str(row),actual['월별실적'].get(a+str(row)),v)
 for i,d in enumerate(['기술','운영','보안','교육'],2):
  l=sum(v for r,v in zip(case_data['staffing'],labor) if r['department']==d);e=sum(v for r,v in zip(case_data['expenses'],expense) if r['department']==d)
  for a,v in [('B',l),('C',e),('D',l+e),('E',sum(r['department']==d and r['status']=='확정' for r in case_data['expenses']))]:check('부서집계!'+a+str(i),actual['부서집계'].get(a+str(i)),v)
 report['excel'].append({'case':case,'passed':not errors and all(c['passed'] for c in checks),'formulaCount':len(formulae),'formulaErrors':errors,'checks':checks,'recalculated':str(recalced)})
 print(json.dumps({'case':case,'checks':len(checks),'passed':report['excel'][-1]['passed']},ensure_ascii=False),flush=True)
 if case=='base':
  (root/'outputs').mkdir(exist_ok=True)
  # The final workbook has actual cached calculation results. Original candidate is retained.
  import shutil;shutil.copy2(recalced,root/'outputs/annual-budget.xlsx')
if '--no-render' not in sys.argv:
 for domain,file in [('word',root/'candidates/implementation-form.docx'),('excel',root/'outputs/annual-budget.xlsx'),('powerpoint',root/'candidates/decision-proposal.pptx')]:
  out=qa/domain;out.mkdir(exist_ok=True)
  if domain=='word':
   skill=Path('/Users/ganadi/.codex/plugins/cache/openai-primary-runtime/documents/26.1009.11318/skills/documents');subprocess.run([sys.executable,str(skill/'render_docx.py'),str(file),'--output_dir',str(out),'--emit_pdf','--dpi','110'],check=True,timeout=60);pdf=out/(file.stem+'.pdf')
  else:
   pdf=convert(file,out,'pdf')
   for i,img in enumerate(convert_from_path(pdf,dpi=110,poppler_path=str(bin_dir)),1):img.save(out/f'page-{i}.png')
  pages=PdfReader(pdf).pages;report['renders'].append({'domain':domain,'pages':len(pages),'text':[p.extract_text() for p in pages],'visualReviewRequired':True})
  print(json.dumps({'domain':domain,'pages':len(pages)},ensure_ascii=False),flush=True)
(qa/'results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
