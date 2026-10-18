import test from 'node:test';
import assert from 'node:assert/strict';
import {
  boxBlurRGB, mixPreservedPixels, composeAdaptivePixels,
  improvementMetrics, sourceSharpenPixels,
} from '../src/engine.mjs';

function makeImage(width, height, pixel) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const k = (y * width + x) * 4;
    const color = pixel(x, y);
    pixels.set(color, k);
  }
  return pixels;
}

function meanDistance(a,b) {
  let sum=0;
  for(let i=0;i<a.length;i+=4) for(let c=0;c<3;c++) sum+=Math.abs(a[i+c]-b[i+c]);
  return sum/(a.length/4*3);
}

function percentageDifferent(a,b) {
  let changed=0;
  for(let i=0;i<a.length;i+=4) if (Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2])>4) changed++;
  return changed/(a.length/4);
}

const w=80,h=48;
// Synthetic grayscale transition with a fine, aligned texture in the AI prediction.
const baseline=makeImage(w,h,(x,y)=>{
 const edge = (x<25 ? 65 : x<40 ? 65+(x-25)*8 : 185);
 const v = Math.round(edge + ((y%6)<3 ? 2:-2));
 return [v,v,v,255];
});
const coherent=makeImage(w,h,(x,y)=>{
 const k=(y*w+x)*4;
 const v=baseline[k];
 const local = x>20&&x<45 ? ((x+y)%4<2 ? 13:-13) : 0;
 return [v+local,v+local,v+local,255];
});

test('two spatial scales distinguish fine texture and mid-frequency band',()=>{
 const fine=boxBlurRGB(coherent,w,h,2);
 const coarse=boxBlurRGB(coherent,w,h,7);
 assert.equal(fine.length,w*h*3);
 assert.equal(coarse.length,w*h*3);
 assert.ok(Math.abs(fine[40*3]-coarse[40*3])>0);
});

test('preserve does not import hallucinated features in genuinely flat source regions',()=>{
 const flat=makeImage(w,h,()=>[120,120,120,255]);
 const invented=makeImage(w,h,(x,y)=> x>15&&x<65&&y>8&&y<40 ? [245,8,85,255] : [120,120,120,255]);
 const out=mixPreservedPixels(flat,invented,w,h,'preserve');
 assert.deepEqual(out,flat);
});

test('preserve adds coherent high frequency to a real source edge and bounds changes',()=>{
 const out=mixPreservedPixels(baseline,coherent,w,h,'preserve');
 assert.ok(percentageDifferent(out,baseline)>0.03);
 for(let i=0;i<out.length;i+=4) for(let c=0;c<3;c++) assert.ok(Math.abs(out[i+c]-baseline[i+c])<=24);
 assert.ok(meanDistance(out,baseline) < meanDistance(coherent,baseline));
 const metrics=improvementMetrics(baseline,out,w,h);
 assert.ok(metrics.changedFraction > .03);
});

test('the fallback detects ineffective AI and uses conservative source-based sharpening',()=>{
 const {pixels,strategy}=composeAdaptivePixels(baseline,baseline,w,h,'preserve');
 assert.equal(strategy,'source-sharpen');
 assert.ok(meanDistance(pixels,baseline)>0);
 assert.ok(meanDistance(pixels,baseline)<5);
 const flat=makeImage(w,h,()=>[130,130,130,255]);
 const noChange=composeAdaptivePixels(flat,flat,w,h,'preserve');
 assert.equal(noChange.strategy,'ai-guided');
 assert.deepEqual(noChange.pixels,flat);
});

test('all three user presets differ against interpolation and preserve gets smallest drift',()=>{
 const preserve=composeAdaptivePixels(baseline,coherent,w,h,'preserve').pixels;
 const balanced=composeAdaptivePixels(baseline,coherent,w,h,'balanced').pixels;
 const detail=composeAdaptivePixels(baseline,coherent,w,h,'detail').pixels;
 assert.ok(percentageDifferent(preserve,balanced)>0);
 assert.ok(percentageDifferent(balanced,detail)>0);
 const p=meanDistance(baseline,preserve),b=meanDistance(baseline,balanced),d=meanDistance(baseline,detail);
 assert.ok(p < d,`${p} < ${d}`);
 assert.ok(b < d,`${b} < ${d}`);
});

test('transparent pixels and RGB limits survive all processing paths',()=>{
 const source=makeImage(12,12,(x,y)=>[20+x*12,5+y*18,250,(x+y)%2?0:128]);
 const ai=makeImage(12,12,(x,y)=>[250,200,10,255]);
 for(const quality of ['preserve','balanced','detail']) {
  const out=composeAdaptivePixels(source,ai,12,12,quality).pixels;
  for(let i=0;i<source.length;i+=4){
   assert.equal(out[i+3],source[i+3]);
   for(let c=0;c<3;c++) assert.ok(out[i+c]>=0&&out[i+c]<=255);
  }
 }
});
