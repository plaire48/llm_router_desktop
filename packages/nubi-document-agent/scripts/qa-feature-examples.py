import sys,json,os,subprocess,tempfile
from pathlib import Path
from pdf2image import convert_from_path
from pypdf import PdfReader
root=Path(sys.argv[1]).resolve();runtime=Path('/Users/ganadi/.cache/codex-runtimes/codex-primary-runtime/dependencies');bin_dir=runtime/'bin/override'
fonts=root/'qa/fonts';fonts.mkdir(parents=True,exist_ok=True)
config=fonts/'fonts.conf';config.write_text(f'<?xml version="1.0"?><fontconfig><dir>/System/Library/Fonts</dir><dir>/System/Library/Fonts/Supplemental</dir><cachedir>{fonts}/cache</cachedir></fontconfig>')
os.environ['FONTCONFIG_FILE']=str(config);os.environ['SAL_FONTPATH']='/System/Library/Fonts';os.environ['PATH']=str(bin_dir)+os.pathsep+os.environ.get('PATH','')
sources=[('word',root/'word/candidate.docx'),('excel',root/'excel/candidate.xlsx'),('powerpoint',root/'powerpoint/candidate.pptx'),('formulas',root.parent/'formula-wave-2/base/base.xlsx')];results=[]
for domain,source in sources:
    out=root/'qa'/domain;out.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='nubi-feature-render-',dir='/private/tmp') as profile:
        run=subprocess.run([str(bin_dir/'soffice'),'-env:UserInstallation='+Path(profile).as_uri(),'--headless','--convert-to','pdf','--outdir',str(out),str(source)],capture_output=True,timeout=60)
    pdf=out/(source.stem+'.pdf')
    if run.returncode or not pdf.exists():results.append({'domain':domain,'passed':False});continue
    pages=PdfReader(pdf).pages;previews=[]
    for i,page in enumerate(convert_from_path(pdf,dpi=110,poppler_path=str(bin_dir)),1):
        path=out/f'page-{i}.png';page.save(path);previews.append(str(path))
    visible=''.join(''.join(p.extract_text().split()) for p in pages)
    needed={'word':['기능검토','변경대상1','보존문구1'],'excel':['상태','완료','진행','보존문구1'],'powerpoint':['요청접수','검토','완료','보존문구1'],'formulas':['COUNTIFS','SUMIFS','VLOOKUP','2024-02-29']}[domain]
    results.append({'domain':domain,'passed':all(s in visible for s in needed),'pages':len(pages),'previews':previews,'nativeOfficeVerified':False,'visualReviewRequired':True})
(root/'qa/render-results.json').write_text(json.dumps(results,ensure_ascii=False,indent=2)+'\n');print(json.dumps(results,ensure_ascii=False))
