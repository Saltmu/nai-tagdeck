import { useRef, useState, type DragEvent } from 'react';
import type { PromptSource } from '../components/PromptImportDialog';

interface Options {
  enabled: boolean;
  onDropFile: (source: PromptSource) => void;
  onMultipleFiles: () => void;
}

function isFileDrag(e: DragEvent): boolean {
  return e.dataTransfer.types.includes('Files');
}

/** PNG ファイルのドラッグ＆ドロップを受け付けるイベントハンドラとドラッグ中状態を返す。 */
export function usePngDrop({ enabled, onDropFile, onMultipleFiles }: Options) {
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  const dropProps = {
    onDragEnter: (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      if (enabled) {
        dragDepth.current++;
        setDragging(true);
      }
    },
    onDragOver: (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = enabled ? 'copy' : 'none';
    },
    onDragLeave: (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    },
    onDrop: (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      if (!enabled) return;
      const files = e.dataTransfer.files;
      if (files.length > 1) onMultipleFiles();
      else if (files[0]) onDropFile({ blob: files[0], name: files[0].name });
    },
  };

  return { dragging, dropProps };
}
