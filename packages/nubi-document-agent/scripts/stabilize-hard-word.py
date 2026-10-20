"""Layout adapter for the synthetic new draft only. Never an existing protected-file reader."""
import sys,copy,json
from zipfile import ZipFile,ZIP_DEFLATED
from lxml import etree as E
W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';n={'w':W};q=lambda name:'{'+W+'}'+name
source,output=sys.argv[1:3]
with ZipFile(source) as z:
 tree=E.fromstring(z.read('word/document.xml'));body=tree.find('w:body',n);text_before=tree.xpath('//w:t/text()',namespaces=n)
 sections=[copy.deepcopy(x) for x in tree.xpath('//w:sectPr',namespaces=n)];assert len(sections)==8
 refs=[copy.deepcopy(x) for x in sections[-1] if E.QName(x).localname in ['headerReference','footerReference']]
 for p in list(body):
  sec=p.find('w:pPr/w:sectPr',n)
  if sec is not None:
   if not p.xpath('.//w:t/text()',namespaces=n):body.remove(p)
   else:sec.getparent().remove(sec)
 final=body.find('w:sectPr',n);body.remove(final)
 heads=[p for p in body if p.find('w:pPr/w:pStyle',n) is not None and p.find('w:pPr/w:pStyle',n).get(q('val'))=='Heading1'];assert len(heads)==8
 for i,s in enumerate(sections):
  for child in list(s):
   if E.QName(child).localname in ['headerReference','footerReference']:s.remove(child)
  for ref in reversed(refs):s.insert(0,copy.deepcopy(ref))
  size=s.find('w:pgSz',n);size.set(q('w'),'16838' if i==5 else '11906');size.set(q('h'),'11906' if i==5 else '16838');size.set(q('orient'),'landscape' if i==5 else 'portrait')
  typ=s.find('w:type',n)
  if typ is None:typ=E.SubElement(s,q('type'))
  typ.set(q('val'),'nextPage')
 for i,h in enumerate(heads[1:]):
  p=E.Element(q('p'));props=E.SubElement(p,q('pPr'));props.append(sections[i]);body.insert(body.index(h),p)
 body.append(sections[-1])
 tables=body.findall('w:tbl',n);assert len(tables)==8
 for table in tables:
  for border in table.xpath('.//w:tblBorders/* | .//w:tcBorders/*',namespaces=n):border.set(q('color'),'D9D9D9')
 for p in tables[0].xpath('./w:tr[1]/w:tc/w:p',namespaces=n):
  if not ''.join(p.xpath('.//w:t/text()',namespaces=n)).strip():p.getparent().remove(p)
 # Repeated column labels remain meaningful below the merged approval heading.
 for row in tables[0].findall('w:tr',n)[:2]:
  pr=row.find('w:trPr',n)
  if pr is None:pr=E.SubElement(row,q('trPr'))
  if pr.find('w:tblHeader',n) is None:E.SubElement(pr,q('tblHeader'))
 risk=tables[5]
 tw=risk.find('w:tblPr/w:tblW',n)
 if tw is not None:tw.set(q('w'),'14400');tw.set(q('type'),'dxa')
 for grid in risk.findall('w:tblGrid/w:gridCol',n):grid.set(q('w'),'1800')
 for c in risk.findall('w:tr/w:tc',n):
  width=c.find('w:tcPr/w:tcW',n)
  if width is not None:width.set(q('w'),'1800');width.set(q('type'),'dxa')
 text_after=tree.xpath('//w:t/text()',namespaces=n);assert [t for t in text_before if t.strip()]==[t for t in text_after if t.strip()],'non_target_text_changed'
 with ZipFile(output,'w',ZIP_DEFLATED) as out:
  for name in z.namelist():out.writestr(name,E.tostring(tree,encoding='utf-8',xml_declaration=True,standalone=True) if name=='word/document.xml' else z.read(name))
print(json.dumps({'sections':8,'preservedAllNonemptyText':True,'layoutRepair':'section boundaries and inherited headers','nativeOfficeVerified':False}))
