/** PixelLift v1.0.1 — Real-ESRGAN browser inference core. */
/** One universal Real-ESRGAN model; quality presets adjust its contribution, not the model identity. */
export const MODEL_CONFIG = Object.freeze({
  universal: {
    name: 'RealESRGAN_x4plus',
    url: 'https://huggingface.co/skillsafe-ai/realesrgan-x4plus/resolve/main/model.onnx',
    source: 'https://huggingface.co/skillsafe-ai/realesrgan-x4plus',
    approxMB: 64,
    sha256: '4851ec156207d271f5328605d0582eeb851e656227da8aca093ced9e60789291',
    tile: 112,
    pad: 24,
  },
});

/** Preservation-first hybrid: the source-resampled image anchors low frequencies.
 *  The higher presets deliberately mix more of the AI prediction and may alter textures.
 *  These coefficients are starting points, not validated perceptual guarantees.
 */
export const QUALITY_PRESETS = Object.freeze({
  preserve: Object.freeze({ modelMix: 0, detailGain: .60, detailLimit: 14, label: '원본 보존' }),
  balanced: Object.freeze({ modelMix: .24, detailGain: .72, detailLimit: 25, label: '균형' }),
  detail: Object.freeze({ modelMix: .64, detailGain: .38, detailLimit: 38, label: '선명도 강화' }),
});

export function qualityConfig(quality) {
  const config = QUALITY_PRESETS[quality];
  if (!config) throw new Error('업스케일 품질 옵션이 올바르지 않습니다.');
  return config;
}

/** Output RGBA; alpha is copied from the source-resampled base, not invented by AI. */
export function mixPreservedPixels(base, prediction, width, height, quality) {
  const { modelMix, detailGain, detailLimit } = qualityConfig(quality);
  const size = width * height * 4;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || base.length !== size || prediction.length !== size) {
    throw new Error('업스케일 결과의 픽셀 크기가 일치하지 않습니다.');
  }
  const result = new Uint8ClampedArray(size);
  const row = width * 4;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const left = x ? i - 4 : i;
      const right = x + 1 < width ? i + 4 : i;
      const top = y ? i - row : i;
      const bottom = y + 1 < height ? i + row : i;
      for (let c = 0; c < 3; c++) {
        const ai = prediction[i + c];
        // Cross-neighborhood high-pass. Missing low frequencies are never copied
        // wholesale in Preserve mode, preventing large-scale hallucination.
        const low = (ai * 4 + prediction[left + c] + prediction[right + c] + prediction[top + c] + prediction[bottom + c]) / 8;
        const detail = Math.max(-detailLimit, Math.min(detailLimit, (ai - low) * detailGain));
        result[i + c] = base[i + c] + modelMix * (ai - base[i + c]) + detail;
      }
      result[i + 3] = base[i + 3];
    }
  }
  return result;
}

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_OUTPUT_PIXELS = 36_000_000;
export const MAX_CANVAS_SIDE = 16_384;

export function validatePlan(width, height, factor) {
  if (![2, 4].includes(factor)) throw new Error('2배 또는 4배 확대를 선택해주세요.');
  if (![width, height].every(n => Number.isSafeInteger(n) && n > 0)) throw new Error('유효한 이미지 크기가 아닙니다.');
  const outputWidth = width * factor;
  const outputHeight = height * factor;
  if (outputWidth > MAX_CANVAS_SIDE || outputHeight > MAX_CANVAS_SIDE || outputWidth * outputHeight > MAX_OUTPUT_PIXELS) {
    throw new Error(`출력 이미지가 안전한 처리 한도(3,600만 픽셀, 한 변 16,384px)를 초과합니다. 확대 배율을 낮추거나 원본을 축소해 주세요.`);
  }
  return { width: outputWidth, height: outputHeight, pixels: outputWidth * outputHeight };
}

export function createTiles(width, height, tileSize, padding) {
  if (width < 1 || height < 1 || tileSize < 1 || padding < 0) throw new Error('유효하지 않은 타일 인자');
  const tiles = [];
  for (let top = 0; top < height; top += tileSize) {
    for (let left = 0; left < width; left += tileSize) {
      const w = Math.min(tileSize, width - left);
      const h = Math.min(tileSize, height - top);
      const sx = Math.max(0, left - padding);
      const sy = Math.max(0, top - padding);
      const ex = Math.min(width, left + w + padding);
      const ey = Math.min(height, top + h + padding);
      tiles.push({ left, top, width: w, height: h, sx, sy, sw: ex - sx, sh: ey - sy });
    }
  }
  return tiles;
}

export function imageDataToCHW(imageData) {
  const { width, height, data } = imageData;
  const px = width * height;
  const tensor = new Float32Array(px * 3);
  for (let i = 0; i < px; i++) {
    const j = i * 4;
    tensor[i] = data[j] / 255;
    tensor[i + px] = data[j + 1] / 255;
    tensor[i + px * 2] = data[j + 2] / 255;
  }
  return tensor;
}

export function chwToImageData(raw, width, height) {
  const px = width * height;
  if (raw.length < px * 3) throw new Error('AI 모델의 결과 크기가 올바르지 않습니다.');
  const pixels = new Uint8ClampedArray(px * 4);
  for (let i = 0; i < px; i++) {
    const j = i * 4;
    pixels[j] = Math.round(Math.max(0, Math.min(1, raw[i])) * 255);
    pixels[j + 1] = Math.round(Math.max(0, Math.min(1, raw[i + px])) * 255);
    pixels[j + 2] = Math.round(Math.max(0, Math.min(1, raw[i + px * 2])) * 255);
    pixels[j + 3] = 255;
  }
  return new ImageData(pixels, width, height);
}

export function errorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/fetch|failed to fetch|network|load model|cors/i.test(message)) return 'AI 모델을 내려받지 못했습니다. 네트워크 연결 및 모델 제공 서버의 접근 가능 여부를 확인한 뒤 다시 시도해 주세요.';
  if (/out of memory|allocation failed|device lost|memory access|OOM/i.test(message)) return '브라우저 GPU 메모리가 부족하거나 GPU 연결이 종료됐습니다. 작은 이미지로 다시 시도하거나 다른 브라우저를 사용해 주세요.';
  return message;
}

const disposed = tensor => { try { tensor?.dispose?.(); } catch {} };

export async function upscaleImage({ bitmap, factor, quality = 'preserve', ort, session, signal, onTile }) {
  const { width, height } = bitmap;
  const plan = validatePlan(width, height, factor);
  qualityConfig(quality);
  const conf = MODEL_CONFIG.universal;
  const source = document.createElement('canvas');
  source.width = width;
  source.height = height;
  const sourceCtx = source.getContext('2d', { willReadFrequently: true });
  if (!sourceCtx) throw new Error('원본 이미지를 읽을 수 없습니다.');
  sourceCtx.drawImage(bitmap, 0, 0);
  const destination = document.createElement('canvas');
  destination.width = plan.width;
  destination.height = plan.height;
  const destCtx = destination.getContext('2d', { willReadFrequently: false });
  if (!destCtx) { source.width = source.height = 0; throw new Error('출력 캔버스를 생성할 수 없습니다.'); }
  let completed = false;
  try {
  destCtx.imageSmoothingEnabled = true;
  destCtx.imageSmoothingQuality = 'high';
  const tiles = createTiles(width, height, conf.tile, conf.pad);
  for (let i = 0; i < tiles.length; i++) {
    if (signal.aborted) throw new DOMException('취소된 작업', 'AbortError');
    const t = tiles[i];
    const pixels = sourceCtx.getImageData(t.sx, t.sy, t.sw, t.sh);
    const input = new ort.Tensor('float32', imageDataToCHW(pixels), [1, 3, t.sh, t.sw]);
    let result = null;
    try {
      result = await session.run({ [session.inputNames[0]]: input });
      const output = result[session.outputNames[0]];
      // These converters expose NCHW output with 4x height and width.
      if (!output || output.dims[2] !== t.sh * 4 || output.dims[3] !== t.sw * 4) throw new Error('모델 출력의 배율이 4배가 아닙니다.');
      const raw = output.data ?? (await output.getData());
      const outW = t.sw * 4;
      const outH = t.sh * 4;
      const predicted = chwToImageData(raw, outW, outH);
      // Draw base image from the original (not from AI) at the same tile resolution.
      // This is the anchor for preserving geometry and color in Preserve mode.
      const baseCanvas = document.createElement('canvas');
      baseCanvas.width = outW;
      baseCanvas.height = outH;
      const baseCtx = baseCanvas.getContext('2d', { willReadFrequently: true });
      baseCtx.imageSmoothingEnabled = true;
      baseCtx.imageSmoothingQuality = 'high';
      baseCtx.drawImage(source, t.sx, t.sy, t.sw, t.sh, 0, 0, outW, outH);
      const baseline = baseCtx.getImageData(0, 0, outW, outH);
      const composed = mixPreservedPixels(baseline.data, predicted.data, outW, outH, quality);
      const temp = document.createElement('canvas');
      temp.width = outW;
      temp.height = outH;
      try {
        temp.getContext('2d').putImageData(new ImageData(composed, outW, outH), 0, 0);
        destCtx.drawImage(
          temp,
          (t.left - t.sx) * 4, (t.top - t.sy) * 4, t.width * 4, t.height * 4,
          t.left * factor, t.top * factor, t.width * factor, t.height * factor,
        );
      } finally {
        temp.width = temp.height = 0;
        baseCanvas.width = baseCanvas.height = 0;
      }
    } finally {
      disposed(input);
      if (result) Object.values(result).forEach(disposed);
    }
    onTile?.(i + 1, tiles.length);
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  completed = true;
  return destination;
  } finally {
    source.width = source.height = 0;
    if (!completed) destination.width = destination.height = 0;
  }
}

/** Reject unexpectedly large third-party downloads before materializing the full ONNX file. */
export async function readStream(response, onProgress, signal, maxBytes = Infinity) {
  if (!response.ok) throw new Error(`모델 다운로드 HTTP ${response.status}`);
  const total = Number(response.headers.get('content-length')) || 0;
  if (total > maxBytes) throw new Error('AI 모델 다운로드 크기가 예상 한도를 초과했습니다.');
  const reader = response.body?.getReader();
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > maxBytes) throw new Error('AI 모델 다운로드 크기가 예상 한도를 초과했습니다.');
    onProgress?.(bytes.length, bytes.length);
    return bytes;
  }
  const chunks = [];
  let doneBytes = 0;
  while (true) {
    if (signal.aborted) { await reader.cancel(); throw new DOMException('취소된 작업', 'AbortError'); }
    const { done, value } = await reader.read();
    if (done) break;
    doneBytes += value.length;
    if (doneBytes > maxBytes) { await reader.cancel(); throw new Error('AI 모델 다운로드 크기가 예상 한도를 초과했습니다.'); }
    chunks.push(value);
    onProgress?.(doneBytes, total);
  }
  const output = new Uint8Array(doneBytes);
  let cursor = 0;
  for (const chunk of chunks) { output.set(chunk, cursor); cursor += chunk.length; }
  return output;
}

/** Detect changes to externally hosted model files before loading executable graphs. */
export async function verifyModelSha256(bytes, expectedSha256) {
  if (!/^[0-9a-f]{64}$/.test(expectedSha256)) throw new Error('AI 모델 무결성 설정이 올바르지 않습니다.');
  if (!globalThis.crypto?.subtle) throw new Error('안전한 연결(HTTPS)이 필요합니다.');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const sha256 = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  if (sha256 !== expectedSha256) throw new Error('AI 모델 파일의 무결성 검증에 실패했습니다. 다운로드가 변경되었을 수 있습니다.');
  return true;
}
