/**
 * File System Access API 래퍼.
 * 지원 브라우저(Chromium): 사용자에게 저장 위치/파일명 선택 대화상자 표시.
 * 미지원(Safari/Firefox): Blob + <a download> fallback.
 */

type AnyWindow = Window & {
  showSaveFilePicker?: (opts: {
    suggestedName?: string;
    types?: Array<{ description?: string; accept: Record<string, string[]> }>;
  }) => Promise<FileSystemFileHandle>;
  showOpenFilePicker?: (opts: {
    multiple?: boolean;
    types?: Array<{ description?: string; accept: Record<string, string[]> }>;
  }) => Promise<FileSystemFileHandle[]>;
};

export function hasFilePicker(): boolean {
  return typeof (window as AnyWindow).showSaveFilePicker === 'function';
}

export type OpenedFile = {
  name: string;
  file: File;
  handle?: FileSystemFileHandle;
};

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** 파일 열기 (JSON/DOCX). picker 사용 가능하면 handle 반환해 Save 로 재사용. */
export async function openFile(): Promise<OpenedFile | null> {
  const w = window as AnyWindow;
  if (w.showOpenFilePicker) {
    try {
      const [handle] = await w.showOpenFilePicker({
        types: [
          {
            description: 'JSON 또는 DOCX',
            accept: {
              'application/json': ['.json'],
              [DOCX_MIME]: ['.docx'],
            },
          },
        ],
      });
      const file = await handle.getFile();
      return { name: file.name, file, handle };
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return null;
      console.warn('openFilePicker 실패, fallback:', e);
    }
  }
  // fallback: 동적 input 생성
  return await new Promise<OpenedFile | null>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = `.json,application/json,.docx,${DOCX_MIME}`;
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      resolve({ name: f.name, file: f });
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/**
 * 저장. 처리 순서:
 *   1) 이미 가진 handle이 있으면 그 자리에 덮어쓰기
 *   2) 없으면 showSaveFilePicker로 위치/이름 선택 대화상자 표시
 *   3) 둘 다 못쓰면 Blob 다운로드
 *
 * 반환: 새로 선택된 handle (있으면). 덮어쓰기 시 같은 handle 반환.
 */
export async function saveFile(params: {
  content: string | Blob;
  suggestedName: string;
  mimeType?: string;
  extension?: string;
  existingHandle?: FileSystemFileHandle;
  saveAs?: boolean;
}): Promise<FileSystemFileHandle | undefined> {
  const {
    content,
    suggestedName,
    mimeType = 'application/json',
    extension = 'json',
    existingHandle,
    saveAs,
  } = params;

  const w = window as AnyWindow;
  const canPick = typeof w.showSaveFilePicker === 'function';

  // 1) 기존 handle 덮어쓰기 (Save)
  if (!saveAs && existingHandle) {
    try {
      const writable = await existingHandle.createWritable();
      await writable.write(content);
      await writable.close();
      return existingHandle;
    } catch (e) {
      console.warn('기존 handle 쓰기 실패, picker로 재시도:', e);
    }
  }

  // 2) Save As picker
  if (canPick) {
    try {
      const handle = await w.showSaveFilePicker!({
        suggestedName,
        types: [{ description: extension.toUpperCase(), accept: { [mimeType]: [`.${extension}`] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
      return handle;
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return existingHandle;
      console.warn('savePicker 실패, Blob 다운로드로 fallback:', e);
    }
  }

  // 3) Fallback: blob download (브라우저 다운로드 폴더로 직행)
  const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  a.click();
  URL.revokeObjectURL(url);
  return existingHandle;
}
