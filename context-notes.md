# PixelLift v1.2.1 — 변경 컨텍스트

승인된 변경: 업스케일 후에만 확대 비교를 활성화하며, 기본은 전체 보기. 확대 시 Before/After 같은 확대율과 이동 좌표를 유지한다. 사용자는 마우스/터치 드래그로 이미지를 이동하고 슬라이더 조작을 유지할 수 있어야 한다. 품질 게이트는 일반 확대와의 명확한 이점 및 원본 형태·질감 보존을 함께 판정하되 한 가지 점수로 단정하지 않는다.

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
