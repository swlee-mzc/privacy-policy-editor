import { useEffect, useRef, useState } from 'react';
import type { Doc, DocMeta } from '../types';
import { toJson, toMarkdown } from '../lib/export';
import { toDocxBlob } from '../lib/docx';
import { hasFilePicker, openFile, saveFile } from '../lib/fs';
import { HelpDrawer } from './HelpDrawer';
import { DocInfoButton } from './DocInfoButton';

type Props = {
  doc: Doc | null;
  fileName: string;
  fileHandle?: FileSystemFileHandle;
  docMeta: DocMeta | null;
  onLoad: (name: string, file: File, handle?: FileSystemFileHandle) => void;
  onHandleChange: (h: FileSystemFileHandle | undefined) => void;
};

export function Toolbar({
  doc, fileName, fileHandle, docMeta,
  onLoad, onHandleChange,
}: Props) {
  const pickerAvailable = hasFilePicker();
  const [helpOpen, setHelpOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const handleOpen = async () => {
    const result = await openFile();
    if (result) onLoad(result.name, result.file, result.handle);
  };

  const saveJson = async (saveAs: boolean) => {
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

  const saveMarkdown = async () => {
    if (!doc) return;
    const base = fileName.replace(/\.json$/i, '');
    await saveFile({
      content: toMarkdown(doc),
      suggestedName: `${base}.md`,
      mimeType: 'text/markdown',
      extension: 'md',
    });
  };

  const saveDocx = async () => {
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

  const runPrint = () => window.print();

  // 주 버튼: JSON 이미 연결되어 있으면 바로 덮어쓰기, 아니면 메뉴 열기
  const primaryAction = async () => {
    if (!doc) return;
    if (fileHandle) {
      await saveJson(false);
    } else {
      setMenuOpen((v) => !v);
    }
  };

  const runMenuItem = async (fn: () => void | Promise<void>) => {
    setMenuOpen(false);
    await fn();
  };

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

      <div className="ms-auto" style={{ display: 'flex', gap: '.25rem', alignItems: 'center' }}>
        {docMeta && <DocInfoButton key={docMeta.fileName} meta={docMeta} />}
        <div className="save-menu" ref={menuRef}>
          <div className="save-menu-split">
            <button
              type="button"
              className="btn btn-sm btn-primary save-menu-main"
              onClick={primaryAction}
              disabled={!doc}
              title={
                fileHandle
                  ? '현재 JSON 파일에 덮어쓰기 (▾ 으로 다른 형식 선택)'
                  : '저장 형식 선택'
              }
            >
              {fileHandle ? '저장' : '저장...'}
            </button>
            <button
              type="button"
              className="btn btn-sm btn-primary save-menu-caret"
              onClick={() => setMenuOpen((v) => !v)}
              disabled={!doc}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="저장 형식 선택"
              title="저장·내보내기 형식 선택"
            >
              ▾
            </button>
          </div>
          {menuOpen && (
            <div className="save-menu-list" role="menu">
              <button
                type="button"
                role="menuitem"
                className="save-menu-item"
                onClick={() => runMenuItem(() => saveJson(false))}
                disabled={!fileHandle}
                title={
                  fileHandle
                    ? '현재 연결된 JSON 파일에 덮어쓰기'
                    : '현재 연결된 파일이 없어 사용할 수 없음'
                }
              >
                <span className="save-menu-item-label">JSON 덮어쓰기</span>
                <span className="save-menu-item-hint">현재 파일에 저장</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="save-menu-item"
                onClick={() => runMenuItem(() => saveJson(true))}
              >
                <span className="save-menu-item-label">JSON 다른 이름으로</span>
                <span className="save-menu-item-hint">새 위치·이름으로 .json 저장</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="save-menu-item"
                onClick={() => runMenuItem(saveDocx)}
              >
                <span className="save-menu-item-label">DOCX 저장</span>
                <span className="save-menu-item-hint">Word 문서 (.docx)</span>
              </button>
              <button
                type="button"
                role="menuitem"
                className="save-menu-item"
                onClick={() => runMenuItem(saveMarkdown)}
              >
                <span className="save-menu-item-label">Markdown 저장</span>
                <span className="save-menu-item-hint">.md 텍스트</span>
              </button>
              <div className="save-menu-sep" />
              <button
                type="button"
                role="menuitem"
                className="save-menu-item"
                onClick={() => runMenuItem(runPrint)}
              >
                <span className="save-menu-item-label">인쇄 / PDF</span>
                <span className="save-menu-item-hint">브라우저 인쇄 대화상자</span>
              </button>
            </div>
          )}
        </div>

        <button
          type="button"
          className="gh-link"
          onClick={() => setHelpOpen(true)}
          title="사용 안내 열기"
          aria-label="사용 안내"
        >
          <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true">
            <path
              fill="currentColor"
              d="M8 15A7 7 0 108 1a7 7 0 000 14zm0 1A8 8 0 118 0a8 8 0 010 16z"
            />
            <path
              fill="currentColor"
              d="M5.255 5.786a.237.237 0 00.241.247h.825c.138 0 .248-.113.266-.25.09-.656.54-1.134 1.342-1.134.686 0 1.314.343 1.314 1.168 0 .635-.374.927-.965 1.371-.673.489-1.206 1.06-1.168 1.987l.003.217a.25.25 0 00.25.246h.811a.25.25 0 00.25-.25v-.105c0-.718.273-.927 1.01-1.486.609-.463 1.244-.977 1.244-2.056 0-1.511-1.276-2.241-2.673-2.241-1.267 0-2.655.59-2.75 2.286zm1.557 5.763c0 .533.425.927 1.01.927.609 0 1.028-.394 1.028-.927 0-.552-.42-.94-1.029-.94-.584 0-1.009.388-1.009.94z"
            />
          </svg>
        </button>
        <a
          className="gh-link"
          href="https://github.com/swlee-mzc/privacy-policy-editor"
          target="_blank"
          rel="noopener noreferrer"
          title="GitHub 저장소 (public)"
          aria-label="GitHub repository"
        >
          <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true">
            <path
              fill="currentColor"
              d="M8 0C3.58 0 0 3.58 0 8a8 8 0 005.47 7.59c.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
            />
          </svg>
        </a>
      </div>

      {!pickerAvailable && (
        <div className="w-100 mt-1">
          <small className="text-warning">
            ⚠ 이 브라우저는 저장 위치 선택 기능을 지원하지 않아 다운로드 폴더로 저장됩니다. (Safari/Firefox)
          </small>
        </div>
      )}
      <HelpDrawer open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
