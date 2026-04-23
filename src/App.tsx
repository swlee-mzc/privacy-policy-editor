import { useCallback, useEffect, useRef, useState } from 'react';
import type { Doc, DocMeta } from './types';
import { Toolbar } from './components/Toolbar';
import { Editor } from './components/Editor';
import { Preview } from './components/Preview';
import { parseDocx, buildDocInfo, validateDoc, type Issue } from './lib/docx';

// 동일 issues/info 로 재렌더하지 않도록 얕은 비교. JSON 문자열화가 가장 단순.
function issuesEqual(a: Issue[], b: Issue[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const SPLIT_LS_KEY = 'privacy-policy-editor:split-ratio';
const SPLIT_MIN = 0.2;
const SPLIT_MAX = 0.8;

function loadSplitRatio(): number {
  const saved = localStorage.getItem(SPLIT_LS_KEY);
  const n = saved ? parseFloat(saved) : NaN;
  return Number.isFinite(n) && n >= SPLIT_MIN && n <= SPLIT_MAX ? n : 0.5;
}

export default function App() {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [fileName, setFileName] = useState<string>('edited.json');
  const [fileHandle, setFileHandle] = useState<FileSystemFileHandle | undefined>();
  const [docMeta, setDocMeta] = useState<DocMeta | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [splitRatio, setSplitRatio] = useState<number>(loadSplitRatio);
  const panelsRef = useRef<HTMLDivElement>(null);
  const draggingSplit = useRef(false);

  const load = useCallback(
    async (name: string, file: File, handle?: FileSystemFileHandle) => {
      const ext = name.toLowerCase().split('.').pop();
      try {
        if (ext === 'docx') {
          const { doc: parsed, info, autoFixes, issues } = await parseDocx(file);
          if (!parsed.headers || !parsed.contents) {
            alert('DOCX 파싱 결과에 headers/contents 가 없습니다.');
            return;
          }
          // DOCX 는 읽기 전용 소스. 저장 시 항상 새 위치·포맷 선택하도록 handle 무시.
          setDoc(parsed);
          setFileName(name.replace(/\.docx$/i, '.json'));
          setFileHandle(undefined);
          setDocMeta({ source: 'docx', fileName: name, info, autoFixes, issues });
        } else {
          const content = await file.text();
          const parsed = JSON.parse(content) as Doc;
          if (!parsed.headers || !parsed.contents) {
            alert('JSON 스키마가 다릅니다. headers / contents 배열이 필요합니다.');
            return;
          }
          setDoc(parsed);
          setFileName(name);
          setFileHandle(handle);
          // JSON 로드도 live 검증 대상으로 배너 표시.
          setDocMeta({
            source: 'json',
            fileName: name,
            info: buildDocInfo(parsed),
            autoFixes: [],
            issues: validateDoc(parsed),
          });
        }
      } catch (e) {
        alert('열기 실패: ' + (e as Error).message);
      }
    },
    [],
  );

  /**
   * dev 전용: 코드로 Doc 주입하는 훅. File System Access API 를 흉내낼 수 없는
   * Playwright 자동화·수동 console 테스트 용도. 프로덕션 빌드에선 설치되지 않음.
   *   window.__loadDoc(jsonString, name?)
   *   window.__loadDoc(docObject,  name?)
   */
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as {
      __loadDoc?: (data: string | Doc, name?: string) => void;
    };
    w.__loadDoc = (data, name = 'dev.json') => {
      const parsed = typeof data === 'string' ? (JSON.parse(data) as Doc) : data;
      if (!parsed.headers || !parsed.contents) {
        console.error('[__loadDoc] headers / contents 배열 없음');
        return;
      }
      setDoc(parsed);
      setFileName(name);
      setFileHandle(undefined);
      setDocMeta({
        source: 'json',
        fileName: name,
        info: buildDocInfo(parsed),
        autoFixes: [],
        issues: validateDoc(parsed),
      });
    };
    return () => { delete w.__loadDoc; };
  }, []);

  /**
   * 실시간 재검증 — 에디터 편집 시 debounce(400ms) 후 `issues` 재계산.
   * `autoFixes` 는 파싱 시점 스냅샷이므로 건드리지 않음.
   * docMeta 가 null (파일 로드 전) 이면 스킵.
   */
  useEffect(() => {
    if (!doc || !docMeta) return;
    const t = window.setTimeout(() => {
      const nextIssues = validateDoc(doc);
      const nextInfo = buildDocInfo(doc);
      setDocMeta((m) => {
        if (!m) return m;
        if (
          issuesEqual(m.issues, nextIssues) &&
          arraysEqual(m.info, nextInfo)
        ) {
          return m;
        }
        return { ...m, info: nextInfo, issues: nextIssues };
      });
    }, 400);
    return () => window.clearTimeout(t);
    // docMeta 는 의도적으로 제외 — 내부에서 setter 로만 접근 (루프 방지).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);

  // 패널 스플리터 드래그. window 레벨 리스너로 mouseup/leave 이탈 방지.
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingSplit.current || !panelsRef.current) return;
      const rect = panelsRef.current.getBoundingClientRect();
      const raw = (e.clientX - rect.left) / rect.width;
      const ratio = Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, raw));
      setSplitRatio(ratio);
    };
    const onUp = () => {
      if (!draggingSplit.current) return;
      draggingSplit.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(SPLIT_LS_KEY, String(splitRatio));
  }, [splitRatio]);

  const onSplitMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    draggingSplit.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (!f) return;
    // 드래그&드롭은 File만 제공 → handle 없음. 저장은 Save As로 유도됨.
    load(f.name, f);
  };

  const panelsStyle = doc
    ? { gridTemplateColumns: `${splitRatio}fr 8px ${1 - splitRatio}fr`, gap: 0 }
    : undefined;

  return (
    <div className="app">
      <Toolbar
        doc={doc}
        fileName={fileName}
        fileHandle={fileHandle}
        docMeta={docMeta}
        onLoad={load}
        onHandleChange={setFileHandle}
      />

      <div
        ref={panelsRef}
        className="panels"
        style={panelsStyle}
        onDragEnter={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        {!doc ? (
          <div className={'drop-zone' + (dragOver ? ' dragover' : '')}>
            <div style={{ fontSize: '1.1rem', marginBottom: '.5rem' }}>
              JSON 또는 DOCX 파일을 선택하거나 여기에 드롭하세요
            </div>
            <small className="text-muted">좌: 편집기 · 우: 미리보기 (실시간 동기화)</small>
          </div>
        ) : (
          <>
            <div className="panel" id="editorPanel">
              <div className="panel-header">
                <span>편집</span>
              </div>
              <div className="panel-body">
                <Editor doc={doc} onChange={setDoc} />
              </div>
            </div>
            <div
              className="split-handle"
              role="separator"
              aria-orientation="vertical"
              aria-label="패널 너비 조절"
              onMouseDown={onSplitMouseDown}
              onDoubleClick={() => setSplitRatio(0.5)}
              title="드래그하여 너비 조절 · 더블클릭으로 50:50 복원"
            />
            <div className="panel" id="previewPanel">
              <div className="panel-header preview-header">
                <span className="doc-title">개인정보 처리방침</span>
                <small className="text-muted" style={{ fontWeight: 'normal' }}>미리보기</small>
              </div>
              <div className="panel-body">
                <Preview doc={doc} />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
