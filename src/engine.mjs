/** PixelLift v1.3.0 — conservative model-residual reconstruction. */
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

/** Quality means the permissible departure from the source-resampled baseline.
 *  No setting can guarantee recovery of ground-truth detail from a small original.
 */
export const QUALITY_PRESETS = Object.freeze({
  preserve: Object.freeze({ modelMix: 0, midGain: 0.80, fineGain: 0.70, detailLimit: 20, maxDeviation: 20, label: '원본 보존' }),
  balanced: Object.freeze({ modelMix: .20, midGain: .75, fineGain: .63, detailLimit: 25, maxDeviation: 42, label: '균형' }),
  detail: Object.freeze({ modelMix: .55, midGain: .80, fineGain: .70, detailLimit: 32, maxDeviation: 95, label: '선명도 강화' }),
});

export function qualityConfig(quality) {
  const config = QUALITY_PRESETS[quality];
  if (!config) throw new Error('업스케일 품질 옵션이 올바르지 않습니다.');
  return config;
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const byteIndex = (x, y, width) => (y * width + x) * 4;

/** Separable box filter; radius 2 and 7 operate at different spatial scales.
 *  Linear complexity per pixel and bounded memory for tile-based rendering.
 */
export function boxBlurRGB(bytes, width, height, radius) {
  const count = width * height;
  if (bytes.length !== count * 4 || !Number.isInteger(radius) || radius < 1) throw new Error('블러 입력값이 올바르지 않습니다.');
  const temp = new Float32Array(count * 3);
  const out = new Float32Array(count * 3);
  // Horizontal running-sum box filter, replicated borders.
  for (let y = 0; y < height; y++) {
    for (let c = 0; c < 3; c++) {
      let sum = bytes[byteIndex(0, y, width) + c] * (radius + 1);
      for (let k = 1; k <= radius; k++) sum += bytes[byteIndex(Math.min(k, width - 1), y, width) + c];
      for (let x = 0; x < width; x++) {
        temp[(y * width + x) * 3 + c] = sum / (radius * 2 + 1);
        sum += bytes[byteIndex(Math.min(width - 1, x + radius + 1), y, width) + c];
        sum -= bytes[byteIndex(Math.max(0, x - radius), y, width) + c];
      }
    }
  }
  // Vertical running sum.
  for (let x = 0; x < width; x++) {
    for (let c = 0; c < 3; c++) {
      let sum = temp[(x) * 3 + c] * (radius + 1);
      for (let k = 1; k <= radius; k++) sum += temp[(Math.min(k, height - 1) * width + x) * 3 + c];
      for (let y = 0; y < height; y++) {
        out[(y * width + x) * 3 + c] = sum / (radius * 2 + 1);
        sum += temp[(Math.min(height - 1, y + radius + 1) * width + x) * 3 + c];
        sum -= temp[(Math.max(0, y - radius) * width + x) * 3 + c];
      }
    }
  }
  return out;
}

/** Source-guided residual synthesis.
 * Previous versions copied the *absolute* high-frequency energy of AI output.
 * That double-counts features already visible in the interpolated baseline and
 * can re-sharpen lines without restoring any new information.
 * Here we only use high-frequency differences: (AI highpass - baseline highpass).
 * Preserve mode rejects low-frequency color/shape changes completely.
 * A conservative original-edge support mask prevents invented pattern in flat
 * source regions; opposite-sign local edges are attenuated.
 * This is a heuristic, NOT a guarantee of faithful ground-truth recovery.
 */
export function mixPreservedPixels(base, prediction, width, height, quality) {
  const cfg = qualityConfig(quality);
  const count = width * height;
  if (![width, height].every(n => Number.isSafeInteger(n) && n > 0) || base.length !== count * 4 || prediction.length !== count * 4) {
    throw new Error('업스케일 결과의 픽셀 크기가 일치하지 않습니다.');
  }
  const predFineBlur = boxBlurRGB(prediction, width, height, 2);
  const predWideBlur = boxBlurRGB(prediction, width, height, 7);
  const baseFineBlur = boxBlurRGB(base, width, height, 2);
  const baseWideBlur = boxBlurRGB(base, width, height, 7);
  const output = new Uint8ClampedArray(base.length);
  for (let j = 0; j < count; j++) {
    const i = j * 4, k = j * 3;
    const alpha = base[i + 3];
    output[i + 3] = alpha;
    if (!alpha) {
      output[i] = base[i]; output[i + 1] = base[i + 1]; output[i + 2] = base[i + 2];
      continue;
    }
    const sourceContrast = Math.max(
      Math.abs(base[i] - baseWideBlur[k]),
      Math.abs(base[i + 1] - baseWideBlur[k + 1]),
      Math.abs(base[i + 2] - baseWideBlur[k + 2]),
    );
    // Flat source pixels do not justify drawing model-invented textures.
    const support = clamp((sourceContrast - .45) / 6, 0, 1);
    for (let c = 0; c < 3; c++) {
      const sourceMid = baseFineBlur[k + c] - baseWideBlur[k + c];
      const modelMid = predFineBlur[k + c] - predWideBlur[k + c];
      const sourceFine = base[i + c] - baseFineBlur[k + c];
      const modelFine = prediction[i + c] - predFineBlur[k + c];
      // Residual high-frequency only: not the pre-existing model/source line.
      const midDelta = modelMid - sourceMid;
      const fineDelta = modelFine - sourceFine;
      // Wrong-way model edges must not invert an edge drawn in the original.
      const midTrust = sourceMid * modelMid < -3 ? .12 : 1;
      const fineTrust = sourceFine * modelFine < -3 ? .12 : 1;
      const highFreq = clamp(support * (
        cfg.midGain * midDelta * midTrust + cfg.fineGain * fineDelta * fineTrust
      ), -cfg.detailLimit, cfg.detailLimit);
      // Balanced/detail explicitly permit some model geometry/color change.
      const lowFreqModel = cfg.modelMix * (prediction[i + c] - base[i + c]);
      const candidate = clamp(lowFreqModel + highFreq, -cfg.maxDeviation, cfg.maxDeviation);
      output[i + c] = base[i + c] + candidate;
    }
  }
  return output;
}

/** Compare to interpolation on source-supported pixels rather than rewarding
 *  large or fabricated changes in blank/background regions.
 */
export function improvementMetrics(base, result, width, height) {
  if (base.length !== result.length || base.length !== width * height * 4) throw new Error('비교할 이미지 크기가 일치하지 않습니다.');
  let changed = 0, total = 0, sum = 0;
  const step = Math.max(1, Math.floor((width * height) / 16000));
  for (let p = 0; p < width * height; p += step) {
    const i = p * 4;
    if (base[i + 3] < 8) continue;
    const delta = (Math.abs(base[i] - result[i]) + Math.abs(base[i + 1] - result[i + 1]) + Math.abs(base[i + 2] - result[i + 2])) / 3;
    sum += delta; total++;
    if (delta >= 1.25) changed++;
  }
  return { meanDifference: total ? sum / total : 0, changedFraction: total ? changed / total : 0 };
}

/** Gate measures real output difference from baseline but does NOT call large
 * pixel differences "quality". In particular, it never silently substitutes
 * sharpened interpolation for ineffective AI output.
 */
/** Detect predictions that erase almost all existing source edges.
 * Such a failed/flat model result is not a usable source of fine detail.
 */
export function edgeEnergyRatio(base, prediction, width, height) {
  if (base.length !== prediction.length || base.length !== width * height * 4) throw new Error('이미지 크기가 일치하지 않습니다.');
  let b=0,p=0,count=0;
  const stride=Math.max(1,Math.floor((width*height)/5000));
  for(let at=0;at<width*height;at+=stride){
    const x=at%width, y=Math.floor(at/width);
    if(x>=width-1 || y>=height-1)continue;
    const i=at*4,j=i+4,k=i+width*4;
    if(base[i+3]<8)continue;
    for(let c=0;c<3;c++) {
      b+=Math.abs(base[i+c]-base[j+c])+Math.abs(base[i+c]-base[k+c]);
      p+=Math.abs(prediction[i+c]-prediction[j+c])+Math.abs(prediction[i+c]-prediction[k+c]);
    }
    count++;
  }
  return { source: count?b/(count*6):0, model: count?p/(count*6):0, ratio:b>0?p/b:1 };
}

export function composeAdaptivePixels(base, prediction, width, height, quality) {
  const predictedChange = improvementMetrics(base, prediction, width, height);
  const contrast = edgeEnergyRatio(base, prediction, width, height);
  if (predictedChange.meanDifference < 0.08 || (contrast.source >= 0.5 && contrast.ratio < 0.15)) {
    return { pixels: new Uint8ClampedArray(base), strategy: 'baseline-only', metrics: { meanDifference: 0, changedFraction: 0 } };
  }
  const pixels = mixPreservedPixels(base, prediction, width, height, quality);
  const metrics = improvementMetrics(base, pixels, width, height);
  const limited = metrics.meanDifference < 0.8 || metrics.changedFraction < 0.10;
  return { pixels, strategy: limited ? 'limited-impact' : 'ai-guided', metrics };
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

export async function upscaleImage({ bitmap, factor, quality = 'preserve', ort, session, signal, onTile, onQualityReport }) {
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
  const strategies = { aiGuidedTiles: 0, limitedImpactTiles: 0, baselineOnlyTiles: 0 };
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
      const composition = composeAdaptivePixels(baseline.data, predicted.data, outW, outH, quality);
      const composed = composition.pixels;
      if (composition.strategy === 'baseline-only') strategies.baselineOnlyTiles++;
      else if (composition.strategy === 'limited-impact') strategies.limitedImpactTiles++;
      else strategies.aiGuidedTiles++;
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
  onQualityReport?.({ ...strategies, totalTiles: tiles.length });
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
