import { useCallback, useState } from 'react';
import type { Doc } from './types';
import { Toolbar } from './components/Toolbar';
import { Editor } from './components/Editor';
import { Preview } from './components/Preview';

export default function App() {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [fileName, setFileName] = useState<string>('edited.json');
  const [fileHandle, setFileHandle] = useState<FileSystemFileHandle | undefined>();
  const [dragOver, setDragOver] = useState(false);

  const load = useCallback((name: string, content: string, handle?: FileSystemFileHandle) => {
    try {
      const parsed = JSON.parse(content) as Doc;
      if (!parsed.headers || !parsed.contents) {
        alert('JSON 스키마가 다릅니다. headers / contents 배열이 필요합니다.');
        return;
      }
      setDoc(parsed);
      setFileName(name);
      setFileHandle(handle);
    } catch (e) {
      alert('JSON 파싱 실패: ' + (e as Error).message);
    }
  }, []);

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (!f) return;
    const content = await f.text();
    // 드래그&드롭은 File만 제공 → handle 없음. 저장은 Save As로 유도됨.
    load(f.name, content);
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
              JSON 파일을 선택하거나 여기에 드롭하세요
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
              <div className="panel-header">
                <span>미리보기 (우)</span>
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
