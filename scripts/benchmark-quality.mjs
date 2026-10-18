/** Deterministic regression benchmark. Synthetic predictions, NOT real model quality. */
import { performance } from 'node:perf_hooks';
import { composeAdaptivePixels, improvementMetrics } from '../src/engine.mjs';
const width=448, height=448;
const baseline=new Uint8ClampedArray(width*height*4);
const prediction=new Uint8ClampedArray(width*height*4);
for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
 const p=(y*width+x)*4;
 const line=Math.abs(x-210)<6?37:0;
 const edge=x<216?65:172;
 const weave=(y%14)<7?-6:6;
 const base=edge+line+weave;
 const extra=(x>185&&x<252) ? ((x+y)%4<2?15:-15) : 0;
 for(let c=0;c<3;c++) { baseline[p+c]=base;prediction[p+c]=base+extra; }
 baseline[p+3]=prediction[p+3]=255;
}
const scenarios=[
  ['bicubic reference',null],
  ...['preserve','balanced','detail'].map(v=>[v,v]),
];
function psnr(a,b) {
  let s=0;
  for(let i=0;i<a.length;i+=4) for(let c=0;c<3;c++) s+=(a[i+c]-b[i+c])**2;
  const mse=s/(a.length/4*3);
  return mse===0 ? null : +(10*Math.log10(255**2/mse)).toFixed(2);
}
const rows=[];
for(const [label,quality] of scenarios) {
 const start=performance.now();
 const {pixels,strategy,metrics}=quality ? composeAdaptivePixels(baseline,prediction,width,height,quality) : {pixels:baseline,strategy:'interpolation',metrics:{meanDifference:0,changedFraction:0}};
 const reference=improvementMetrics(baseline,pixels,width,height);
 rows.push({ mode:label,strategy,meanDifference:+reference.meanDifference.toFixed(3),psnrVsSyntheticTarget:psnr(pixels,prediction),changedFraction:+reference.changedFraction.toFixed(3),processingMs:+(performance.now()-start).toFixed(1) });
}
console.log(JSON.stringify({ disclaimer:'Synthetic AI signal only; target PSNR is valid ONLY for this synthetic fixture and NOT actual image quality',width,height,results:rows},null,2));
