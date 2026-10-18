import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
test('zoom comparison is opt-in, accessible, and not shown until results exist', () => {
  const html = read('index.html');
  const source = read('src/main.mjs');
  assert.match(html, /id="zoom-compare-btn"[^>]*aria-pressed="false"/);
  assert.match(html, /class="zoom-compare-btn hidden"/);
  assert.match(source, /ui\.zoom_compare_btn\.classList\.remove\('hidden'\)/);
  assert.match(source, /ui\.zoom_compare_btn\.classList\.add\('hidden'\)/);
  assert.match(source, /zoomView\.level === 1 \? 4 : 1/);
});
test('pan and comparison slider have separate pointer paths and shared image transform', () => {
  const source = read('src/main.mjs');
  const css = read('styles.css');
  assert.match(source, /ui\.compare\.setPointerCapture/);
  assert.match(source, /knob\.setPointerCapture/);
  assert.match(source, /ui\.compare_range\.value = String\(next\)/);
  assert.match(css, /\.compare img \{ transform: translate\(var\(--pan-x/);
  assert.match(css, /\.compare\.zoomed input\[type=range\] \{ pointer-events: none/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});
