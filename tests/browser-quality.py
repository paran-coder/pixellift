"""PixelLift v1.2.0 responsive radio and file interactions on real Chromium. No CDN needed."""
from pathlib import Path
from playwright.sync_api import sync_playwright
from PIL import Image
import io,base64
R=Path(__file__).resolve().parents[1]
html=(R/'index.html').read_text().replace('<link rel="stylesheet" href="./styles.css" />','').replace('<script defer src="./src/client.js"></script>','')
base64demo=base64.b64encode((R/'demo-comparison.jpg').read_bytes()).decode()
html=html.replace('src="./demo-comparison.jpg"',f'src="data:image/jpeg;base64,{base64demo}"')
css=(R/'styles.css').read_text();js=(R/'src/client.js').read_text()
png=io.BytesIO(); Image.new('RGBA',(96,64),(147,94,109,200)).save(png,format='PNG'); data=png.getvalue()
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    for width in (320,360,390,768,1024,1440):
        page=browser.new_page(viewport={'width':width,'height':900},reduced_motion='reduce')
        errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.set_content(html,wait_until='domcontentloaded')
        page.add_style_tag(content=css)
        page.add_script_tag(content=js)
        assert page.locator('input[name="mode"]').count()==0
        assert page.locator('label.quality-option').count()==3
        assert page.locator('input[name="quality"]:checked').get_attribute('value')=='preserve'
        assert page.locator('input[name="scale"]:checked').get_attribute('value')=='4'
        # Cards are visually alongside one another, not stacked.
        boxes=[el.bounding_box() for el in page.locator('label.quality-option').all()]
        assert len(set(round(b['y']) for b in boxes))==1, (width,boxes)
        assert boxes[0]['x']<boxes[1]['x']<boxes[2]['x']
        assert all(b['width'] >= 58 for b in boxes), (width,boxes)
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),width
        for quality in ('balanced','detail','preserve'):
            page.locator(f'label.quality-option:has(input[value="{quality}"])').click()
            assert page.locator('input[name="quality"]:checked').get_attribute('value')==quality
            bg=page.locator(f'label.quality-option:has(input[value="{quality}"])').evaluate('(e)=>getComputedStyle(e).backgroundColor')
            assert bg=='rgb(249, 240, 255)',(width,quality,bg)
        page.locator('label.scale-option:has(input[value="2"])').click()
        page.locator('#file-input').set_input_files({'name':'test.png','mimeType':'image/png','buffer':data})
        page.wait_for_function('document.querySelector("#dimensions-value").textContent.includes("192")')
        assert page.locator('#start-btn').is_enabled()
        if width==390:
            page.screenshot(path='/mnt/data/pixellift-v1.2.0-mobile.png',full_page=True)
        if width==1440:
            page.screenshot(path='/mnt/data/pixellift-v1.2.0-desktop.png',full_page=True)
        assert not errors,(width,errors)
        print(f'PASS {width}px — three horizontal cards; selected states; 2x plan; file upload')
        page.close()
    browser.close()
