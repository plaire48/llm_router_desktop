"""Index public Microsoft source snapshots; inventory is never an execution result.

Input files are downloaded explicitly by the developer, never from product import.
Only identifiers, categories, version markers and source links are retained.
"""
import hashlib,json,re,sys
from pathlib import Path
from urllib.parse import urljoin
from lxml import html

root=Path(__file__).resolve().parent.parent
source=Path(sys.argv[1]).resolve()
output=root/'eval/capabilities'
digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
page=source/'excel-functions.html'
tree_file=source/'vba-tree.json'
tree=json.loads(tree_file.read_text())
if tree.get('truncated') is not False:raise ValueError('official_tree_incomplete')
base='https://support.microsoft.com/en-us/excel/excel-functions-alphabetical'
functions=[]
for tr in html.fromstring(page.read_bytes()).xpath('//table//tr[td]'):
    cells=tr.xpath('./td');links=cells[0].xpath('.//a[@href]')
    if not links:continue
    anchor=links[0];label=anchor.text_content().strip()
    marker=re.search(r'\(([^)]+)\)',' '.join(cells[0].text_content().split()))
    version=marker.group(1) if marker else None
    category=cells[1].xpath('.//strong/text()')
    for name in label.split(', '):
        # The alphabetical page misspells this label; its linked function URL is BETA.INV.
        canonical='BETA.INV' if name=='BETA.INVn' and 'beta-inv-function' in anchor.get('href') else name
        if not re.fullmatch(r'[A-Z][A-Z0-9.]*',canonical):raise ValueError('function_identifier_invalid')
        functions.append(dict(name=canonical,category=category[0].rstrip(':') if category else 'Unclassified',introduced=version,
            office2016Candidate=version is None or version.isdigit() and int(version)<=2016,
            versionEvidence='official_version_marker' if version else 'unmarked_on_official_list',
            sourceLabel=label,source=urljoin(base,anchor.get('href')),nativeVerified=False,execution='not_evaluated'))
overrides_file=output/'official-function-overrides.json'
overrides=json.loads(overrides_file.read_text())
for name,override in overrides.items():
    matches=[r for r in functions if r['name']==name]
    if len(matches)!=1:raise ValueError('override_function_missing')
    matches[0].update(override)
if len({r['name'] for r in functions})!=len(functions):raise ValueError('duplicate_function')
functions.sort(key=lambda r:r['name'])
provenance=dict(url=base,sha256=digest(page),versionOverridesSha256=digest(overrides_file),scope='Official list filtered by introduction markers and explicitly verified function-page overrides; remaining unmarked entries require installed Office 2016 verification')
(output/'official-excel-functions.json').write_text(json.dumps(dict(kind='official_function_inventory',source=provenance,functions=functions),ensure_ascii=False,indent=2)+'\n')
# This is a complete current-document identifier index, not a frozen Office 2016 type library.
api_counts={}
for app in ['Word','Excel','PowerPoint']:
    entries=[]
    for item in tree['tree']:
        path=item['path']
        if item['type']!='blob' or not path.startswith('api/'+app+'.') or not path.endswith('.md'):continue
        identifier=path[4:-3]
        entries.append(dict(id=identifier,sourceBlob=item['sha'],url='https://learn.microsoft.com/en-us/office/vba/api/'+identifier.lower(),office2016='requires_version_verification',execution='not_evaluated'))
    entries.sort(key=lambda r:r['id']);api_counts[app]=len(entries)
    (output/('official-'+app.lower()+'-api-index.json')).write_text(json.dumps(dict(kind='official_current_vba_document_index',repository='https://github.com/MicrosoftDocs/VBA-Docs',tree=tree['sha'],treeSha256=digest(tree_file),includes='objects, members and enumerations; not all rows are callable functions',office2016Verified=False,entries=entries),ensure_ascii=False,separators=(',',':'))+'\n')
print(json.dumps(dict(functions=len(functions),office2016Candidates=sum(bool(x['office2016Candidate']) for x in functions),apiDocuments=api_counts)))
