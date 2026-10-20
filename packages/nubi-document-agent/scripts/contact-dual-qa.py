from pathlib import Path
from PIL import Image,ImageDraw
import sys,json
r=Path(sys.argv[1]).resolve();qa=r/'qa'
for p in qa.glob('*/checks.json'):
 row=json.loads(p.read_text());folder=p.parent/'render';pages=sorted(folder.glob('page-*.png'),key=lambda p:int(p.stem.split('-')[-1]))
 if not pages:continue
 target=p.parent/'contact.jpg'
 if target.exists() and target.stat().st_mtime>max(x.stat().st_mtime for x in pages):continue
 thumbs=[];width=500
 for page in pages:
  im=Image.open(page).convert('RGB');im.thumbnail((width,760));canvas=Image.new('RGB',(width,im.height+24),'#e5e8eb');canvas.paste(im,((width-im.width)//2,24));ImageDraw.Draw(canvas).text((8,5),page.stem,fill='black');thumbs.append(canvas)
 height=max(x.height for x in thumbs);out=Image.new('RGB',(width*2,height*((len(thumbs)+1)//2)),'#cdd1d5')
 for i,im in enumerate(thumbs):out.paste(im,((i%2)*width,(i//2)*height))
 out.save(target);print(row['id'],len(pages))
