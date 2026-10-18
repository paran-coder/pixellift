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
// The site's public canonical hostname is stable across production and preview builds.
// Social crawlers must not use VERCEL_URL (an ephemeral deployment hostname).
const siteUrl = 'https://pixellift-inky.vercel.app/';
const ogUrl = new URL('og-image.png', siteUrl).href;
const html = await readFile(new URL('index.html', root), 'utf8');
await writeFile(new URL('index.html', out), html);
console.log(`PixelLift v1.3.0: dist/ generated (OG image: ${ogUrl})`);
