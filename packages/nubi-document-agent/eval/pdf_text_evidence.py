"""Map complete slide text to spatial PDF glyphs, independent of font draw order."""
import re,unicodedata

def normalize(text):
 return re.sub(r'\s+','',unicodedata.normalize('NFC',str(text).replace('\\n','\n')))

def text_evidence(chars,element):
 x,y,w,h=[element[k]*72 for k in ['x','y','w','h']];size=element.get('fontSize',20)
 # Adjacent text boxes may share baselines; do not interleave their glyphs.
 chars=[c for c in chars if x-3<=c['x0']<=x+w+3 and c['top']>=y-size]
 lines=[]
 for char in sorted(chars,key=lambda c:(c['top']+c['bottom'])/2):
  center=(char['top']+char['bottom'])/2
  line=next((line for line in reversed(lines) if abs(center-line['center'])<=.4*min(char['size'],line['size'])),None)
  if line is None:lines.append(dict(center=center,size=char['size'],chars=[char]))
  else:line['chars'].append(char)
 mapping=[];sequence=[]
 for line in lines:
  for char in sorted(line['chars'],key=lambda c:c['x0']):
   for ch in normalize(char['text']):sequence.append(ch);mapping.append(char)
 needle=normalize(element['text']);hay=''.join(sequence)
 starts=[m.start() for m in re.finditer(re.escape(needle),hay)] if needle else []
 starts=[n for n in starts if x-3<=mapping[n]['x0']<=x+w+3 and y-size<=mapping[n]['top']<=y+h+size]
 if not starts:return 'missing'
 start=min(starts,key=lambda n:abs(mapping[n]['x0']-x)+abs(mapping[n]['top']-y));selected=mapping[start:start+len(needle)]
 return 'overflow' if any(c['x0']<x-3 or c['x1']>x+w+3 or c['top']<y-3 or c['bottom']>y+h+3 for c in selected) else 'present'
