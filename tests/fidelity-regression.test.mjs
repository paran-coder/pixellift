import test from 'node:test';
import assert from 'node:assert/strict';
import { composeAdaptivePixels, mixPreservedPixels, improvementMetrics } from '../src/engine.mjs';

const W=96,H=64;
function img(fn) {
  const a=new Uint8ClampedArray(W*H*4);
  for(let y=0;y<H;y++) for(let x=0;x<W;x++) {
    const j=(y*W+x)*4;
    const v=fn(x,y);
    const p=Array.isArray(v)?v:[v,v,v,255];
    a.set(p,j);
  }
  return a;
}
function mae(a,b) {
  let diff=0;
  for(let i=0;i<a.length;i+=4) for(let c=0;c<3;c++) diff+=Math.abs(a[i+c]-b[i+c]);
  return diff/(a.length/4*3);
}
function source(x,y){
  // Broad image edge with fine crosshatching lost during decimation.
  const region=x<34?67 : x<70?135:193;
  const stable=(y%12<6?3:-3);
  return region+stable;
}
const baseline=img(source);
const groundTruth=img((x,y)=>{
  const b=source(x,y);
  const fine=(x>=28&&x<78&&y>8&&y<56)?(x%2===0?10:-10):0;
  return b+fine;
});
const model=img((x,y)=>{
  const k=(y*W+x)*4;
  const good=groundTruth[k];
  // Hallucinated texture where the source has no supported structure and a
  // global brightness shift that must not be imported in Preserve.
  const fake=x<12&&y<20?(x%2===0?18:-18):0;
  return good+fake+7;
});

test('independent synthetic ground truth: preserve improves on interpolation without importing global shift',()=>{
  const out=composeAdaptivePixels(baseline,model,W,H,'preserve');
  assert.ok(mae(out.pixels,groundTruth)<mae(baseline,groundTruth),
    `${mae(out.pixels,groundTruth)} vs ${mae(baseline,groundTruth)}`);
  // Only small changes in the flat-colored region outside the model texture.
  let total=0,count=0;
  for(let y=22;y<52;y++) for(let x=0;x<12;x++){
    const p=(y*W+x)*4; total+=Math.abs(out.pixels[p]-baseline[p]);count++;
  }
  assert.ok(total/count<1.8,`flat-region change ${total/count}`);
  assert.equal(out.strategy,'ai-guided');
});

test('an entirely hallucinated image region must not get copied into preserve output',()=>{
  const flat=img(()=>[128,128,128,255]);
  const invented=img((x,y)=>x>25&&x<72&&y>15&&y<50?[x%2?243:35,2,180,255]:[128,128,128,255]);
  const out=mixPreservedPixels(flat,invented,W,H,'preserve');
  assert.deepEqual(out,flat);
});

test('perfectly identical prediction is labeled baseline-only, rather than claiming AI gain',()=>{
  for(const quality of ['preserve','balanced','detail']) {
    const out=composeAdaptivePixels(baseline,baseline,W,H,quality);
    assert.equal(out.strategy,'baseline-only');
    assert.deepEqual(out.pixels,baseline);
  }
});

test('preserve has zero low-frequency modelMix; alternative presets differ',()=>{
  const p=composeAdaptivePixels(baseline,model,W,H,'preserve');
  const b=composeAdaptivePixels(baseline,model,W,H,'balanced');
  const d=composeAdaptivePixels(baseline,model,W,H,'detail');
  const mP=improvementMetrics(baseline,p.pixels,W,H).meanDifference;
  const mB=improvementMetrics(baseline,b.pixels,W,H).meanDifference;
  const mD=improvementMetrics(baseline,d.pixels,W,H).meanDifference;
  assert.ok(mP < mB && mB < mD,`${mP},${mB},${mD}`);
});

test('alpha is copied exactly, even when model hallucinates opaque output',()=>{
  const src=img((x,y)=>[80+x,100,140, (x+y)%2?0:120]);
  const ai=img(()=>[254,3,4,255]);
  for(const q of ['preserve','balanced','detail']) {
    const o=mixPreservedPixels(src,ai,W,H,q);
    for(let i=3;i<src.length;i+=4)assert.equal(o[i],src[i]);
  }
});

test('flat model prediction that erases a real source edge is rejected',()=>{
 const flatPrediction=img(()=>[128,128,128,255]);
 const out=composeAdaptivePixels(baseline,flatPrediction,W,H,'preserve');
 assert.equal(out.strategy,'baseline-only');
 assert.deepEqual(out.pixels,baseline);
});
