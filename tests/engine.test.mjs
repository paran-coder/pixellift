import test from 'node:test';
import assert from 'node:assert/strict';
import { createTiles, imageDataToCHW, validatePlan, MAX_OUTPUT_PIXELS, MODEL_CONFIG } from '../src/engine.mjs';

test('each image mode loads a distinct ONNX model', () => {
  assert.equal(Object.keys(MODEL_CONFIG).length, 3);
  assert.equal(new Set(Object.values(MODEL_CONFIG).map(m => m.url)).size, 3);
  for (const model of Object.values(MODEL_CONFIG)) assert.ok(model.url.endsWith('/model.onnx'));
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
