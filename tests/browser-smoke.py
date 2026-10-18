"""Optional browser integration smoke test; requires: pip install playwright pillow, chromium."""
import http.server, socketserver, threading, io
from pathlib import Path
from PIL import Image
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads=True
server = Server(('127.0.0.1', 0), lambda *args, **kwargs: http.server.SimpleHTTPRequestHandler(*args, directory=str(ROOT/'dist'), **kwargs))
thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
url=f'http://127.0.0.1:{server.server_port}/'
buf=io.BytesIO();Image.new('RGB',(12,10),(200,80,90)).save(buf,'PNG')
file={'name':'test.png','mimeType':'image/png','buffer':buf.getvalue()}
MODEL_BYTES=bytes([1,2,3]); JS_MOCK='''
window.ort = {
  Tensor: class { constructor(type,data,dims){ this.type=type;this.data=data;this.dims=dims;} dispose(){} },
  InferenceSession:{create:async()=>({inputNames:['input'], outputNames:['output'],
    run:async feeds=>{let t=feeds.input, w=t.dims[3],h=t.dims[2], W=w*4,H=h*4;
      let data = new Float32Array(W*H*3); let n=w*h, N=W*H;
      for(let ch=0;ch<3;ch++) for(let y=0;y<H;y++)for(let x=0;x<W;x++)
        data[ch*N+y*W+x]=t.data[ch*n+Math.floor(y/4)*w+Math.floor(x/4)];
      return {output:{dims:[1,3,H,W],data,dispose(){}}};},release:async()=>{}})}
};
'''
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch(headless=True)
  page=browser.new_page(viewport={'width':390,'height':844},accept_downloads=True)
  page.add_init_script(JS_MOCK)
  page.route('https://huggingface.co/**/resolve/main/model.onnx',lambda route:route.fulfill(status=200,content_type='application/octet-stream',body=MODEL_BYTES,headers={'Access-Control-Allow-Origin':'*'}))
  page.goto(url,wait_until='domcontentloaded')
  assert 'PixelLift' in page.title()
  assert page.locator('meta[property="og:image"]').get_attribute('content')=='/og-image.png'
  page.evaluate('''async()=>{const m=await import('./src/engine.mjs'); const bytes=new Uint8Array([1,2,3]);
    const digest=await crypto.subtle.digest('SHA-256',bytes);
    const hash=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
    for(const item of Object.values(m.MODEL_CONFIG)) item.sha256=hash;
  }''')
  for mode in ['photo','illustration','anime']:
   page.set_input_files('#file-input', file)
   page.locator(f'input[name="mode"][value="{mode}"]').check(force=True)
   page.locator('input[name="scale"][value="2"]').check(force=True)
   page.locator('#start-btn').click()
   page.locator('#result-actions').wait_for(state='visible',timeout=10000)
   assert '24 × 20' in page.locator('#result-meta').inner_text()
   with page.expect_download() as download:
    page.locator('#download-btn').click()
   assert download.value.suggested_filename.endswith('_2x.png')
   page.locator('#remove-file').click()
   print('MOCK AI FLOW PASS:',mode)
  assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
  page.reload()
  page.route('https://huggingface.co/**/resolve/main/model.onnx',lambda route:route.abort('failed'))
  page.set_input_files('#file-input',file)
  page.locator('#start-btn').click()
  page.locator('#alert').wait_for(state='visible',timeout=10000)
  assert '모델' in page.locator('#alert').inner_text()
  print('ERROR VISIBLE PASS')
  browser.close()
finally:
 server.shutdown();server.server_close()
