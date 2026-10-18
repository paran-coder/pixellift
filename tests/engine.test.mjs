import test from 'node:test';
import assert from 'node:assert/strict';
import { createTiles, imageDataToCHW, validatePlan, MAX_OUTPUT_PIXELS, MODEL_CONFIG, QUALITY_PRESETS, mixPreservedPixels, qualityConfig } from '../src/engine.mjs';

test('one universal model loads regardless of visual category', () => {
  assert.deepEqual(Object.keys(MODEL_CONFIG), ['universal']);
  assert.match(MODEL_CONFIG.universal.url, /realesrgan-x4plus.*model.onnx/);
  assert.deepEqual(Object.keys(QUALITY_PRESETS), ['preserve', 'balanced', 'detail']);
  assert.throws(() => qualityConfig('photo'));
});

test('preserve mode anchors color and structure; alpha never changes', () => {
  const base = Uint8ClampedArray.from([100,110,120,123, 100,110,120,255, 100,110,120,0]);
  const ai = Uint8ClampedArray.from([210,220,230,255, 210,220,230,0, 210,220,230,255]);
  const preserved = mixPreservedPixels(base, ai, 3, 1, 'preserve');
  assert.deepEqual(Array.from(preserved), Array.from(base), 'flat AI output cannot recolor preserve mode');
  const balanced = mixPreservedPixels(base, ai, 3, 1, 'balanced');
  const detail = mixPreservedPixels(base, ai, 3, 1, 'detail');
  assert.ok(balanced[0] > base[0] && detail[0] > balanced[0]);
  for (let i=3;i<base.length;i+=4) {
    assert.equal(preserved[i], base[i]); assert.equal(balanced[i], base[i]); assert.equal(detail[i], base[i]);
  }
});

test('local AI high frequency contributes without altering preserve mode flat image', () => {
  const base = Uint8ClampedArray.from([100,100,100,255, 100,100,100,255, 100,100,100,255]);
  const ai = Uint8ClampedArray.from([100,100,100,255, 230,230,230,255, 100,100,100,255]);
  const out = mixPreservedPixels(base,ai,3,1,'preserve');
  assert.ok(out[4]>100);
  assert.ok(out[0]<=100);
  assert.throws(() => mixPreservedPixels(base,ai,10,10,'preserve'));
});
test('plan supports 2x and 4x pixel scaling', () => {
  assert.deepEqual(validatePlan(800, 600, 2), { width:1600, height:1200, pixels:1_920_000 });
  assert.deepEqual(validatePlan(800, 600, 4), { width:3200, height:2400, pixels:7_680_000 });
  assert.throws(() => validatePlan(100, 200, 3));
});
test('large output limits and dimensions', () => {
  assert.equal(MAX_OUTPUT_PIXELS, 36_000_000);
  assert.throws(() => validatePlan(3840, 2160, 4));
  assert.throws(() => validatePlan(1, 9999, 2));
});
test('tiles cover the image without gaps', () => {
  const width=253,height=171,ts=96,pad=16;
  const tiles=createTiles(width,height,ts,pad);
  const hits=new Uint8Array(width*height);
  for (const t of tiles) {
    assert.ok(t.sx <= t.left && t.sy <= t.top);
    assert.ok(t.sx+t.sw>=t.left+t.width && t.sy+t.sh>=t.top+t.height);
    for(let y=t.top;y<t.top+t.height;y++)for(let x=t.left;x<t.left+t.width;x++)hits[y*width+x]++;
  }
  assert.ok(hits.every(v=>v===1));
});
test('CHW conversion orders and normalizes RGB channels', () => {
  const tensor=imageDataToCHW({width:2,height:1,data:Uint8ClampedArray.from([255,0,127,255,0,128,255,255])});
  assert.equal(tensor.length, 6);
  assert.ok(Math.abs(tensor[0]-1)<1e-6);
  assert.ok(Math.abs(tensor[2]-0)<1e-6);
  assert.ok(Math.abs(tensor[3]-128/255)<1e-6);
  assert.ok(Math.abs(tensor[4]-127/255)<1e-6);
});
