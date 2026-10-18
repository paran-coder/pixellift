"""Real-click UI regression without local HTTP navigation (some sandboxes block localhost)."""
from pathlib import Path
from playwright.sync_api import sync_playwright
from PIL import Image
import io,re,base64
R=Path(__file__).resolve().parents[1]
html=(R/'index.html').read_text().replace('<link rel="stylesheet" href="./styles.css" />','').replace('<script defer src="./src/client.js"></script>','')
css=(R/'styles.css').read_text()
js=(R/'src/client.js').read_text()
demo=base64.b64encode((R/'demo-comparison.jpg').read_bytes()).decode()
html=html.replace('src="./demo-comparison.jpg"',f'src="data:image/jpeg;base64,{demo}"')
img=io.BytesIO(); Image.new('RGB',(128,96),(220,80,72)).save(img,format='PNG')
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 for width in (320,390,768,1440):
  page=b.new_page(viewport={'width':width,'height':900}, reduced_motion='reduce')
  errors=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.set_content(html,wait_until='domcontentloaded')
  page.add_style_tag(content=css)
  page.add_script_tag(content=js)
  def selected():
   return page.evaluate('''() => ({mode: [...document.querySelectorAll('label.mode-option')].filter(x=>x.querySelector('input').checked).map(x=>x.querySelector('input').value), scale:[...document.querySelectorAll('label.scale-option')].filter(x=>x.querySelector('input').checked).map(x=>x.querySelector('input').value), colors:[...document.querySelectorAll('label.mode-option, label.scale-option')].map(x=>getComputedStyle(x).backgroundColor)})''')
  assert selected()['mode']==['photo']
  assert selected()['scale']==['4']
  # Click visible card surface, never use hidden-input .check(force=True)
  page.locator('label.mode-option').nth(1).click(position={'x':40,'y':45})
  page.locator('label.scale-option').nth(0).click(position={'x':50,'y':30})
  a=selected()
  assert a['mode']==['illustration'] and a['scale']==['2'],a
  # Styles must mirror checked radios, selected = lavender (#f9f0ff)
  assert a['colors'][1]=='rgb(249, 240, 255)' and a['colors'][3]=='rgb(249, 240, 255)',a
  assert a['colors'][0]=='rgb(255, 255, 255)' and a['colors'][4]=='rgb(255, 255, 255)',a
  page.locator('label.mode-option').nth(2).click()
  page.locator('label.scale-option').nth(1).click()
  assert selected()['mode']==['anime'] and selected()['scale']==['4']
  page.locator('#file-input').set_input_files({'name':'sample.png','mimeType':'image/png','buffer':img.getvalue()})
  page.locator('#dimensions-value').wait_for(state='visible')
  page.wait_for_function('document.querySelector("#dimensions-value").textContent.includes("512")')
  assert page.locator('#start-btn').is_enabled()
  assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'),width
  if width==390:
   page.screenshot(path='/mnt/data/pixellift-v1.0.3-mobile-selection.png',full_page=True)
  if width==1440:
   page.locator('#remove-file').click()
   page.screenshot(path='/mnt/data/pixellift-v1.0.3-desktop.png',full_page=True)
  assert not errors,(width,errors)
  print(f'PASS real card click and mode/scale state: {width}px')
  page.close()
 b.close()
