"""PixelLift v1.1.0 UI: browser regressions for full-width interactive preview."""
from pathlib import Path
from playwright.sync_api import sync_playwright
from PIL import Image
import io,base64
R=Path(__file__).resolve().parents[1]
html=(R/'index.html').read_text().replace('<link rel="stylesheet" href="./styles.css" />','').replace('<script defer src="./src/client.js"></script>','')
img_base=base64.b64encode((R/'demo-comparison.jpg').read_bytes()).decode()
html=html.replace('src="./demo-comparison.jpg"',f'src="data:image/jpeg;base64,{img_base}"')
css=(R/'styles.css').read_text();js=(R/'src/client.js').read_text()
png=io.BytesIO();Image.new('RGB',(192,128),(116,82,158)).save(png,'PNG');content=png.getvalue()
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 for width in (320,390,1440):
  page=browser.new_page(viewport={'width':width,'height':900},accept_downloads=True,reduced_motion='reduce')
  errors=[]; page.on('pageerror', lambda e:errors.append(str(e)))
  page.set_content(html,wait_until='domcontentloaded')
  page.add_style_tag(content=css)
  page.add_script_tag(content=js)
  assert page.locator('#dropzone').is_visible()
  # Full width: preview must sit ABOVE controls; no side-by-side composition.
  r=page.evaluate('''() => {const p=document.querySelector('.preview-side').getBoundingClientRect(),m=document.querySelector('.setting-side').getBoundingClientRect(),s=document.querySelector('#dropzone').getBoundingClientRect();return {p:{left:p.left,right:p.right,bottom:p.bottom},m:{left:m.left,top:m.top,right:m.right},s:{left:s.left,right:s.right,width:s.width},viewport:innerWidth,scroll:document.documentElement.scrollWidth}}''')
  assert r['p']['bottom']<=r['m']['top']+2,(width,r)
  assert r['s']['width']>min(250,width*.72),(width,r)
  assert r['scroll']<=width,(width,r)
  # Clicking the big stage summons native file chooser.
  with page.expect_file_chooser() as chooser:
   page.locator('#dropzone').click(position={'x':24,'y':24})
  chooser.value.set_files({'name':'sample.png','mimeType':'image/png','buffer':content})
  page.locator('#compare').wait_for(state='visible')
  assert not page.locator('#dropzone').evaluate('(el) => el.classList.contains("hidden")')
  assert page.locator('#change-image-btn').is_visible()
  assert page.locator('#compare-range').is_disabled()
  assert page.locator('#start-btn').is_enabled()
  page.locator('label.quality-option').nth(2).click()
  page.locator('label.scale-option').nth(0).click()
  assert page.locator('input[name="quality"]:checked').get_attribute('value')=='detail'
  assert page.locator('input[name="scale"]:checked').get_attribute('value')=='2'
  assert '384' in page.locator('#dimensions-value').inner_text()
  # Clicking large image again before processing should open picker.
  with page.expect_file_chooser() as chooser:
   page.locator('#dropzone').click(position={'x':35,'y':75})
  chooser.value.set_files({'name':'replacement.png','mimeType':'image/png','buffer':content})
  page.wait_for_function('document.querySelector("#file-name").textContent.includes("replacement")')
  # Drag a file onto preview while populated.
  data=base64.b64encode(content).decode()
  page.evaluate('''(b64)=>{
   const data=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));
   const dt=new DataTransfer(); dt.items.add(new File([data],'dropped.png',{type:'image/png'}));
   const target=document.querySelector('#dropzone');
   target.dispatchEvent(new DragEvent('dragenter',{bubbles:true,cancelable:true,dataTransfer:dt}));
   if(document.querySelector('#drop-overlay').classList.contains('hidden')) throw new Error('drop overlay not showing');
   target.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}));
  }''',data)
  page.wait_for_function('document.querySelector("#file-name").textContent.includes("dropped")')
  assert page.locator('#drop-overlay').is_hidden()
  # Keyboard activation works while image is selected.
  page.locator('#dropzone').focus()
  with page.expect_file_chooser() as chooser:
   page.keyboard.press('Enter')
  chooser.value.set_files({'name':'keyboard.png','mimeType':'image/png','buffer':content})
  page.wait_for_function('document.querySelector("#file-name").textContent.includes("keyboard")')
  # change button works independently of the comparison target
  with page.expect_file_chooser() as chooser:
   page.locator('#change-image-btn').click()
  chooser.value.set_files({'name':'changed.png','mimeType':'image/png','buffer':content})
  page.wait_for_function('document.querySelector("#file-name").textContent.includes("changed")')
  assert not errors,(width,errors)
  if width==390:
   page.screenshot(path='/mnt/data/pixellift-v1.1.0-preview-mobile.png',full_page=True)
  if width==1440:
   page.screenshot(path='/mnt/data/pixellift-v1.1.0-preview-desktop.png',full_page=True)
  print(f'PASS {width}px | full-width preview, picker, drag&drop, keyboard, quality and scale')
  page.close()
 browser.close()
