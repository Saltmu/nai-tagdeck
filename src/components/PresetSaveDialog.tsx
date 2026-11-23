import { useId, useLayoutEffect, useRef, useState, type DragEvent } from 'react';

/** エディタの PNG ドロップまで届かせない。保存中の作業内容が入れ替わるのを防ぐ。 */
function stopFileDrag(event: DragEvent<HTMLDialogElement>) {
  if (!event.dataTransfer?.types.includes('Files')) return;
  event.preventDefault();
  event.stopPropagation();
}

interface Props {
  initialName: string;
  includeGeneration: boolean;
  /** 生成設定と共通キャラネガティブの読み込みが成功しているときだけ選べる。 */
  canIncludeGeneration: boolean;
  summary: string;
  onCancel: () => void;
  onSave: (result: { name: string; includeGeneration: boolean }) => void;
}

/** プリセット名と、生成設定を一緒に保存するかの選択。 */
export function PresetSaveDialog({
  initialName,
  includeGeneration,
  canIncludeGeneration,
  summary,
  onCancel,
  onSave,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const settled = useRef(false);
  const [name, setName] = useState(initialName);
  const [include, setInclude] = useState(includeGeneration);

  useLayoutEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    input.current?.focus();
    input.current?.select();
  }, []);

  const finish = (result: { name: string; includeGeneration: boolean } | null) => {
    if (settled.current) return;
    settled.current = true;
    // 開く前のボタンへフォーカスを戻してから、上書き確認などを出す。
    dialog.current?.close();
    if (result) onSave(result);
    else onCancel();
  };

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    finish({ name: trimmed, includeGeneration: include });
  };

  return (
    <dialog
      ref={dialog}
      className="app-dialog"
      aria-labelledby={`${id}-title`}
      onClose={() => finish(null)}
      onDragEnter={stopFileDrag}
      onDragOver={stopFileDrag}
      onDragLeave={stopFileDrag}
      onDrop={stopFileDrag}
    >
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <h2 id={`${id}-title`} className="app-dialog-title">プリセットを保存</h2>
        <label className="field" htmlFor={`${id}-name`}>プリセット名</label>
        <input
          ref={input}
          id={`${id}-name`}
          type="text"
          className="app-dialog-input"
          value={name}
          autoComplete="off"
          onChange={(e) => setName(e.target.value)}
        />
        <label className="preset-save-option">
          <input
            type="checkbox"
            checked={canIncludeGeneration && include}
            disabled={!canIncludeGeneration}
            onChange={(e) => setInclude(e.target.checked)}
          />
          生成設定と共通キャラネガティブも保存する
        </label>
        {canIncludeGeneration && include && <p className="hint preset-save-summary">{summary}</p>}
        {!canIncludeGeneration && (
          <p className="hint preset-save-summary">生成設定を読み込めていないため、タグだけ保存できます。</p>
        )}
        <div className="app-dialog-actions">
          <button type="button" className="btn" onClick={() => finish(null)}>キャンセル</button>
          <button type="submit" className="btn btn-primary">保存</button>
        </div>
      </form>
    </dialog>
  );
}
