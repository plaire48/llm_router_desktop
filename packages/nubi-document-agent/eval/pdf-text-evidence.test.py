import importlib.util,json,unittest
from pathlib import Path
import pdfplumber
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('evidence',ROOT/'eval/pdf_text_evidence.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class RenderText(unittest.TestCase):
 def test_actual_split_font_math_is_present(self):
  case=ROOT/'artifacts/quality-business-1/codex-renewal-powerpoint/round-0';plan=json.loads((case/'input.json').read_text())['plan'];e=plan['slides'][4]['elements'][2]
  with pdfplumber.open(case/'render/candidate.pdf') as pdf:
   self.assertEqual(m.text_evidence(pdf.pages[4].chars,e),'present')
 def test_second_unchanged_business_ppt_has_no_spurious_missing_text(self):
  case=ROOT/'artifacts/quality-business-1/codex-delivery-powerpoint/round-0';plan=json.loads((case/'input.json').read_text())['plan']
  with pdfplumber.open(case/'render/candidate.pdf') as pdf:
   for i,slide in enumerate(plan['slides']):
    for e in slide['elements']:
     if e['kind'] in ['text','shape'] and e.get('text'):self.assertEqual(m.text_evidence(pdf.pages[i].chars,e),'present')
 def test_missing_reordered_and_overflow_remain_failures(self):
  e=dict(text='ABC − 12',x=1,y=1,w=3,h=1)
  chars=[dict(text=t,x0=72+i*10,x1=81+i*10,top=80,bottom=100,size=20) for i,t in enumerate('ABC−12')]
  self.assertEqual(m.text_evidence(chars,e),'present')
  self.assertEqual(m.text_evidence(chars[:-1],e),'missing')
  swapped=[dict(c) for c in chars];swapped[0]['text']='B';swapped[1]['text']='A';self.assertEqual(m.text_evidence(swapped,e),'missing')
  outside=[dict(c,top=c['top']+50,bottom=c['bottom']+50) for c in chars];self.assertEqual(m.text_evidence(outside,e),'overflow')
 def test_an_identical_neighbor_cannot_hide_missing_target(self):
  e=dict(text='ABC',x=1,y=1,w=2,h=1)
  other=[dict(text=t,x0=400+i*10,x1=409+i*10,top=80,bottom=100,size=20) for i,t in enumerate('ABC')]
  self.assertEqual(m.text_evidence(other,e),'missing')
if __name__=='__main__':unittest.main()
