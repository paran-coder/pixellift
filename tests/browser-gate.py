"""Chromium integration: mock 4x tensor yields a flat AI prediction; weak model gain is reported honestly."""
from pathlib import Path
from playwright.sync_api import sync_playwright
R=Path(__file__).resolve().parents[1]
engine=(R/'src/engine.mjs').read_text().replace('export ','')
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    page=browser.new_page()
    page.set_content('<html><body></body></html>')
    page.add_script_tag(content=engine+'\nwindow.__upscale=upscaleImage;')
    result=page.evaluate('''async () => {
      const c=document.createElement('canvas'); c.width=28;c.height=16;
      const ctx=c.getContext('2d');ctx.fillStyle='#232323';ctx.fillRect(0,0,14,16);
      ctx.fillStyle='#e7e7e7';ctx.fillRect(14,0,14,16);
      class Tensor { constructor(_,data,dims){this.data=data;this.dims=dims;}dispose(){} }
      const ort={Tensor};
      const session={inputNames:['input'],outputNames:['output'],async run(feed) {
        const [b,c,h,w]=feed.input.dims;
        const prediction=new Float32Array(h*w*16*3);prediction.fill(.5);
        return { output:{dims:[1,3,h*4,w*4],data:prediction,dispose(){}} };
      }};
      const result={};
      for(const factor of [2,4]) {
        let qualityReport=null;
        const out=await window.__upscale({bitmap:c,factor,quality:'preserve',ort,session,
          signal:new AbortController().signal,onQualityReport:r=>qualityReport=r});
        result[factor]={width:out.width,height:out.height,qualityReport};
        out.width=out.height=0;
      }
      return result;
    }''')
    for f in ('2','4'):
        report=result[f]['qualityReport']
        assert result[f]['width']==28*int(f),result
        assert report['limitedImpactTiles']+report['baselineOnlyTiles']>=1,report
        assert report['aiGuidedTiles']+report['limitedImpactTiles']+report['baselineOnlyTiles']==report['totalTiles'],report
    print('PASS 2x/4x no-gain edge case -> limited/baseline effect reported:',result)
    page.close();browser.close()
