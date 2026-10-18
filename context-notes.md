# PixelLift v1.2.0 — context notes

## Background
The default Preserve preset in v1.1.0 has `modelMix: 0` and an adjacent-pixel high-pass. Supplied sample comparison found its output very close to standard interpolation, despite running the ONNX model. Users require **preserving original subject/brushwork without wasting GPU inference**.

## Approved scope
1. Replace one-pixel high-pass with bounded multi-scale source-anchored detail reconstruction.
2. Measure and handle negligible improvement against a baseline automatically; never silently switch to a more hallucinatory preset.
3. Add deterministic tests comparing interpolation, Preserve, Balanced, and Detail with structural/integrity metrics.
4. Preserve existing horizontal 3-card UI, 2x/4x and download behavior.

## Constraints and uncertainty
No algorithm can mathematically guarantee authentic detail from a single low-resolution source. AI output quality needs testing with original model on real photos and illustrations. Check software licenses separately for publishing. No Vercel/GitHub deployment is included in this change.
