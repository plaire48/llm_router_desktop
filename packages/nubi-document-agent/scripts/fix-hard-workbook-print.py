"""Keep the entire monthly chart on one A3 portrait page; change print metadata only."""
import sys,os,tempfile
from zipfile import ZipFile,ZIP_DEFLATED
from pathlib import Path
from lxml import etree as E
for file in sys.argv[1:]:
 path=Path(file);n={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'};q=lambda x:'{'+n['s']+'}'+x
 with ZipFile(path) as z:
  changes={};w=E.fromstring(z.read('xl/workbook.xml'))
  for d in w.xpath('//s:definedName[@name="_xlnm.Print_Area"][@localSheetId="6"]',namespaces=n):d.text="'월별실적'!$A$1:$I$33"
  changes['xl/workbook.xml']=E.tostring(w,encoding='utf-8',xml_declaration=True)
  sheet=E.fromstring(z.read('xl/worksheets/sheet7.xml'));setup=sheet.find('s:pageSetup',n);setup.set('paperSize','8');setup.set('orientation','portrait');setup.set('fitToWidth','1');setup.set('fitToHeight','1');changes['xl/worksheets/sheet7.xml']=E.tostring(sheet,encoding='utf-8',xml_declaration=True)
  fd,tmp=tempfile.mkstemp(dir=path.parent,suffix='.xlsx');os.close(fd)
  with ZipFile(tmp,'w',ZIP_DEFLATED) as out:
   for name in z.namelist():out.writestr(name,changes.get(name,z.read(name)))
 os.replace(tmp,path)
