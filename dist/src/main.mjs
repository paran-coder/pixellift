import { MODEL_CONFIG, MAX_FILE_BYTES, QUALITY_PRESETS, validatePlan, upscaleImage, readStream, verifyModelSha256, errorMessage } from './engine.mjs';

const $ = id => document.getElementById(id);
const ui = Object.fromEntries([
  'file-input','dropzone','choose-btn','change-image-btn','drop-overlay','drop-main','drop-description','file-pill','file-name','file-meta','remove-file',
  'output-summary','dimensions-value','quality-help','start-btn','cancel-btn','gpu-notice','preview-size','empty-preview',
  'compare','before-img','after-img','after-layer','compare-divider','compare-range','preview-caption','result-format','zoom-compare-btn','zoom-compare-label',
  'progress-wrap','progress-label','progress-percent','progress-bar','progress-detail','result-actions','result-meta','download-btn','alert',
].map(id => [id.replaceAll('-', '_'), $(id)]));

const state = { file: null, bitmap: null, originalUrl: null, resultUrl: null, quality: 'preserve', factor: 4, running: false, abort: null, supportsGpu: false, session: null, sessionModel: null, provider: null };
const ONNX_CDN = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/';
let runtimePromise;
let pendingFileSelection = 0;
// Synchronized pan + zoom for Before/After; never alter source image bytes.
const zoomView = { level: 1, x: 0, y: 0, panPointer: null, handlePointer: null };

function panBounds() {
  if (!state.bitmap) return { x: 0, y: 0 };
  const { width, height } = ui.compare.getBoundingClientRect();
  if (!width || !height) return { x: 0, y: 0 };
  const fit = Math.min(width / state.bitmap.width, height / state.bitmap.height);
  return {
    x: Math.max(0, (state.bitmap.width * fit * zoomView.level - width) / 2),
    y: Math.max(0, (state.bitmap.height * fit * zoomView.level - height) / 2),
  };
}
function updateZoomView() {
  const b = panBounds();
  zoomView.x = Math.min(b.x, Math.max(-b.x, zoomView.x));
  zoomView.y = Math.min(b.y, Math.max(-b.y, zoomView.y));
  ui.compare.style.setProperty('--zoom', String(zoomView.level));
  ui.compare.style.setProperty('--pan-x', `${zoomView.x}px`);
  ui.compare.style.setProperty('--pan-y', `${zoomView.y}px`);
}
function setCompareZoom(level) {
  zoomView.level = level === 4 && !!state.resultUrl ? 4 : 1;
  zoomView.x = 0;
  zoomView.y = 0;
  zoomView.panPointer = null;
  zoomView.handlePointer = null;
  ui.compare.classList.remove('is-panning');
  ui.compare.classList.toggle('zoomed', zoomView.level > 1);
  ui.zoom_compare_btn.setAttribute('aria-pressed', String(zoomView.level > 1));
  ui.zoom_compare_label.textContent = zoomView.level > 1 ? '전체 보기' : '확대 비교 · 4×';
  if (state.resultUrl) ui.preview_caption.textContent = zoomView.level > 1
    ? '이미지를 드래그해 이동 · 중앙 손잡이로 전후 비교 · 전체 보기로 돌아갈 수 있습니다'
    : '슬라이더를 이동해 비교하세요 · 확대 비교로 디테일 확인';
  updateZoomView();
}
function positionSlider(clientX) {
  const r = ui.compare.getBoundingClientRect();
  if (!r.width) return;
  const next = Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100));
  ui.compare_range.value = String(next);
  setSlider(next);
}



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
  setCompareZoom(1);
  ui.zoom_compare_btn.classList.add('hidden');
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
  setCompareZoom(1);
  ui.zoom_compare_btn.classList.add('hidden');
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

async function openSession(signal, progress) {
  const mode = 'universal';
  if (state.session && state.sessionModel === mode) {
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
  state.sessionModel = null;
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
  state.sessionModel = mode;
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
  document.querySelectorAll('input[name="quality"],input[name="scale"]').forEach(el => el.disabled = true);
  const started = performance.now();
  try {
    const { ort, session } = await openSession(abort.signal, (n, label, detail) => setProgress(n, label, detail));
    if (abort.signal.aborted) throw new DOMException('취소된 작업', 'AbortError');
    let qualityReport = null;
    const result = await upscaleImage({ bitmap: state.bitmap, factor: state.factor, quality: state.quality, ort, session, signal: abort.signal,
      onQualityReport: report => { qualityReport = report; },
      onTile: (done, total) => setProgress(30 + (done / total) * 65, '원본 기반 AI 업스케일 처리 중', `${done}/${total} 타일 처리 · ${state.provider}`),
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
    ui.zoom_compare_btn.classList.remove('hidden');
    setCompareZoom(1);
    ui.result_actions.classList.remove('hidden');
    ui.result_format.textContent = `${state.factor}× / ${QUALITY_PRESETS[state.quality].label} / PNG`;
    ui.preview_caption.textContent = '슬라이더를 이동해 원본과 AI 결과를 비교하세요';
    const fallbackNote = qualityReport?.safeFallbackTiles ? ` · ${qualityReport.safeFallbackTiles}개 타일 원본 기반 선명화` : '';
    ui.result_meta.textContent = `${(state.bitmap.width * state.factor).toLocaleString()} × ${(state.bitmap.height * state.factor).toLocaleString()} · ${((performance.now() - started) / 1000).toFixed(1)}초 · ${state.provider}${fallbackNote}`;
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
    document.querySelectorAll('input[name="quality"],input[name="scale"]').forEach(el => el.disabled = false);
    updateOptions();
  }
}

function download() {
  if (!state.resultUrl || !state.file) return;
  const anchor = document.createElement('a');
  const safe = state.file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9가-힣_\-. ]/g, '_').slice(0, 80);
  anchor.href = state.resultUrl;
  anchor.download = `${safe || 'pixellift'}_${state.quality}_${state.factor}x.png`;
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
document.querySelectorAll('input[name="quality"]').forEach(el => el.addEventListener('change', e => {
  if (!QUALITY_PRESETS[e.target.value]) return;
  state.quality = e.target.value;
  ui.quality_help.textContent = {
    preserve: '원본 구조를 기준으로 여러 크기의 디테일을 제한적으로 반영합니다. AI 효과가 약한 부분은 원본 기반 선명화로 대체합니다.',
    balanced: '원본을 중심으로 AI 디테일을 적당히 반영합니다.',
    detail: 'AI가 예측한 디테일을 더 많이 반영해 질감이 바뀔 수 있습니다.',
  }[state.quality];
  ui.alert.classList.add('hidden');
  invalidateResult();
  updateOptions();
}));
document.querySelectorAll('input[name="scale"]').forEach(el => el.addEventListener('change', e => { state.factor = Number(e.target.value); ui.alert.classList.add('hidden'); invalidateResult(); updateOptions(); }));
ui.compare_range.addEventListener('input', event => setSlider(event.target.value));
// Zoom is opt-in: full-frame view is retained until the user requests detail.
ui.zoom_compare_btn.addEventListener('click', () => setCompareZoom(zoomView.level === 1 ? 4 : 1));
window.addEventListener('resize', () => { if (zoomView.level > 1) updateZoomView(); });

// When zoomed, the image canvas captures drag to pan. Both images share one transform.
ui.compare.addEventListener('pointerdown', event => {
  if (!state.resultUrl || zoomView.level <= 1 || event.button !== 0 || event.target.closest('.compare-knob')) return;
  zoomView.panPointer = { id: event.pointerId, x: event.clientX, y: event.clientY, fromX: zoomView.x, fromY: zoomView.y };
  ui.compare.setPointerCapture(event.pointerId);
  ui.compare.classList.add('is-panning');
  event.preventDefault();
});
ui.compare.addEventListener('pointermove', event => {
  const p = zoomView.panPointer;
  if (!p || p.id !== event.pointerId) return;
  zoomView.x = p.fromX + event.clientX - p.x;
  zoomView.y = p.fromY + event.clientY - p.y;
  updateZoomView();
});
function finishPan(event) {
  if (zoomView.panPointer?.id !== event.pointerId) return;
  zoomView.panPointer = null;
  ui.compare.classList.remove('is-panning');
  if (ui.compare.hasPointerCapture(event.pointerId)) ui.compare.releasePointerCapture(event.pointerId);
}
ui.compare.addEventListener('pointerup', finishPan);
ui.compare.addEventListener('pointercancel', finishPan);
// The existing full-width transparent range captures pointer gestures in full view.
// In zoom mode it yields pointer events to the image canvas; the 44px divider knob
// becomes the pointer drag target. The range remains keyboard focusable.
const knob = ui.compare_divider.querySelector('.compare-knob');
knob.addEventListener('pointerdown', event => {
  if (zoomView.level <= 1 || !state.resultUrl || event.button !== 0) return;
  event.stopPropagation();
  event.preventDefault();
  zoomView.handlePointer = event.pointerId;
  knob.setPointerCapture(event.pointerId);
  positionSlider(event.clientX);
});
knob.addEventListener('pointermove', event => {
  if (zoomView.handlePointer === event.pointerId) positionSlider(event.clientX);
});
function finishHandle(event) {
  if (zoomView.handlePointer !== event.pointerId) return;
  zoomView.handlePointer = null;
  if (knob.hasPointerCapture(event.pointerId)) knob.releasePointerCapture(event.pointerId);
}
knob.addEventListener('pointerup', finishHandle);
knob.addEventListener('pointercancel', finishHandle);

ui.start_btn.addEventListener('click', start);
ui.cancel_btn.addEventListener('click', () => { state.abort?.abort(); ui.cancel_btn.textContent = '작업 취소 중…'; });
ui.download_btn.addEventListener('click', download);
updateOptions();
checkGpu();
