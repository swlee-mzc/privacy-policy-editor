# 개인정보처리방침 에디터

`headers` / `contents` 스키마 JSON 을 좌측에서 편집하고 우측 미리보기와 실시간 동기화하는 웹 에디터.

## 주요 기능

- 좌우 분할: **좌** 편집기 / **우** 미리보기
- 섹션·라인·테이블 행 추가/삭제/이동/복제
- 표 셀 `rowspan` / `colspan` 보존 (DOMParser 기반 구조 편집)
- 줄바꿈: 테이블 셀 `<br>` ↔ `\n` 양방향 변환
- **File System Access API** 로 저장 위치·파일명 선택 (Chromium 계열)
- Markdown 내보내기 (GFM 표)
- 인쇄 미디어쿼리: 편집기 숨기고 미리보기만 출력

## 개발

```bash
npm install
npm run dev        # 개발 서버
npm run build      # dist/ 생성
npm run preview    # 빌드 결과 로컬 확인
```

## 배포

`main` 브랜치로 push 하면 `.github/workflows/deploy.yml` 가 자동 실행되어 GitHub Pages 에 배포됩니다.

배포 URL: `https://<owner>.github.io/privacy-policy-editor/`

### 최초 1회 설정

1. 저장소 Settings → Pages → Source: **GitHub Actions**
2. (선택) Settings → Actions → General → Workflow permissions: Read and write

## 스키마

```ts
type Doc = {
  headers: string[];
  contents: { title: string; lines: string[] }[];
};
```

각 `line` 은 문자열이며 4가지 종류로 분류됩니다:
- `table` — `<table ...>` 로 시작하는 HTML (구조 에디터 제공)
- `html` — 기타 태그 포함
- `text` — 순수 텍스트
- `empty` — 공백만

## 브라우저 호환

| 기능 | Chrome/Edge | Safari | Firefox |
|------|:---:|:---:|:---:|
| 편집/미리보기 | ✅ | ✅ | ✅ |
| 저장 위치 선택 (File System Access) | ✅ | ❌ → Blob 다운로드 | ❌ → Blob 다운로드 |
