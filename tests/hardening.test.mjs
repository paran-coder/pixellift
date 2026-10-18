import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MODEL_CONFIG, readStream, verifyModelSha256 } from '../src/engine.mjs';

test('all models pin a real SHA-256 fingerprint', () => {
  for (const model of Object.values(MODEL_CONFIG)) {
    assert.match(model.sha256, /^[a-f0-9]{64}$/);
    assert.ok(model.source.startsWith('https://huggingface.co/'));
  }
});

test('the digest verifier accepts matching bytes and rejects mismatches', async () => {
  const bytes = new TextEncoder().encode('pixel-lift-test');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = Buffer.from(digest).toString('hex');
  assert.equal(await verifyModelSha256(bytes, hash), true);
  await assert.rejects(verifyModelSha256(bytes, '0'.repeat(64)), /무결성/);
  await assert.rejects(verifyModelSha256(bytes, 'fake'), /설정/);
});

test('streaming downloads enforce size cap with or without Content-Length', async () => {
  const signal = new AbortController().signal;
  const oversized = new Response(new Uint8Array(24), { headers: { 'content-length': '24' } });
  await assert.rejects(readStream(oversized, null, signal, 16), /한도/);
  const unknownLength = new Response(new Uint8Array(20));
  await assert.rejects(readStream(unknownLength, null, signal, 16), /한도/);
  const allowed = new Response(new Uint8Array([1,2,3]));
  assert.deepEqual([...await readStream(allowed, null, signal, 3)], [1,2,3]);
});

test('site metadata includes all OG and Twitter tags', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  for (const tag of ['og:image', 'og:image:width', 'og:image:height', 'twitter:card', 'twitter:image']) {
    assert.match(html, new RegExp(`<meta[^>]+(?:property|name)="${tag.replace(':', '\\:')}"`));
  }
});
