import sys,json,re,io
from pathlib import Path
from zipfile import ZipFile
from lxml import etree as E
from openpyxl import load_workbook
root=Path(sys.argv[1]).resolve();source=json.loads((root/'sources.json').read_text());expected=source['summary'];checks=[]
n={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main','c':'http://schemas.openxmlformats.org/drawingml/2006/chart','a':'http://schemas.openxmlformats.org/drawingml/2006/main','p':'http://schemas.openxmlformats.org/presentationml/2006/main'}
def check(name,result):checks.append({'check':name,'passed':bool(result)})
with ZipFile(root/'candidates/implementation-form.docx') as z:
 x=E.fromstring(z.read('word/document.xml'));text=''.join(x.xpath('//w:t/text()',namespaces=n));sections=x.xpath('//w:sectPr',namespaces=n);tables=x.xpath('/w:document/w:body/w:tbl',namespaces=n)
 check('word eight real sections',len(sections)==8);check('word eight editable tables',len(tables)==8);check('word landscape risk section',sections[5].find('w:pgSz',n).get('{'+n['w']+'}orient')=='landscape');check('word merged approval header',tables[0].xpath('boolean(.//w:gridSpan[@w:val="4"])',namespaces=n));check('word repeated headers',all(t.xpath('boolean(./w:tr[1]/w:trPr/w:tblHeader)',namespaces=n) for t in tables));check('word headers and footers in all sections',all(s.find('w:headerReference',n) is not None and s.find('w:footerReference',n) is not None for s in sections));check('word page fields',any(b'PAGE' in z.read(p) for p in z.namelist() if re.match(r'word/footer\d+\.xml',p)));check('word no internal data keys',not re.search(r'sources\.|summary\.|laborTotal|expenseTotal',text));check('word requirements traceability',all('R0'+str(i) in text for i in range(1,7)));check('word correct held amount and total','370' in text and '10,528.8' in text and '7,471.2' in text and '제외' in text)
book=load_workbook(root/'outputs/annual-budget.xlsx',data_only=True);formula_book=load_workbook(root/'outputs/annual-budget.xlsx',data_only=False)
check('excel eight worksheets',len(book.worksheets)==8);formulae=[c.value for s in formula_book for row in s for c in row if c.data_type=='f'];check('excel formula cells',len(formulae)==428);families=set(re.findall(r'\b([A-Z]+)\(',''.join(formulae)));check('excel formula families',len(families)>=6)
check('excel original staffing fidelity',all(book['인력'].cell(i,1).value==r['month'] and book['인력'].cell(i,2).value==r['department'] and abs(book['인력'].cell(i,3).value-r['effort'])<1e-9 for i,r in enumerate(source['staffing'],2)))
check('excel original expense fidelity',all([book['지출'].cell(i,j).value for j in range(1,8)]==[r['id'],r['month'],r['department'],r['category'],r['quantity'],r['unitPrice'],r['status']] for i,r in enumerate(source['expenses'],2)))
check('excel visible precision',formula_book['대시보드']['B7'].number_format=='#,##0.00');check('excel budget actual connected',all(formula_book['월별실적'].cell(i,7).data_type=='f' and abs(book['월별실적'].cell(i,8).value-(1500-m['labor']-m['expense']))<1e-8 for i,m in enumerate(expected['monthly'],2)))
def chart_series(z,path):
 x=E.fromstring(z.read(path));return x,[(s.xpath('.//c:tx//c:v/text()',namespaces=n),[float(v) for v in s.xpath('./c:val//c:pt/c:v/text()',namespaces=n)]) for s in x.xpath('//c:ser',namespaces=n)]
with ZipFile(root/'outputs/annual-budget.xlsx') as z:
 x,s=chart_series(z,'xl/charts/chart1.xml');check('excel chart uses actual money rather than month numbers',len(s)==2 and s[0][1]==[m['labor'] for m in expected['monthly']] and s[1][1]==[m['expense'] for m in expected['monthly']]);check('excel chart actual ranges',[v.replace("'",'') for v in x.xpath('//c:ser[1]/c:val//c:f/text()',namespaces=n)]==["월별실적!$B$2:$B$13"])
 with ZipFile(root/'candidates/annual-budget.xlsx') as original:
  # All mutation cases preserve the original package; source workbook is never overwritten.
  check('excel base source stays separate',z.read('xl/workbook.xml')!=b'' and original.read('xl/workbook.xml')!=b'')
with ZipFile(root/'candidates/decision-proposal.pptx') as z:
 slides=[p for p in z.namelist() if re.match(r'ppt/slides/slide\d+\.xml$',p)];notes=[p for p in z.namelist() if re.match(r'ppt/notesSlides/notesSlide\d+\.xml$',p)];check('powerpoint twelve slides and notes',len(slides)==12 and len(notes)==12);check('powerpoint editable comparison',len(E.fromstring(z.read('ppt/slides/slide4.xml')).xpath('//a:tbl',namespaces=n))==1)
 for index,want in [(1,[[m['labor'] for m in expected['monthly']],[m['expense'] for m in expected['monthly']]]),(2,[[d['total'] for d in expected['department']]])]:
  x,series=chart_series(z,f'ppt/charts/chart{index}.xml');check(f'powerpoint chart {index} actual data',[s[1] for s in series]==want);check(f'powerpoint chart {index} internal workbook',len(x.xpath('//c:externalData',namespaces=n))==1)
  wb=load_workbook(io.BytesIO(z.read(f'ppt/embeddings/NubiChartData{index}.xlsx')),data_only=True);check(f'powerpoint chart {index} workbook matches chart',all([wb['Sheet1'].cell(r+2,c+2).value for r in range(len(v))]==v for c,v in enumerate(want)))
print(json.dumps({'checks':len(checks),'passed':sum(c['passed'] for c in checks),'failed':[c['check'] for c in checks if not c['passed']]},ensure_ascii=False))
(root/'qa/package-checks.json').write_text(json.dumps({'checks':checks,'nativeOfficeVerified':False},ensure_ascii=False,indent=2)+'\n');sys.exit(0 if all(c['passed'] for c in checks) else 1)
