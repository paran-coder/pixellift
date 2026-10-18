/* PixelLift browser bundle — generated. Do not edit. */
(() => {
/** PixelLift v1.0.1 — Real-ESRGAN browser inference core. */
const MODEL_CONFIG = Object.freeze({
  photo: {
    name: 'RealESRGAN_x4plus',
    url: 'https://huggingface.co/skillsafe-ai/realesrgan-x4plus/resolve/main/model.onnx',
    source: 'https://huggingface.co/skillsafe-ai/realesrgan-x4plus',
    approxMB: 64,
    sha256: '4851ec156207d271f5328605d0582eeb851e656227da8aca093ced9e60789291',
    tile: 112,
    pad: 24,
  },
  illustration: {
    name: 'RealESRGAN_x4plus_anime_6B',
    url: 'https://huggingface.co/skillsafe-ai/realesrgan-x4plus-anime-6b/resolve/main/model.onnx',
    source: 'https://huggingface.co/skillsafe-ai/realesrgan-x4plus-anime-6b',
    approxMB: 18,
    sha256: '9a029dae374b2cd4c3eb2dbbed857e22e6d785687c767aa12828e7356b9fb378',
    tile: 144,
    pad: 24,
  },
  anime: {
    name: 'realesr-animevideov3',
    url: 'https://huggingface.co/skillsafe-ai/realesr-animevideov3/resolve/main/model.onnx',
    source: 'https://huggingface.co/skillsafe-ai/realesr-animevideov3',
    approxMB: 2.5,
    sha256: '78baa685a1a92cac6e14ab2af2a8ad0ef56fa48629563b1414e3a7acc54d86e2',
    tile: 192,
    pad: 16,
  },
});

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_OUTPUT_PIXELS = 36_000_000;
const MAX_CANVAS_SIDE = 16_384;

function validatePlan(width, height, factor) {
  if (![2, 4].includes(factor)) throw new Error('2배 또는 4배 확대를 선택해주세요.');
  if (![width, height].every(n => Number.isSafeInteger(n) && n > 0)) throw new Error('유효한 이미지 크기가 아닙니다.');
  const outputWidth = width * factor;
  const outputHeight = height * factor;
  if (outputWidth > MAX_CANVAS_SIDE || outputHeight > MAX_CANVAS_SIDE || outputWidth * outputHeight > MAX_OUTPUT_PIXELS) {
    throw new Error(`출력 이미지가 안전한 처리 한도(3,600만 픽셀, 한 변 16,384px)를 초과합니다. 확대 배율을 낮추거나 원본을 축소해 주세요.`);
  }
  return { width: outputWidth, height: outputHeight, pixels: outputWidth * outputHeight };
}

function createTiles(width, height, tileSize, padding) {
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

function imageDataToCHW(imageData) {
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

function chwToImageData(raw, width, height) {
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

function errorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/fetch|failed to fetch|network|load model|cors/i.test(message)) return 'AI 모델을 내려받지 못했습니다. 네트워크 연결 및 모델 제공 서버의 접근 가능 여부를 확인한 뒤 다시 시도해 주세요.';
  if (/out of memory|allocation failed|device lost|memory access|OOM/i.test(message)) return '브라우저 GPU 메모리가 부족하거나 GPU 연결이 종료됐습니다. 작은 이미지로 다시 시도하거나 다른 브라우저를 사용해 주세요.';
  return message;
}

const disposed = tensor => { try { tensor?.dispose?.(); } catch {} };

async function upscaleImage({ bitmap, factor, mode, ort, session, signal, onTile }) {
  const { width, height } = bitmap;
  const plan = validatePlan(width, height, factor);
  const conf = MODEL_CONFIG[mode];
  if (!conf) throw new Error('이미지 유형을 선택해 주세요.');
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
      const img = chwToImageData(raw, t.sw * 4, t.sh * 4);
      const temp = document.createElement('canvas');
      temp.width = t.sw * 4;
      temp.height = t.sh * 4;
      temp.getContext('2d').putImageData(img, 0, 0);
      destCtx.drawImage(
        temp,
        (t.left - t.sx) * 4, (t.top - t.sy) * 4, t.width * 4, t.height * 4,
        t.left * factor, t.top * factor, t.width * factor, t.height * factor,
      );
      // Preserve original transparency (the model itself only predicts RGB).
      if (mode !== 'photo' || pixels.data.some((v, k) => k % 4 === 3 && v !== 255)) {
        destCtx.save();
        destCtx.beginPath();
        destCtx.rect(t.left * factor, t.top * factor, t.width * factor, t.height * factor);
        destCtx.clip();
        destCtx.globalCompositeOperation = 'destination-in';
        destCtx.drawImage(source, t.left, t.top, t.width, t.height, t.left * factor, t.top * factor, t.width * factor, t.height * factor);
        destCtx.restore();
      }
      temp.width = temp.height = 0;
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
async function readStream(response, onProgress, signal, maxBytes = Infinity) {
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
async function verifyModelSha256(bytes, expectedSha256) {
  if (!/^[0-9a-f]{64}$/.test(expectedSha256)) throw new Error('AI 모델 무결성 설정이 올바르지 않습니다.');
  if (!globalThis.crypto?.subtle) throw new Error('안전한 연결(HTTPS)이 필요합니다.');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const sha256 = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  if (sha256 !== expectedSha256) throw new Error('AI 모델 파일의 무결성 검증에 실패했습니다. 다운로드가 변경되었을 수 있습니다.');
  return true;
}


const $ = id => document.getElementById(id);
const ui = Object.fromEntries([
  'file-input','dropzone','choose-btn','change-image-btn','drop-overlay','drop-main','drop-description','file-pill','file-name','file-meta','remove-file',
  'output-summary','dimensions-value','start-btn','cancel-btn','gpu-notice','preview-size','empty-preview',
  'compare','before-img','after-img','after-layer','compare-divider','compare-range','preview-caption','result-format',
  'progress-wrap','progress-label','progress-percent','progress-bar','progress-detail','result-actions','result-meta','download-btn','alert',
].map(id => [id.replaceAll('-', '_'), $(id)]));

const state = { file: null, bitmap: null, originalUrl: null, resultUrl: null, mode: 'photo', factor: 4, running: false, abort: null, supportsGpu: false, session: null, sessionMode: null, provider: null };
const ONNX_CDN = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/';
let runtimePromise;
let pendingFileSelection = 0;

function updateOptions() {
  // Selected styles use CSS :has(> input:checked), not a stale JS-managed class.
  if (state.bitmap) {
    try {
      const p = validatePlan(state.bitmap.width, state.bitmap.height, state.factor);
      ui.dimensions_value.textContent = `${p.width.toLocaleString()} × ${p.height.toLocaleString()} px`;
      ui.start_btn.disabled = state.running;
    } catch (error) {
      ui.dimensions_value.textContent = '처리 한도 초과';
      ui.start_btn.disabled = true;
      showError(error.message);
    }
  } else {
    ui.dimensions_value.textContent = '이미지를 먼저 선택하세요';
    ui.start_btn.disabled = true;
  }
}

function revokeUrl(url) { if (url) URL.revokeObjectURL(url); }
function releaseImage() {
  pendingFileSelection++;
  state.abort?.abort();
  state.bitmap?.close?.();
  state.bitmap = null;
  state.file = null;
  revokeUrl(state.originalUrl);
  revokeUrl(state.resultUrl);
  state.originalUrl = null;
  state.resultUrl = null;
  ui.file_input.value = '';
  ui.file_pill.classList.add('hidden');
  ui.dropzone.classList.remove('has-file', 'has-result', 'drag-over');
  ui.change_image_btn.classList.add('hidden');
  ui.drop_overlay.classList.add('hidden');
  ui.compare_range.disabled = true;
  ui.compare.classList.add('comparison-idle');
  ui.empty_preview.classList.remove('hidden');
  ui.compare.classList.add('hidden');
  ui.result_actions.classList.add('hidden');
  $('label-after').classList.add('hidden');
  ui.cancel_btn.textContent = '작업 취소';
  ui.progress_wrap.classList.add('hidden');
  ui.alert.classList.add('hidden');
  ui.preview_caption.textContent = '이 영역을 클릭하면 이미지 선택창이 열립니다';
  ui.preview_size.textContent = '이미지 없음';
  ui.result_format.textContent = 'ORIGINAL / UPSCALED';
  updateOptions();
}

function invalidateResult() {
  revokeUrl(state.resultUrl);
  state.resultUrl = null;
  ui.result_actions.classList.add('hidden');
  ui.compare.classList.add('comparison-idle');
  ui.dropzone.classList.remove('has-result');
  ui.compare_range.disabled = true;
  $('label-after').classList.add('hidden');
  if (state.originalUrl) ui.after_img.src = state.originalUrl;
  if (state.bitmap) {
    ui.preview_caption.textContent = '선택한 설정으로 업스케일을 시작해 주세요';
    ui.result_format.textContent = 'ORIGINAL';
  }
}

function showError(message) {
  ui.alert.textContent = message;
  ui.alert.classList.remove('hidden');
}

async function chooseFile(file) {
  if (state.running) return;
  releaseImage();
  const selection = pendingFileSelection;
  if (!file) return;
  if (!['image/jpeg','image/png','image/webp'].includes(file.type)) return showError('JPG, PNG, WebP 파일만 사용할 수 있습니다.');
  if (file.size > MAX_FILE_BYTES) return showError('20MB 이하의 이미지를 선택해 주세요.');
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    if (selection !== pendingFileSelection) { bitmap.close?.(); return; }
    if (bitmap.width < 1 || bitmap.height < 1) throw new Error('빈 이미지는 처리할 수 없습니다.');
  } catch (error) {
    bitmap?.close?.();
    if (selection !== pendingFileSelection) return;
    return showError(errorMessage(error));
  }
  state.file = file;
  state.bitmap = bitmap;
  state.originalUrl = URL.createObjectURL(file);
  ui.before_img.src = state.originalUrl;
  ui.after_img.src = state.originalUrl;
  ui.file_name.textContent = file.name;
  ui.file_meta.textContent = `${bitmap.width.toLocaleString()} × ${bitmap.height.toLocaleString()} · ${(file.size / 1024 / 1024).toFixed(2)} MB`;
  ui.file_pill.classList.remove('hidden');
  ui.dropzone.classList.add('has-file');
  ui.change_image_btn.classList.remove('hidden');
  ui.compare.classList.add('comparison-idle');
  ui.compare_range.disabled = true;
  ui.empty_preview.classList.add('hidden');
  ui.compare.classList.remove('hidden');
  ui.preview_size.textContent = `${bitmap.width} × ${bitmap.height}`;
  ui.preview_caption.textContent = '원본 이미지 · 업스케일을 실행하면 결과를 비교할 수 있습니다';
  ui.result_format.textContent = 'ORIGINAL';
  ui['compare_range'].value = '50';
  $('label-after').classList.add('hidden');
  setSlider(50);
  updateOptions();
}

function setSlider(percent) {
  const x = Math.min(100, Math.max(0, Number(percent)));
  ui.after_layer.style.clipPath = `inset(0 0 0 ${x}%)`;
  ui.compare_divider.style.left = `${x}%`;
}

function setProgress(value, label, detail) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  ui.progress_label.textContent = label;
  ui.progress_percent.textContent = `${v}%`;
  ui.progress_bar.style.width = `${v}%`;
  if (detail) ui.progress_detail.textContent = detail;
}

async function getOrt() {
  if (window.ort) return window.ort;
  if (!runtimePromise) {
    runtimePromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `${ONNX_CDN}ort.webgpu.min.js`;
      script.async = true;
      script.onload = () => {
        if (!window.ort) return reject(new Error('ONNX Runtime을 불러올 수 없습니다.'));
        window.ort.env.wasm.wasmPaths = ONNX_CDN;
        window.ort.env.wasm.numThreads = 1;
        resolve(window.ort);
      };
      script.onerror = () => reject(new Error('AI 실행 라이브러리를 불러오지 못했습니다. 네트워크 연결을 확인하세요.'));
      document.head.appendChild(script);
    }).catch(err => { runtimePromise = null; throw err; });
  }
  return runtimePromise;
}

async function openSession(mode, signal, progress) {
  if (state.session && state.sessionMode === mode) {
    progress(30, `${MODEL_CONFIG[mode].name} 모델 재사용`);
    return { ort: await getOrt(), session: state.session };
  }
  const ort = await getOrt();
  const model = MODEL_CONFIG[mode];
  progress(2, 'AI 모델 다운로드 준비');
  const response = await fetch(model.url, { signal, cache: 'force-cache' });
  const bytes = await readStream(response, (done, total) => {
    const fraction = total ? done / total : Math.min(1, done / (model.approxMB * 1024 * 1024));
    progress(2 + fraction * 18, `${model.name} 다운로드`, `${(done / 1024 / 1024).toFixed(1)} MB${total ? ` / ${(total / 1024 / 1024).toFixed(1)} MB` : ''}`);
  }, signal, Math.ceil((model.approxMB + 10) * 1024 * 1024));
  if (signal.aborted) throw new DOMException('취소된 작업', 'AbortError');
  progress(20, 'AI 모델 파일을 검증하는 중');
  await verifyModelSha256(bytes, model.sha256);
  if (signal.aborted) throw new DOMException('취소된 작업', 'AbortError');
  progress(21, 'AI 모델을 초기화하는 중', 'GPU 메모리에 모델을 준비하고 있습니다.');
  // Do not keep two large models in GPU memory during a mode change.
  try { await state.session?.release?.(); } catch {}
  state.session = null;
  state.sessionMode = null;
  let session = null;
  let provider = 'WebGPU';
  if (state.supportsGpu) {
    try { session = await ort.InferenceSession.create(bytes, { executionProviders: ['webgpu'], graphOptimizationLevel: 'all' }); }
    catch (error) { console.warn('WebGPU failed; retrying with WASM', error); }
  }
  if (!session) {
    provider = 'WASM CPU';
    session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
  }
  if (signal.aborted) { await session.release(); throw new DOMException('취소된 작업', 'AbortError'); }
  state.session = session;
  state.sessionMode = mode;
  state.provider = provider;
  progress(29, `모델 준비 완료 · ${provider}`);
  return { ort, session };
}

async function start() {
  if (state.running || !state.bitmap) return;
  try { validatePlan(state.bitmap.width, state.bitmap.height, state.factor); }
  catch (e) { return showError(e.message); }
  state.running = true;
  const abort = new AbortController();
  state.abort = abort;
  ui.alert.classList.add('hidden');
  ui.progress_wrap.classList.remove('hidden');
  ui.result_actions.classList.add('hidden');
  $('label-after').classList.add('hidden');
  ui.cancel_btn.textContent = '작업 취소';
  ui.start_btn.disabled = true;
  ui.cancel_btn.classList.remove('hidden');
  ui.remove_file.disabled = true;
  ui.change_image_btn.disabled = true;
  invalidateResult();
  ui.file_input.disabled = true;
  document.querySelectorAll('input[name="mode"],input[name="scale"]').forEach(el => el.disabled = true);
  const started = performance.now();
  try {
    const { ort, session } = await openSession(state.mode, abort.signal, (n, label, detail) => setProgress(n, label, detail));
    if (abort.signal.aborted) throw new DOMException('취소된 작업', 'AbortError');
    const result = await upscaleImage({ bitmap: state.bitmap, factor: state.factor, mode: state.mode, ort, session, signal: abort.signal,
      onTile: (done, total) => setProgress(30 + (done / total) * 65, 'AI 디테일 복원 중', `${done}/${total} 타일 처리 · ${state.provider}`),
    });
    if (abort.signal.aborted) throw new DOMException('취소된 작업', 'AbortError');
    setProgress(97, 'PNG 파일을 생성하는 중');
    let blob;
    try {
      blob = await new Promise((resolve, reject) => result.toBlob(data => data ? resolve(data) : reject(new Error('PNG 출력에 실패했습니다.')), 'image/png'));
    } finally {
      result.width = result.height = 0;
    }
    if (abort.signal.aborted) throw new DOMException('취소된 작업', 'AbortError');
    revokeUrl(state.resultUrl);
    state.resultUrl = URL.createObjectURL(blob);
    ui.after_img.src = state.resultUrl;
    $('label-after').classList.remove('hidden');
    ui.compare.classList.remove('comparison-idle');
    ui.dropzone.classList.add('has-result');
    ui.compare_range.disabled = false;
    ui.result_actions.classList.remove('hidden');
    ui.result_format.textContent = `${state.factor}× / PNG`;
    ui.preview_caption.textContent = '슬라이더를 이동해 원본과 AI 결과를 비교하세요';
    ui.result_meta.textContent = `${(state.bitmap.width * state.factor).toLocaleString()} × ${(state.bitmap.height * state.factor).toLocaleString()} · ${((performance.now() - started) / 1000).toFixed(1)}초 · ${state.provider}`;
    setProgress(100, '업스케일 완료');
    setSlider(50);
  } catch (error) {
    if (error.name === 'AbortError') {
      setProgress(0, '작업이 취소됐습니다.');
      ui.progress_wrap.classList.add('hidden');
    } else {
      showError(errorMessage(error));
      ui.progress_wrap.classList.add('hidden');
      console.error('[PixelLift]', error);
    }
  } finally {
    if (state.abort === abort) state.abort = null;
    state.running = false;
    ui.cancel_btn.classList.add('hidden');
    ui.file_input.disabled = false;
    ui.remove_file.disabled = false;
    ui.change_image_btn.disabled = false;
    document.querySelectorAll('input[name="mode"],input[name="scale"]').forEach(el => el.disabled = false);
    updateOptions();
  }
}

function download() {
  if (!state.resultUrl || !state.file) return;
  const anchor = document.createElement('a');
  const safe = state.file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9가-힣_\-. ]/g, '_').slice(0, 80);
  anchor.href = state.resultUrl;
  anchor.download = `${safe || 'pixellift'}_${state.mode}_${state.factor}x.png`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

async function checkGpu() {
  try {
    if (!navigator.gpu) throw new Error('WebGPU 미지원');
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('WebGPU 장치 없음');
    state.supportsGpu = true;
    ui.gpu_notice.textContent = 'WebGPU 지원 확인됨 · 기기 GPU로 고품질 AI 추론을 실행합니다.';
  } catch {
    state.supportsGpu = false;
    ui.gpu_notice.textContent = 'WebGPU를 사용할 수 없어 CPU 대체 처리를 사용합니다. 고품질 모델은 시간이 오래 걸릴 수 있습니다.';
    ui.gpu_notice.classList.add('warning');
  }
}

// The full preview is a drop target and a file picker. After processing,
// the compare range is interactive; the explicit Change image button remains available.
function openPicker() { if (!state.running && !ui.file_input.disabled) ui.file_input.click(); }
ui.dropzone.addEventListener('click', event => {
  if (event.target.closest('#choose-btn, #change-image-btn')) return;
  if (state.resultUrl && event.target.closest('#compare')) return;
  openPicker();
});
ui.choose_btn.addEventListener('click', event => { event.stopPropagation(); openPicker(); });
ui.change_image_btn.addEventListener('click', event => { event.stopPropagation(); openPicker(); });
ui.dropzone.addEventListener('keydown', event => {
  if (event.target !== ui.dropzone || !['Enter',' '].includes(event.key)) return;
  event.preventDefault(); openPicker();
});
ui.dropzone.addEventListener('dragenter', event => {
  event.preventDefault();
  if (state.running) return;
  ui.dropzone.classList.add('drag-over');
  ui.drop_overlay.classList.remove('hidden');
});
ui.dropzone.addEventListener('dragover', event => {
  event.preventDefault();
  if (!state.running && event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
});
ui.dropzone.addEventListener('dragleave', event => {
  if (ui.dropzone.contains(event.relatedTarget)) return;
  ui.dropzone.classList.remove('drag-over');
  ui.drop_overlay.classList.add('hidden');
});
ui.dropzone.addEventListener('drop', event => {
  event.preventDefault();
  ui.dropzone.classList.remove('drag-over');
  ui.drop_overlay.classList.add('hidden');
  if (!state.running) chooseFile(event.dataTransfer?.files?.[0]);
});
ui.file_input.addEventListener('change', event => chooseFile(event.target.files?.[0]));
ui.remove_file.addEventListener('click', releaseImage);
document.querySelectorAll('input[name="mode"]').forEach(el => el.addEventListener('change', e => { state.mode = e.target.value; ui.alert.classList.add('hidden'); invalidateResult(); updateOptions(); }));
document.querySelectorAll('input[name="scale"]').forEach(el => el.addEventListener('change', e => { state.factor = Number(e.target.value); ui.alert.classList.add('hidden'); invalidateResult(); updateOptions(); }));
ui.compare_range.addEventListener('input', event => setSlider(event.target.value));
ui.start_btn.addEventListener('click', start);
ui.cancel_btn.addEventListener('click', () => { state.abort?.abort(); ui.cancel_btn.textContent = '작업 취소 중…'; });
ui.download_btn.addEventListener('click', download);
updateOptions();
checkGpu();

})();
