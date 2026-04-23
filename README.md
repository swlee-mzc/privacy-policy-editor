# 개인정보처리방침 에디터

`headers` / `contents` 스키마 JSON 을 좌측에서 편집하고 우측 미리보기와 실시간 동기화하는 웹 에디터.

## 주요 기능

- 좌우 분할: **좌** 편집기 / **우** 미리보기 (실시간 동기화)
- 섹션·라인·테이블 행 추가/삭제/이동/복제
- 표 셀 `rowspan` / `colspan` **대화식 편집**: 셀 우상단 `r`/`c` 숫자 입력으로 병합, `×` 로 1×1 복원. 격자 일관성을 깨는 변경은 자동 차단.
- 줄바꿈: 테이블 셀 `<br>` ↔ `\n` 양방향 변환
- **File System Access API** 로 저장 위치·파일명 선택 (Chromium 계열)
- 입출력 매트릭스:

  | 포맷 | 열기 | 저장/내보내기 |
  |------|:----:|:-------------:|
  | JSON | ✅ | ✅ (`저장`, `다른 이름으로...`) |
  | DOCX | ✅ (읽기 전용 → JSON 편집) | ✅ (`DOCX...`) |
  | Markdown | ❌ | ✅ (`MD...`, 내보내기 전용) |

- DOCX 업로드 시 `제N조 (제목)` 섹션 자동 인식, 표 rowspan/colspan/첫 행 thead 승격
- 인쇄 미디어쿼리: 편집기 숨기고 미리보기만 출력

## 검증·경고 UX

업로드(DOCX/JSON) 직후 미리보기 패널 상단에 **요약 배너** 가 뜨고, 편집 중에는 **debounce 400ms** 로 실시간 재검증됩니다.

배너는 두 블록으로 분리:

- **자동 정리됨 (AUTO-FIX)** — 파서가 이미 반영했거나, 내보내기 시 에디터 포맷으로 자동 일관화되는 항목. 사용자 개입 불필요.
  - 스마트따옴표 `""''` → `"'`
  - 섹션 번호 공백 정상화 (`第1 1条` → `第11条`)
  - 문장 끝 더블 스페이스 축약
  - 표 첫 행 thead 자동 승격 (휴리스틱 통과 시)
  - `<w:del>/<w:delText>` 변경 추적을 `<s>` 태그로 보존
  - 헤딩 bold 혼재 (내보내기 시 정상화)
- **검토 필요 (REVIEW)** — 사용자 판단·수정이 필요한 항목.
  - 섹션 번호 누락/중복
  - 빈 섹션
  - 취소선 `<s>` 잔존
  - 번호 스타일 혼재 (`1.` / `①` / `ⅰ)` / `1)`)
  - 도트 문자 혼재 (`·` / `⋅` / `․` / `∙` / `・`)
  - 스마트따옴표 잔존 (JSON 로드 시)
  - 표 격자 일관성 오류 (rowspan/colspan 합 불일치 또는 빈 격자)

각 REVIEW 항목에는 위치 **ref 칩** 이 붙어 있고, 클릭하면 **에디터·미리보기 두 패널이 동시에 스크롤** + 1.6s flash 하이라이트 됩니다.

## CLI 검증 스크립트

CI/배포 전 빠른 점검이나 LLM 세션에서의 사용을 위해 편집기 파서·검증기를 동일 코드로 호출하는 스크립트 제공.

```bash
# DOCX → JSON 변환 + 검증
pnpm tsx scripts/verify-docx.ts <input.docx> <output.json>

# 기존 JSON 단독 검증
pnpm tsx scripts/verify-json.ts <input.json>

# 다국어 교차 언어 구조 정합 (첫 파일 기준으로 섹션/라인 수 비교)
pnpm tsx scripts/verify-json.ts <ko.json> <ja.json> <en.json>

# JSON → DOCX 내보내기 (UI 의 `DOCX...` 버튼과 동일 출력)
pnpm tsx scripts/export-docx.ts <input.json> [<output.docx>]
```

출력 블록:
- `[INFO]` — headers/sections/tables 개수
- `[AUTO-FIX]` — DOCX 변환 시 자동 반영된 항목
- `[REVIEW]` — 사용자 검토 필요 항목 + 위치 ref 목록
- `=== 교차 정합 ===` — 2개 이상 JSON 비교 시 구조 드리프트

## LLM 오케스트레이션 스킬

UI 대신 CLI + LLM 세션으로 작업하고 싶을 때 사용: [`.claude/skills/privacy-convert/SKILL.md`](./.claude/skills/privacy-convert/SKILL.md)

스킬은 두 트랙을 제공:
- **트랙 A** — DOCX → JSON 변환 + 검토 항목 건별 합의 + (LLM 고유) 오탈자·의미 후보 제안
- **트랙 B** — 기존 JSON 단독 검증 + 다국어(KO/JA/EN) 교차 정합 + 번역 정합 후보 제안

## 개발

패키지 매니저는 **pnpm 10.30.3** 를 사용합니다 (`package.json` 의 `packageManager` 필드로 고정).

```bash
pnpm install
pnpm dev           # 개발 서버
pnpm build         # dist/ 생성
pnpm preview       # 빌드 결과 로컬 확인
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
