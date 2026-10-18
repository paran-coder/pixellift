"""v1.2.1 browser E2E: actual upload and output UI, with mock AI tensor inference.
Browser interactions are real; this does NOT validate the model weights or actual AI visual quality.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
from PIL import Image
import io
R = Path(__file__).resolve().parents[1]
html=(R/'index.html').read_text().replace('<link rel="stylesheet" href="./styles.css" />','').replace('<script defer src="./src/client.js"></script>','')
css=(R/'styles.css').read_text()
js=(R/'src/client.js').read_text().replace('\n})();', '\nwindow.__qa = {state, ui, setCompareZoom, start};\n})();')
assert 'window.__qa = ' in js
im=Image.open('/mnt/data/owl.png').convert('RGB'); im.thumbnail((144,192))
b=io.BytesIO(); im.save(b, format='PNG'); png=b.getvalue()
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 for width in [390,1440]:
  page=browser.new_page(viewport={'width':width,'height':860},reduced_motion='reduce',has_touch=width==390,is_mobile=width==390)
  errors=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.set_content(html,wait_until='domcontentloaded')
  page.add_style_tag(content=css)
  page.add_script_tag(content=js)
  assert page.locator('#zoom-compare-btn').is_hidden()
  page.locator('#file-input').set_input_files({'name':'owl.png','mimeType':'image/png','buffer':png})
  page.locator('#start-btn').wait_for(state='visible')
  page.evaluate('''() => {
   class Tensor { constructor(_,data,dims){this.data=data;this.dims=dims;}dispose(){} }
   const session={inputNames:['input'],outputNames:['output'],async run(feed) {
      const [b,c,h,w]=feed.input.dims; const arr=new Float32Array(3*16*h*w);
      const source=feed.input.data, area=w*h, target=w*h*16;
      for(let y=0;y<h*4;y++) for(let x=0;x<w*4;x++) {
       const iy=Math.floor(y/4),ix=Math.floor(x/4),src=iy*w+ix,dst=y*w*4+x;
       for(let c=0;c<3;c++) arr[c*target+dst]=Math.min(1,Math.max(0,source[c*area+src]*.95+.02));
      }
      return {output:{dims:[1,3,h*4,w*4],data:arr,dispose(){}}};
   }};
   window.ort={Tensor}; const state=window.__qa.state;
   state.session=session;state.sessionModel='universal';state.provider='QA mock';state.supportsGpu=true;
  }''')
  page.locator('#start-btn').click()
  page.locator('#zoom-compare-btn').wait_for(state='visible',timeout=45000)
  assert page.locator('#compare-range').is_enabled()
  assert page.locator('#zoom-compare-btn').get_attribute('aria-pressed')=='false'
  assert page.locator('#zoom-compare-label').inner_text().startswith('확대 비교')
  page.locator('#zoom-compare-btn').click()
  assert page.locator('#zoom-compare-btn').get_attribute('aria-pressed')=='true'
  assert page.locator('#compare').evaluate('(e)=>e.classList.contains("zoomed")')
  assert page.locator('#compare').evaluate('(e)=>getComputedStyle(e.querySelector("img")).transform')==page.locator('#after-img').evaluate('(e)=>getComputedStyle(e).transform')
  page.locator('#compare').scroll_into_view_if_needed()
  rect=page.locator('#compare').bounding_box()
  # drag from a non-knob location while zoomed
  sx=rect['x']+rect['width']*.3;sy=rect['y']+rect['height']*.4
  if width == 390:
   cdp=page.context.new_cdp_session(page)
   cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':sx,'y':sy,'id':17}]})
   cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':sx+40,'y':sy+45,'id':17}]})
   cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
  else:
   page.mouse.move(sx,sy);page.mouse.down();page.mouse.move(sx+75,sy+50,steps=4);page.mouse.up()
  positions=page.evaluate('''() => {
    const el=document.querySelector('#compare');const img=el.querySelector('#before-img');
    const aft=el.querySelector('#after-img');
    return {zoom:el.style.getPropertyValue('--zoom'),x:el.style.getPropertyValue('--pan-x'),y:el.style.getPropertyValue('--pan-y'),before:getComputedStyle(img).transform,after:getComputedStyle(aft).transform}
  }''')
  assert positions['zoom']=='4',positions
  assert positions['before']==positions['after'],positions
  assert positions['x']!='0px' or positions['y']!='0px',positions
  # The draggable knob moves the split with touch or mouse; range still supports keyboard arrow keys.
  knob=page.locator('.compare-knob');knobpos=knob.bounding_box()
  kx=knobpos['x']+knobpos['width']/2;ky=knobpos['y']+knobpos['height']/2
  if width==390:
   cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':kx,'y':ky,'id':18}]})
   cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':kx+65,'y':ky,'id':18}]})
   cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
  else:
   page.mouse.move(kx,ky);page.mouse.down();page.mouse.move(kx+110,ky,steps=3);page.mouse.up()
  val=int(page.locator('#compare-range').input_value())
  assert val>50,(width,val)
  page.locator('#compare-range').focus()
  page.keyboard.press('ArrowLeft')
  assert int(page.locator('#compare-range').input_value()) < val
  assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
  if width==1440:
   page.locator('#dropzone').screenshot(path='/mnt/data/pixellift-v1.2.1-zoom-desktop.png')
  else:
   page.locator('#dropzone').screenshot(path='/mnt/data/pixellift-v1.2.1-zoom-mobile.png')
  page.locator('#zoom-compare-btn').click()
  assert page.locator('#zoom-compare-btn').get_attribute('aria-pressed')=='false'
  assert page.locator('#compare').evaluate('(e)=>e.style.getPropertyValue("--zoom")')=='1'
  assert page.locator('#compare').evaluate('(e)=>e.style.getPropertyValue("--pan-x")')=='0px'
  # replacing file should reset and conceal comparison tools
  page.locator('#file-input').set_input_files({'name':'replacement.png','mimeType':'image/png','buffer':png})
  page.locator('#zoom-compare-btn').wait_for(state='hidden')
  assert not errors,(width,errors)
  print('PASS',width,'zoom, pan, split knob, keyboard, reset, image replacement, no horizontal overflow')
  page.close()
 browser.close()
