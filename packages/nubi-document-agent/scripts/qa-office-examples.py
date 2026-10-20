"""Independent OOXML readback and LibreOffice recalculation of new synthetic files only."""
import json
import os
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from pdf2image import convert_from_path
from pypdf import PdfReader

ROOT = Path(sys.argv[1]).resolve()
RUNTIME = Path('/Users/ganadi/.cache/codex-runtimes/codex-primary-runtime/dependencies')
BIN = RUNTIME / 'bin/override'
NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}

def read_book(path):
    with ZipFile(path) as z:
        strings = []
        if 'xl/sharedStrings.xml' in z.namelist():
            strings = [''.join(si.itertext()) for si in ET.fromstring(z.read('xl/sharedStrings.xml'))]
        result = []
        for name in ['xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']:
            cells = {}
            for c in ET.fromstring(z.read(name)).findall('.//s:sheetData/s:row/s:c', NS):
                value = c.find('s:v', NS)
                value = value.text if value is not None else None
                if c.get('t') == 's' and value is not None:
                    value = strings[int(value)]
                if c.get('t') == 'inlineStr':
                    value = ''.join(c.find('s:is', NS).itertext())
                formula = c.find('s:f', NS)
                cells[c.get('r')] = {'value': value, 'formula': formula.text if formula is not None else None}
            result.append(cells)
        return result

def convert(source, out, extension):
    out.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='nubi-office-qa-', dir='/private/tmp') as profile:
        proc = subprocess.run([str(BIN/'soffice'), '-env:UserInstallation='+Path(profile).as_uri(), '--headless', '--convert-to', extension, '--outdir', str(out), str(source)], capture_output=True, text=True, timeout=60)
        if proc.returncode:
            raise RuntimeError('local_conversion_failed: '+proc.stderr[:200])
    target = out / (source.stem + '.' + extension.split(':')[0])
    if not target.is_file():
        raise RuntimeError('local_conversion_output_missing')
    return target

def change_inputs(source, target, values):
    with ZipFile(source) as z, ZipFile(target, 'w', ZIP_DEFLATED) as out:
        for entry in z.infolist():
            data = z.read(entry.filename)
            if entry.filename == 'xl/worksheets/sheet2.xml':
                xml = ET.fromstring(data)
                for c in xml.findall('.//s:c', NS):
                    if c.get('r') in values:
                        c.find('s:v', NS).text = str(values[c.get('r')])
                data = ET.tostring(xml, encoding='utf-8', xml_declaration=True)
            out.writestr(entry, data)

def main():
    os.environ['PATH'] = str(BIN) + os.pathsep + os.environ.get('PATH', '')
    os.environ['FONTCONFIG_FILE'] = str(ROOT.parent/'fontconfig/fonts.conf')
    os.environ['SAL_FONTPATH'] = '/System/Library/Fonts'
    source = ROOT/'drafts/excel-report.xlsx'
    final = convert(source, ROOT/'outputs', 'xlsx:Calc MS Excel 2007 XML')
    data = read_book(final)
    assert [float(data[0][c]['value']) for c in ['B5','C5','D5','E5']] == [6,3,3,.5]
    assert data[0]['B5']['formula'].upper() == 'SUM(B2:B4)'
    assert '/' in data[0]['E5']['formula']
    assert data[1]['F2']['value'] == '김민수'
    assert data[1]['F3']['value'] == '이지은'
    assert data[1]['F4']['value'] == '박서준'
    assert data[0]['B7']['value'] == '보류'
    for cells in data:
        assert not any(str(c['value']).startswith(('#REF!','#DIV/0!','#VALUE!','#NAME?','#N/A','#NUM!','#NULL!')) for c in cells.values())
    cases=[]
    for name,values,expected in [
        ('changed-review', {'C4':1}, [6,4,2,4/6]),
        ('zero-created', {'B2':0,'B3':0,'B4':0,'C2':0,'C3':0,'C4':0}, [0,0,0,0])
    ]:
        path=ROOT/'qa'/name/'excel-report.xlsx';path.parent.mkdir(parents=True,exist_ok=True)
        change_inputs(source,path,values)
        recalculated=convert(path,path.parent/'calculated','xlsx:Calc MS Excel 2007 XML')
        readback=read_book(recalculated)
        actual=[float(readback[0][c]['value']) for c in ['B5','C5','D5','E5']]
        assert all(abs(a-b)<1e-12 for a,b in zip(actual,expected)), (name,actual,expected)
        cases.append({'case':name,'expected':expected,'actual':actual,'passed':True})
    previews=[]
    for source in [final, ROOT/'outputs/powerpoint-report.pptx']:
        pdf=convert(source,ROOT/'qa'/source.suffix[1:],'pdf')
        expected = [['검토 완료','50.0%','보류'], ['김민수','이지은','박서준']] if source.suffix=='.xlsx' else [['50%','보류'],['Word','Excel','PowerPoint','합계'],['김민수','이지은','박서준','출처 확인']]
        rendered = PdfReader(pdf).pages
        assert len(rendered)==len(expected)
        for page, required in zip(rendered, expected):
            visible = page.extract_text() or ''
            assert all(text in visible for text in required), ('required_content_not_rendered',required)
        pages=convert_from_path(pdf,dpi=110,poppler_path=str(BIN))
        for i,page in enumerate(pages,1):
            path=pdf.parent/f'page-{i}.png';page.save(path);previews.append(str(path))
    (ROOT/'qa/readback.json').write_text(json.dumps({'engine':'bundled LibreOffice', 'independentXmlReadback':True,'baseTotals':[6,3,3,.5], 'recalculationCases':cases,'previews':previews,'actualOffice2016':False,'nascaVerified':False,'modelMeasured':False},ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'basePassed':True,'recalculationCases':len(cases),'renderedPages':len(previews)}))

if __name__ == '__main__':
    main()
