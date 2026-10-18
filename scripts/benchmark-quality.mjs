/** PixelLift v1.3.0 benchmark: independently generated synthetic high-res target.
 * NOT a real-model result, not a human-quality metric, and not a replacement for
 * 30-image/2x-4x browser validation. In-memory diagnostic only.
 */
import {performance} from 'node:perf_hooks';
import {composeAdaptivePixels, improvementMetrics} from '../src/engine.mjs';
const w=128,h=112;
const create=fn=>{
 const o=new Uint8ClampedArray(w*h*4);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const i=(y*w+x)*4;
  const v=fn(x,y);
  for(let c=0;c<3;c++)o[i+c]=v[c]??v[0];o[i+3]=255;
 }
 return o;
};
// Coarsely reconstructed lines from an unknown scene, with a small LR-visible texture.
const baseline=create((x,y)=>{
 const broad=(x<36?65:x<80?138:204)+(y%10<5?3:-3);
 return [broad,broad+2,broad-2];
});
// INDEPENDENT mathematical reference: thin strokes emerge where source already
// contains an edge, NOT just equal to whatever the model predicted.
const target=create((x,y)=>{
 const i=(y*w+x)*4;
 const v=(x>29&&x<88&&y>7&&y<99)?(x%2? -10:10):0;
 return [baseline[i]+v,baseline[i+1]+v,baseline[i+2]+v];
});
// Synthetic model approximates true strokes but also has a wrong global color
// shift and hallucinated texture in flat background.
const prediction=create((x,y)=>{
 const i=(y*w+x)*4;
 const hallucination=x<13&&y<21?(x%2?17:-17):0;
 return [target[i]+7+hallucination,target[i+1]+7+hallucination,target[i+2]+7+hallucination];
});
const mse=(a,b)=>{
 let sum=0,n=0;for(let i=0;i<a.length;i+=4)for(let c=0;c<3;c++){
  sum+=(a[i+c]-b[i+c])**2;n++;
 }return sum/n;
};
const psnr=(a,b)=>{const m=mse(a,b);return m?+(10*Math.log10(255**2/m)).toFixed(2):null;};
const results=[];
for(const [name,quality] of [['baseline',null],['preserve','preserve'],['balanced','balanced'],['detail','detail']]) {
 const t=performance.now();
 const value=quality?composeAdaptivePixels(baseline,prediction,w,h,quality):{pixels:baseline,strategy:'interpolation'};
 const metrics=improvementMetrics(baseline,value.pixels,w,h);
 results.push({mode:name,strategy:value.strategy,psnrAgainstIndependentSyntheticTarget:psnr(value.pixels,target),meanDifferenceFromBaseline:+metrics.meanDifference.toFixed(3),changedFraction:+metrics.changedFraction.toFixed(3),processingMs:+(performance.now()-t).toFixed(1)});
}
const out={version:'1.3.0',type:'independent-synthetic-target',disclaimer:'This tests one deliberately constructed synthetic case. It is NOT an observed real-image/model performance score, and PSNR cannot measure perceptual benefit alone.',width:w,height:h,results};
console.log(JSON.stringify(out,null,2));
