"""Browser engine end-to-end compositing using a deterministic mocked 4x ONNX model.
This validates tile rendering, quality stages and alpha; NOT a real AI inference test.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
R=Path(__file__).resolve().parents[1]
engine=(R/'src/engine.mjs').read_text().replace('export ','')
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    page=browser.new_page()
    page.set_content('<html><body></body></html>')
    page.add_script_tag(content=engine+'\nwindow.__qa={upscaleImage,MODEL_CONFIG,QUALITY_PRESETS};')
    results=page.evaluate('''async () => {
      const canvas=document.createElement('canvas');canvas.width=4;canvas.height=3;
      const ctx=canvas.getContext('2d');ctx.fillStyle='rgb(100,110,120)';ctx.fillRect(0,0,4,3);
      // One transparent pixel is retained as transparent in every output.
      ctx.clearRect(0,0,1,1);
      class Tensor { constructor(_,data,dims) {this.data=data;this.dims=dims;} dispose() {} }
      const ort={Tensor};
      const session={inputNames:['input'],outputNames:['output'],async run(feed) {
        const [_,__,h,w]=feed.input.dims;
        const out=new Float32Array(3*(h*4)*(w*4)); out.fill(.8);
        return {output:{dims:[1,3,h*4,w*4],data:out,dispose() {}}};
      }};
      const ret={};
      for(const factor of [2,4]) {
        for(const quality of ['preserve','balanced','detail']) {
          let count=0;
          const output=await window.__qa.upscaleImage({bitmap:canvas,factor,quality,ort,session,signal:new AbortController().signal,onTile:()=>count++});
          const pixels=output.getContext('2d').getImageData(0,0,output.width,output.height).data;
          const center=(Math.floor(output.height/2)*output.width+Math.floor(output.width/2))*4;
          ret[`${factor}:${quality}`]={width:output.width,height:output.height,center:[...pixels.slice(center,center+4)],alpha:pixels[3],tiles:count};
          output.width=output.height=0;
        }
      }
      return ret;
    }''')
    for factor in (2,4):
        a=results[f'{factor}:preserve'];b=results[f'{factor}:balanced'];c=results[f'{factor}:detail']
        assert a['width']==4*factor and a['height']==3*factor
        assert a['tiles']>0
        assert a['center'][0]==100,a
        assert a['center'][0]<b['center'][0]<c['center'][0],(factor,a,b,c)
        assert a['alpha']==b['alpha']==c['alpha']==0
    print('PASS mock inference and compositing 2x/4x + 3 presets + alpha',results)
    page.close();browser.close()
