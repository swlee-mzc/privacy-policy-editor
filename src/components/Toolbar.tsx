import type { Doc } from '../types';
import { toJson, toMarkdown } from '../lib/export';
import { toDocxBlob } from '../lib/docx';
import { hasFilePicker, openFile, saveFile } from '../lib/fs';

type Props = {
  doc: Doc | null;
  fileName: string;
  fileHandle?: FileSystemFileHandle;
  onLoad: (name: string, file: File, handle?: FileSystemFileHandle) => void;
  onHandleChange: (h: FileSystemFileHandle | undefined) => void;
};

export function Toolbar({ doc, fileName, fileHandle, onLoad, onHandleChange }: Props) {
  const pickerAvailable = hasFilePicker();

  const handleOpen = async () => {
    const result = await openFile();
    if (result) onLoad(result.name, result.file, result.handle);
  };

  const save = async (saveAs: boolean) => {
    if (!doc) return;
    const base = fileName.replace(/\.json$/i, '');
    const handle = await saveFile({
      content: toJson(doc),
      suggestedName: `${base}.json`,
      mimeType: 'application/json',
      extension: 'json',
      existingHandle: fileHandle,
      saveAs,
    });
    onHandleChange(handle);
  };

  const exportMarkdown = async () => {
    if (!doc) return;
    const base = fileName.replace(/\.json$/i, '');
    await saveFile({
      content: toMarkdown(doc),
      suggestedName: `${base}.md`,
      mimeType: 'text/markdown',
      extension: 'md',
    });
  };

  const exportDocx = async () => {
    if (!doc) return;
    const base = fileName.replace(/\.json$/i, '');
    const blob = await toDocxBlob(doc);
    await saveFile({
      content: blob,
      suggestedName: `${base}.docx`,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      extension: 'docx',
    });
  };

  const exportJson = () => save(true); // 항상 새 위치 선택

  return (
    <div className="toolbar">
      <button
        className="btn btn-sm btn-outline-primary"
        onClick={handleOpen}
        title="JSON 또는 DOCX 파일 열기"
      >
        파일 열기...
      </button>
      <span className="meta">
        {doc ? (
          <>
            <strong>{fileName}</strong>
            <span className="ms-2">· {doc.contents?.length || 0}개 조</span>
            {fileHandle && <span className="ms-2 text-success">● 연결됨</span>}
          </>
        ) : (
          '파일을 열거나 드롭하세요'
        )}
      </span>

      <div className="ms-auto" style={{ display: 'flex', gap: '.25rem' }}>
        <button
          className="btn btn-sm btn-primary"
          onClick={() => save(false)}
          disabled={!doc}
          title={fileHandle ? '현재 파일에 덮어쓰기' : '저장 위치·이름 선택'}
        >
          {fileHandle ? '저장' : '저장...'}
        </button>
        <button
          className="btn btn-sm btn-outline-secondary"
          onClick={exportJson}
          disabled={!doc}
          title="새 위치에 JSON으로 저장"
        >
          다른 이름으로...
        </button>
        <button
          className="btn btn-sm btn-outline-secondary"
          onClick={exportMarkdown}
          disabled={!doc}
          title="Markdown으로 내보내기"
        >
          MD...
        </button>
        <button
          className="btn btn-sm btn-outline-secondary"
          onClick={exportDocx}
          disabled={!doc}
          title="Word 문서(.docx)로 내보내기"
        >
          DOCX...
        </button>
        <button
          className="btn btn-sm btn-outline-secondary"
          onClick={() => window.print()}
          disabled={!doc}
          title="미리보기만 인쇄 (프린터 대화상자)"
        >
          인쇄...
        </button>
      </div>

      {!pickerAvailable && (
        <div className="w-100 mt-1">
          <small className="text-warning">
            ⚠ 이 브라우저는 저장 위치 선택 기능을 지원하지 않아 다운로드 폴더로 저장됩니다. (Safari/Firefox)
          </small>
        </div>
      )}
    </div>
  );
}
