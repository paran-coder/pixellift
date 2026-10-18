# PixelLift v1.3.0 — OG metadata hotfix

Site: https://pixellift-inky.vercel.app/
Image: https://pixellift-inky.vercel.app/og-image.png

## Changed files
- `index.html`: canonical URL, og:url, HTTPS og:image/og:image:secure_url, twitter:url, twitter:image, twitter:image:alt.
- `scripts/build.mjs`: remove dynamic VERCEL_URL rewriting; keep the declared canonical site URL stable in all Vercel builds.

## Apply to the existing GitHub repository
1. Replace only `index.html` and `scripts/build.mjs` on the `main` branch of `paran-coder/pixellift`.
2. Allow Vercel's Git integration to build and deploy the updated branch.
3. Verify HTML source: canonical/og:url point to site above; og:image/twitter:image point to the image above.
4. Verify `https://pixellift-inky.vercel.app/og-image.png` responds with PNG and has dimensions 1200×630.
5. Social platform preview caches may take time to refresh; request re-scrape if available.

**Status:** Locally tested (34/34, build succeeded); GitHub write was denied by the installed integration (403), so remote publication not confirmed.
