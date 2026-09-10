import sys, tempfile, json
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.utils import simpleSplit
from PIL import Image, ImageDraw, ImageFont
import fitz
from documents import main, extract

out=Path('verification/documents').resolve(); out.mkdir(parents=True,exist_ok=True)
source=out/'operations-source.pdf'
pdf=canvas.Canvas(str(source))
topics=['Workspace security','Permission approval','Execution isolation','Process cancellation','Recovery checkpoints','Deliverable verification']
for index,topic in enumerate(topics):
    pdf.setFont('Helvetica-Bold',18); pdf.drawString(55,785,topic)
    text=f'Section {index+1} covers {topic.lower()}. Every action must leave observable evidence. The task owner reviews the proposed arguments before approving changes. Local data stays in the selected workspace unless the owner explicitly authorizes an external action. A failed operation must return its error and preserve the current checkpoint. '
    y=748
    for paragraph in range(8):
        for line in simpleSplit(text,'Helvetica',10,480):
            pdf.setFont('Helvetica',10);pdf.drawString(55,y,line);y-=13
        y-=10
    pdf.showPage()
pdf.save()
parts=extract(source);assert len(parts)==6;assert all('#page=' in p['reference'] for p in parts)
target=Path(tempfile.mkdtemp(prefix='bundle-',dir=out))/'deliverables'
result=main({'action':'bundle','source':str(source),'output':str(target),'title':'Local task execution report'})
for artifact in result['artifacts']: assert Path(artifact).exists()
for name in ['report.pdf','briefing.pdf']:
    with fitz.open(target/name) as doc:
        text='\n'.join(page.get_text() for page in doc)
        for index in range(6): assert f'operations-source.pdf#page={index+1}' in text, (name,index,text)
        for page in doc:
            for block in page.get_text('blocks'):
                assert block[0]>=0 and block[1]>=0 and block[2]<=page.rect.width+1 and block[3]<=page.rect.height+1, 'Text outside rendered page'
image=Image.new('RGB',(1400,400),'white'); draw=ImageDraw.Draw(image); font=ImageFont.truetype(r'C:\Windows\Fonts\arial.ttf',48);draw.text((60,100),'LOCAL OCR VERIFICATION 4729',font=font,fill='black');scan=out/'scan.png';image.save(scan)
ocr=extract(scan);assert '4729' in ocr[0]['text'],ocr
print(json.dumps({'status':'passed','sections':len(parts),'artifacts':result['artifacts'],'ocr':ocr[0]['text']}))
