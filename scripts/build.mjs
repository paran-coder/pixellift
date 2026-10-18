import { mkdir, copyFile, rm, readFile, writeFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const out = new URL('../dist/', import.meta.url);
await rm(out, { recursive: true, force: true });
await mkdir(new URL('src/', out), { recursive: true });
// Build one classic browser bundle so choices remain interactive when index.html is opened from a ZIP.
const engine = (await readFile(new URL('src/engine.mjs', root), 'utf8')).replace(/^export /gm, '');
const main = (await readFile(new URL('src/main.mjs', root), 'utf8')).replace(/^import[^\n]*engine\.mjs[^\n]*\n/m, '');
const bundle = '/* PixelLift browser bundle — generated. Do not edit. */\n(() => {\n' + engine + '\n' + main + '\n})();\n';
await writeFile(new URL('src/client.js', root), bundle);
await writeFile(new URL('src/client.js', out), bundle);
for (const file of ['styles.css', 'favicon.svg', 'og-image.png', 'demo-comparison.jpg', 'src/engine.mjs', 'src/main.mjs']) {
  await copyFile(new URL(file, root), new URL(file, out));
}
// OG crawlers require absolute image URLs; Vercel exposes its deployment hostname at build time.
// Fall back to the root-relative file for local builds only.
const hostname = process.env.VERCEL_URL;
const ogUrl = hostname && /^[a-zA-Z0-9.-]+$/.test(hostname)
  ? `https://${hostname}/og-image.png`
  : '/og-image.png';
const html = (await readFile(new URL('index.html', root), 'utf8'))
  .replaceAll('__OG_IMAGE_URL__', ogUrl);
await writeFile(new URL('index.html', out), html);
console.log(`PixelLift v1.0.4: dist/ generated (OG image: ${ogUrl})`);
