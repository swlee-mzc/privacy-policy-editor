import { useCallback, useEffect, useState } from 'react';
import type { Doc, DocMeta } from './types';
import { Toolbar } from './components/Toolbar';
import { Editor } from './components/Editor';
import { Preview } from './components/Preview';
import { DocBanner } from './components/DocBanner';
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

export default function App() {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [fileName, setFileName] = useState<string>('edited.json');
  const [fileHandle, setFileHandle] = useState<FileSystemFileHandle | undefined>();
  const [docMeta, setDocMeta] = useState<DocMeta | null>(null);
  const [dragOver, setDragOver] = useState(false);

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
   * 실시간 재검증 — 에디터 편집 시 debounce(400ms) 후 `issues` 재계산.
   * `autoFixes` 는 파싱 시점 스냅샷이므로 건드리지 않음.
   * 사용자가 배너를 닫았다면(docMeta=null) 되살리지 않음.
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

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (!f) return;
    // 드래그&드롭은 File만 제공 → handle 없음. 저장은 Save As로 유도됨.
    load(f.name, f);
  };

  return (
    <div className="app">
      <Toolbar
        doc={doc}
        fileName={fileName}
        fileHandle={fileHandle}
        onLoad={load}
        onHandleChange={setFileHandle}
      />

      <div
        className="panels"
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
                <span>편집 (좌)</span>
                <small className="text-muted" style={{ fontWeight: 'normal' }}>
                  실시간 미리보기 연동
                </small>
              </div>
              <div className="panel-body">
                <Editor doc={doc} onChange={setDoc} />
              </div>
            </div>
            <div className="panel" id="previewPanel">
              <div className="panel-header preview-header">
                <span className="doc-title">개인정보 처리방침</span>
                <small className="text-muted" style={{ fontWeight: 'normal' }}>미리보기</small>
              </div>
              {docMeta && (
                <DocBanner meta={docMeta} onDismiss={() => setDocMeta(null)} />
              )}
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
