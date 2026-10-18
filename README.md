# PixelLift v1.2.0

원본 보존을 우선하는 브라우저 기반 무료 AI 이미지 업스케일러. 이미지 종류 구분 없이 **원본 보존·균형·선명도 강화** 3개 품질을 가로로 배치하며, 이미지 전체 폭 미리보기·클릭 업로드·드래그앤드롭·2×/4× PNG 저장을 지원합니다.

## 개발 및 테스트

Node.js 20 이상 필요. 정적 사이트이며 외부 ONNX Runtime Web / Real-ESRGAN 모델을 다운로드할 네트워크와 지원 브라우저가 필요합니다.

```bash
npm test
npm run build
npm run dev
node scripts/benchmark-quality.mjs
```

`dist/`를 정적 호스팅에 업로드하거나 GitHub와 Vercel Git 배포를 연결할 수 있습니다. 로컬의 `index.html`도 `src/client.js`와 함께 열 수 있습니다.

## 품질 로직

- 원본 보존: 원본을 보간한 **기본 이미지의 큰 구조와 색**을 기준으로 AI의 두 주파수대 디테일을 원본 경계 근처에만 제한적으로 반영. 강한 AI 변경을 제한함.
- 균형: 원본 기반 처리에 AI 예측을 적당히 혼합.
- 선명도 강화: AI 예측을 더 강하게 반영하므로 색·질감 변형 가능.
- 보존형에서 AI가 실질적으로 기여하지 못하면 기존 원본의 경계만 보수적으로 선명화하며, 적용된 타일 수를 결과 정보에 표시. **대체 처리는 AI 정보 복원과 같지 않음.**

## 처리 한계

기계적 수치 개선과 인간이 느끼는 시각 품질은 다릅니다. 원본의 진짜 세부 정보를 복원했다는 보장은 없습니다. 화질 판단에는 동등한 확대 배율의 일반 Bicubic/Lanczos 대조와 실모델 비교가 필수입니다. 새 v1.2.0 알고리즘의 실제 모델 화질은 아직 검증되지 않았습니다.

## 모델 출처 및 이용 조건

Real-ESRGAN 원 프로젝트: https://github.com/xinntao/Real-ESRGAN
사용 모델: https://huggingface.co/skillsafe-ai/realesrgan-x4plus
ONNX Runtime Web: https://onnxruntime.ai/docs/tutorials/web/

서비스 화면의 모델 크레딧은 사용자 요구에 따라 숨겼지만 프로젝트의 모델/라이브러리 이용 조건 검토 의무는 사라지지 않습니다. 상용화/재배포 전 각 라이선스를 확인해야 합니다.

## 검증 현황

[QA_REPORT.md](QA_REPORT.md) 참고. GitHub 업로드 및 Vercel 실제 공개 배포는 아직 완료되지 않았습니다.
