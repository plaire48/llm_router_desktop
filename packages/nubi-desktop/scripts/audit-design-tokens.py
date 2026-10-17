"""Development audit; requires tinycss2. Never changes product styles."""
import collections
import json
import pathlib
import re
import sys
import tinycss2

root = pathlib.Path(__file__).resolve().parents[1]
output = root / 'verification/design-token-audit-2026-10-17'
output.mkdir(parents=True, exist_ok=True)
meta = json.loads((root / 'generated/electron-bundle.json').read_text())
reachable = {(root / name).resolve() for name in meta['inputs']}
files = set(root.glob('design/*.css')) | set(root.glob('ui/**/*.css')) | set(root.glob('electron-app/*.css'))
files |= {p for p in reachable if p.suffix == '.css' and 'node_modules' not in p.parts}
records = []

def visit(rules, file, selector=''):
    for rule in rules:
        if rule.type == 'qualified-rule':
            label = tinycss2.serialize(rule.prelude).strip()
            for decl in tinycss2.parse_declaration_list(rule.content, skip_comments=True, skip_whitespace=True):
                if decl.type != 'declaration':
                    continue
                prop, value = decl.lower_name, tinycss2.serialize(decl.value).strip()
                if prop.startswith('--'):
                    continue
                category = None
                if prop in ('font', 'font-size', 'font-family', 'font-weight', 'line-height', 'letter-spacing'):
                    category = 'typography'
                elif prop in ('color', 'background', 'background-color', 'border', 'border-color', 'border-top', 'border-right', 'border-bottom', 'border-left', 'fill', 'stroke', 'box-shadow', 'text-shadow', 'outline', 'outline-color'):
                    category = 'color'
                elif prop.startswith(('padding', 'margin', 'gap', 'row-gap', 'column-gap')) or prop == 'border-radius':
                    category = 'spacing'
                if not category:
                    continue
                token = 'var(' in value
                literal = bool(re.search(r'#[\da-f]{3,8}\b|(?:rgb|hsl)a?\(', value, re.I)) if category == 'color' else bool(re.search(r'\d(?:px|rem|em)\b', value) or prop == 'font-weight' and re.fullmatch(r'\d+', value) or prop == 'line-height' and re.fullmatch(r'[\d.]+', value) or prop == 'font-family' and not token and value not in ('inherit','initial','unset'))
                records.append({'file':str(file.relative_to(root)) if file.is_relative_to(root) else str(file), 'line':decl.source_line, 'selector':label, 'property':prop, 'value':value, 'category':category, 'token':token, 'literal':literal, 'reachable':file in reachable})
        elif rule.type == 'at-rule' and rule.content and rule.lower_at_keyword not in ('font-face','keyframes','-webkit-keyframes'):
            visit(tinycss2.parse_rule_list(rule.content, skip_comments=True, skip_whitespace=True),file)

for file in sorted(files):
    visit(tinycss2.parse_stylesheet(file.read_text(), skip_comments=True, skip_whitespace=True),file.resolve())

summary = {'files':len(files),'reachableFiles':sum(file.resolve() in reachable for file in files),'definitionsExcluded':True,'note':'Token-reference ratio is measured per declaration, not a claim of rendered consistency. Mixed literal/token declarations remain flagged.'}
for category in ('typography','color','spacing'):
    group=[r for r in records if r['category']==category and r['reachable']]
    summary[category]={'declarations':len(group),'tokenReferences':sum(r['token'] for r in group),'literalDeclarations':sum(r['literal'] for r in group),'tokenReferencePercent':round(100*sum(r['token'] for r in group)/max(1,len(group)),1)}
summary['literalByFile']=dict(collections.Counter(r['file'] for r in records if r['reachable'] and r['literal']).most_common())
label=sys.argv[1] if len(sys.argv)>1 else 'current'
(output/(label+'-inventory.json')).write_text(json.dumps({'summary':summary,'declarations':records},ensure_ascii=False,indent=2)+'\n')
print(json.dumps(summary,ensure_ascii=False,indent=2))
