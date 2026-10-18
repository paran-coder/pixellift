# PixelLift v1.0.4

무료로 공개할 수 있도록 설계한 **브라우저 로컬 AI 이미지 업스케일러**입니다. 사진/일러스트/애니메이션 모드, 2×/4× 출력, 타일 추론, 전후 비교, PNG 다운로드를 지원합니다. 업로드한 이미지 파일은 서비스 서버에 전송하지 않습니다.

## 상태

- 실제 앱 소스, UI, ONNX 실행 파이프라인 구현 완료
- 테스트: `npm test` (17개) 통과. 브라우저에서 새 전체 너비 미리보기, 클릭 파일 선택, 드래그앤드롭, 이미지 변경, 키보드, 2×/4× 및 3종 유형 카드 조작을 320/390/768/1024/1440px에서 검증했습니다. **실제 ONNX 모델 추론 검증은 별도입니다.**
- 정적 빌드: `npm run build` 통과
- **중요:** 외부 CDN 네트워크를 이용한 실제 ONNX Runtime + 모델 추론은 현재 빌드 환경의 DNS 차단으로 검증하지 못했습니다. 이는 실사용 모델 품질과 호환성을 보장하지 않는다는 뜻입니다.
- GitHub 신규 저장소 생성 및 Vercel 공개 배포 미완료 (연결된 GitHub 도구에 신규 저장소 생성 액션이 없음)

## 동작 원리

1. 이미지를 브라우저 내부 `ImageBitmap`/`Canvas`로 읽습니다.
2. 모델별로 지정된 Real-ESRGAN ONNX 가중치를 HTTPS로 다운로드합니다.
3. ONNX Runtime Web 1.22.0(`ort.webgpu.min.js`)을 통해 WebGPU 추론을 시도합니다. 실패하거나 미지원일 때 WASM CPU로 대체합니다.
4. 입력을 타일로 나누고 주변 패딩을 주어 RGB 텐서를 추론합니다. 중앙 영역만 이어 붙여 이음새를 줄입니다.
5. 모델을 SHA-256으로 확인한 다음 추론합니다. 모델 배포처가 가중치를 변경하면 검증 실패로 중단하고 오류를 표시합니다.
6. 모든 모델은 본래 4배 모델입니다. 2배 선택 시 **AI 4배 결과를 고품질 리샘플링**하여 2배 크기로 저장합니다.
7. PNG 투명도는 원본 alpha를 보간해 합성합니다.

## 필요 사항

최신 Chrome 또는 Edge 권장, HTTPS 환경에서 GPU 추론. Firefox/Safari와 CPU 경로는 지원될 수도 있으나 속도가 느리거나 일부 브라우저에서 실패할 수 있습니다.

## 개발 / 빌드

Node.js 20 이상, Python 3 사용 가능. 별도 NPM 라이브러리 설치가 필요하지 않습니다.

```bash
npm test
npm run build
python3 -m http.server 4173
# http://localhost:4173 에서 개발 버전 확인
```

테스트 환경에서 CDN 접근이 가능해야 실제 모델 처리까지 시험할 수 있습니다. 외부 런타임과 모델의 공급자/라이선스는 릴리스 시 반드시 확인하세요.

## GitHub → Vercel 공개 배포

1. GitHub에서 공개 저장소 `pixellift`를 새로 만듭니다.
2. 이 프로젝트 파일(단, `dist/`, `.vercel/` 제외)을 `main` 브랜치에 푸시합니다.
3. Vercel 새 프로젝트에서 해당 GitHub 저장소를 선택합니다.
4. Framework Preset: Other, Build Command: `npm run build`, Output Directory: `dist`로 배포합니다. (`vercel.json`에도 명시됨)
5. 데스크톱 Chrome/Edge에서 3종 모델 각각 소형 테스트 이미지(예: 128×128)를 4× 및 2×로 실제 처리하고 PNG 저장까지 확인합니다.

## 모델 가중치

| 이미지 모드 | ONNX 모델 | 대략적인 다운로드 크기 |
|---|---|---:|
| 사진 | [Real-ESRGAN x4plus](https://huggingface.co/skillsafe-ai/realesrgan-x4plus) | 64 MB |
| 일러스트 | [Real-ESRGAN x4plus anime 6B](https://huggingface.co/skillsafe-ai/realesrgan-x4plus-anime-6b) | 18 MB |
| 애니메이션 | [Real-ESRGAN AnimeVideo-v3](https://huggingface.co/skillsafe-ai/realesr-animevideov3) | 2.5 MB |

- 모델 원저작자: Xintao Wang 외, Real-ESRGAN 프로젝트 / BSD-3-Clause.
- ONNX 변환본: SkillSafe AI가 출처·해시·모델 변환 검증을 명시하며 제공하는 별도 배포처.
- 별도 런타임: Microsoft ONNX Runtime Web (MIT 라이선스).
- 웹앱 애플리케이션 코드: MIT. 모델 가중치에는 원저작물 라이선스가 별도로 적용됩니다.

## 제한 및 보안

- JPEG, PNG, WebP, 파일 크기 20MB 이하
- 최대 출력 3,600만 픽셀 / 가로세로 한 변 16,384 픽셀 이하
- 출력이 너무 크면 배율을 낮추거나 원본 축소 필요
- 추론 실행 중에는 취소를 요청할 수 있지만 진행 중인 단일 GPU 작업을 즉시 강제 중단할 수는 없습니다.
- OG 메타데이터는 `og-image.png`를 사용하며, Vercel에서 빌드할 때 `VERCEL_URL`을 기준으로 절대 URL로 변환합니다.
- 모델 파일에는 모델 카드에 공개된 SHA-256 검증값을 고정합니다. 파일이 바뀌면 검증 오류가 나므로 배포 전에 모델 소스 검증이 필요합니다.
- 모델 다운로드에 Hugging Face, 브라우저 런타임에 jsDelivr CDN을 사용합니다. 이 서비스들로 원본 이미지는 전송하지 않지만 네트워크 접근 자체는 필요합니다.
- AI가 만든 디테일은 실제 촬영 정보와 다를 수 있습니다.
- Vercel Hobby는 비상업적 프로젝트 제한과 대역폭 제한이 있으므로 실제 운영 조건을 확인하세요.

자세한 UX 안내: `User manual.md`. 테스트 체크리스트: `checklist.md`.

## v1.0.1 자체점검 수정사항
- 대표 OG 이미지 사이트 연결, Twitter Card 및 OG 이미지 크기/설명 태그 추가
- `VERCEL_URL` 기반 배포 도메인별 절대 OG URL 출력
- 모델 SHA-256 검사 및 초과 용량 다운로드 거부
- 추론 실패 시 캔버스 메모리 정리, 이미지 선택 동시 작업 충돌 방지
- 새로운 모델 로드 시 이전 추론 세션을 먼저 해제해 메모리 최고 사용량 완화
- 실패 오류가 완료 처리 UI에 의해 숨겨지는 문제 수정
- 단위 테스트 5→9개, 별도 브라우저 모의 추론 검증 스크립트 추가(이 실행 환경에서는 실행 불가)
- **미해결:** 브라우저 WebGPU/WASM 3종 실추론·CORS·품질·GPU/CPU 성능과 Vercel 공개 배포


## v1.0.2 UI Polish 업데이트
- 첨부 UI-polish 운영 원칙 및 디자인 토큰을 기준으로 작업 영역/텍스트 위계 전면 재정비.
- 오버진·크림·라벤더 팔레트와 pill 버튼, 화면별 텍스트 계층, 반응형 수정.
- 320~1440px 가로 넘침 테스트, PNG 선택·모드·배율·삭제 확인.
- UI 검수 보고서: `UI_AUDIT.md`. 다만 기존 OG 이미지는 옛 컬러이므로 추후 통일해야 합니다.

## v1.0.3 — UI 선택 상태 수정 및 OG 교체

- 이미지 유형/배율 선택 카드가 실제 radio `checked` 상태와 동기화되도록 수정. `:has(> input:checked)`를 사용하므로 최신 브라우저가 필요합니다.
- 클릭 시 파란색 포커스 테두리와 보라색 선택 테두리가 혼동되지 않도록 수정.
- 데스크톱/모바일에서 Hero 높이를 줄이고 제품 업로드 도구의 노출을 개선.
- 결과가 아직 없는 상태에 **설명용** Before/After 예시를 표시합니다. 실제 AI 처리 결과로 표시하지 않습니다.
- `og-image.png`를 오버진/크림/라벤더 디자인으로 교체.
- `npm run build`로 생성되는 `src/client.js`는 브라우저용 클래식 스크립트이며 소스 수정은 `src/main.mjs` 및 `src/engine.mjs`에서 수행하세요.
- `python tests/browser-selection.py`로 카드 실제 클릭 및 다양한 뷰포트에서 UI 회귀 확인. Playwright와 Pillow 필요.

## v1.0.4 — 전체 너비 미리보기 및 파일 교체

- 기존 좌측 업로드/설정 + 우측 작은 이미지 레이아웃을 폐지했습니다. **위쪽에 전체 너비 미리보기, 아래쪽에 이미지 유형·확대 배율·실행 버튼**을 배치합니다.
- 이미지가 없는 미리보기 영역 전체를 누르면 파일 선택창이 열립니다. 파일을 올린 뒤에도 처리 전에는 이미지를 클릭하여 교체할 수 있습니다. 처리가 끝난 이미지에서 클릭/드래그는 비교 슬라이더 조작에 사용되므로, 오른쪽 위 **이미지 변경** 버튼 또는 드래그앤드롭으로 교체합니다.
- JPG/PNG/WebP(20MB 이하)를 미리보기 영역에 드래그앤드롭할 수 있습니다. 드래그 시 안내 오버레이가 나타납니다.
- 이미지 선택 후 비교 슬라이더는 실제 결과가 생기기 전까지 비활성화해 원본만 표시합니다. 업스케일 완료 시 활성화합니다.
- 하단 `MODEL CREDITS` 링크 및 스튜디오 하단 `REAL-ESRGAN AI ENGINE` 문구를 제거했습니다. **저작권 및 라이선스 관련 출처는 README에 유지합니다.**
- `npm test` 17개 통과; `python tests/browser-preview-layout.py`는 Chromium/Playwright/Pillow 환경에서 실제 입력 및 드롭 테스트를 수행합니다.
- 외부 CDN 기반 모델의 진짜 GPU/WASM 추론·화질 테스트 및 GitHub/Vercel 배포는 아직 미완료입니다.
