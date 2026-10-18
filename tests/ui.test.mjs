import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('design tokens retain the documented aubergine, cream and lavender palette', () => {
  for (const color of ['#4a154b', '#611f69', '#f4ede4', '#f9f0ff', '#1d1d1d', '#696969', '#1264a3']) {
    assert.ok(css.includes(color), `missing design token ${color}`);
  }
  assert.match(html, /name="theme-color" content="#4a154b"/);
});

test('screen preserves a semantic typographic hierarchy', () => {
  assert.equal((html.match(/<h1\b/g) ?? []).length, 1);
  assert.equal((html.match(/<h2\b/g) ?? []).length, 2);
  assert.equal((html.match(/<h3\b/g) ?? []).length, 3);
  assert.match(html, /<main>.*<section class="hero"/s);
  assert.match(html, /id="studio"/);
});

test('components expose accessible names and keyboard focus treatment', () => {
  for (const id of ['file-input', 'compare-range', 'start-btn', 'download-btn']) assert.ok(html.includes(`id="${id}"`));
  assert.match(html, /aria-label="원본과 결과 비교 슬라이더"/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});

test('primary action remains visually prominent and device sizes are responsive', () => {
  assert.match(css, /\.primary-action\s*\{[^}]*background: var\(--primary\)/);
  assert.match(css, /@media \(max-width: 640px\)/);
  assert.match(css, /\.hero\s*\{[^}]*overflow: hidden/);
});

test('quality and scale selected styles bind to checked state, not stale active classes', () => {
  assert.match(css, /\.quality-option:has\(> input:checked\)/);
  assert.match(css, /\.scale-option:has\(> input:checked\)/);
  assert.doesNotMatch(css, /\.quality-option\.active|\.scale-option\.active/);
  assert.doesNotMatch(html, /class="(?:quality|scale)-option active"/);
  assert.match(css, /input:focus-visible/);
  assert.doesNotMatch(css, /\.quality-option:focus-within|\.scale-option:focus-within/);
});

test('classic JS bundle is wired for direct-file interaction and demo is disclosed', () => {
  assert.match(html, /<script defer src="\.\/src\/client\.js"><\/script>/);
  assert.match(html, /실제 AI 처리 결과/);
  assert.match(html, /선명도 차이를 설명하는 예시/);
  assert.doesNotMatch(html, /<script type="module"/);
});


test('full-width preview comes before settings and remains upload-able', () => {
  assert.ok(html.indexOf('class="preview-side"') < html.indexOf('class="setting-side"'));
  assert.match(html, /class="preview-stage dropzone" id="dropzone"/);
  assert.match(html, /id="change-image-btn"/);
  assert.match(html, /id="drop-overlay"/);
  assert.match(html, /class="settings-grid"/);
  assert.match(css, /\.workspace-body \{ display: flex; flex-direction: column;/);
  assert.match(css, /\.settings-grid \{ display: grid;/);
});

test('visible footer model-credit link and model badge removed', () => {
  assert.doesNotMatch(html, /MODEL CREDITS/);
  assert.doesNotMatch(html, /REAL-ESRGAN AI ENGINE/);
  assert.match(html, /© 2026 PixelLift/);
});


test('quality cards are one horizontal 3-column row and type selector is removed', () => {
  assert.doesNotMatch(html, /name="mode"|class="mode-group"|이미지 유형<\/span>/);
  assert.equal((html.match(/name="quality"/g) ?? []).length, 3);
  assert.match(html, /name="quality" value="preserve" checked/);
  assert.match(html, /value="balanced"/);
  assert.match(html, /value="detail"/);
  assert.match(css, /\.quality-group \{ display: grid; grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.quality-option:has\(> input:checked\)/);
});
