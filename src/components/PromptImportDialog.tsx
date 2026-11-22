import { useEffect, useId, useRef, useState } from 'react';
import type { DictEntry, TagGroups } from '../types';
import { categoryLabel, PROMPT_CATEGORY_KEYS } from '../lib/categories';
import { MAX_ENABLED_CHARACTERS } from '../lib/characterLimits';
import { readPromptImport, type PromptImport } from '../lib/promptImport';

export interface PromptSource {
  blob: Blob;
  name: string;
}

interface Props {
  source: PromptSource;
  entries: readonly DictEntry[];
  onCancel: () => void;
  onApply: (result: PromptImport, applyGeneration: boolean) => boolean | Promise<boolean>;
}

type ImportState = { source: PromptSource; entries: readonly DictEntry[] } &
  ({ result: PromptImport } | { error: string });

function TagSummary({ groups }: { groups: TagGroups }) {
  const count = Object.values(groups).reduce((total, tags) => total + tags.length, 0);
  const classified = PROMPT_CATEGORY_KEYS
    .filter((key) => key !== 'unclassified' && groups[key].length > 0)
    .map((key) => `${categoryLabel(key)} ${groups[key].length}件`);
  return (
    <>
      {count}件（未分類 {groups.unclassified.length}件）
      {classified.length > 0 && <span className="hint prompt-import-categories">{classified.join('、')}</span>}
    </>
  );
}

export function PromptImportDialog({ source, entries, onCancel, onApply }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [read, setRead] = useState<ImportState | null>(null);
  const [applyGeneration, setApplyGeneration] = useState(false);
  const [busy, setBusy] = useState(false);
  const applyButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);
  useEffect(() => {
    if (busy || !returnFocus.current) return;
    returnFocus.current = false;
    applyButton.current?.focus();
  }, [busy]);
  useEffect(() => {
    let current = true;
    void readPromptImport(source.blob, entries).then(
      (result) => { if (current) setRead({ source, entries, result }); },
      (error: unknown) => {
        if (current) setRead({ source, entries, error: error instanceof Error ? error.message : '画像を読み取れませんでした' });
      },
    );
    return () => { current = false; };
  }, [entries, source]);

  const state = read?.source === source && read.entries === entries ? read : null;
  const result = state && 'result' in state ? state.result : undefined;
  const error = state && 'error' in state ? state.error : undefined;
  const settingsAvailable = !!result?.generation.labels.length;
  const cancel = () => {
    if (busy) return;
    dialog.current?.close();
    onCancel();
  };
  // 未保存確認を待つ Promise を click から返すと、確認を押す前に呼び出し側が終わってしまう。
  const apply = () => {
    if (!result || busy) return;
    setBusy(true);
    void (async () => {
      try {
        const applied = await onApply(result, settingsAvailable && applyGeneration);
        if (applied) {
          dialog.current?.close();
          onCancel();
        } else {
          returnFocus.current = true;
          setBusy(false);
        }
      } catch (cause) {
        setBusy(false);
        throw cause;
      }
    })();
  };

  return (
    <dialog
      ref={dialog}
      className="app-dialog prompt-import-dialog"
      aria-labelledby={id}
      inert={busy}
      onCancel={(e) => { e.preventDefault(); cancel(); }}
      onClose={onCancel}
    >
      <h2 id={id} className="app-dialog-title">プロンプトを読み込む</h2>
      <p className="hint prompt-import-filename">{source.name}</p>
      {!state && <p role="status">PNG の生成情報を読み込んでいます…</p>}
      {error && <p className="error-banner" role="alert">{error}</p>}
      {result && (
        <div className="prompt-import-summary">
          <p>適用すると作業中のベースとキャラクター一覧を置き換えます。分類によってタグの出力順が変わる場合があります。</p>
          {entries.length === 0 && (
            <p className="hint">このブラウザーの辞書は空です。分類するには「辞書」タブで初期タグやお手持ちの辞書を読み込んでから、PNGを読み込み直してください。</p>
          )}
          <ul>
            <li>ベース　<TagSummary groups={result.base} /></li>
            {result.characters.map((character) => (
              <li key={character.id}>
                {character.name}{character.enabled ? '' : '（OFF）'}　<TagSummary groups={character.tags} />
              </li>
            ))}
            {result.characters.length === 0 && <li>キャラクター情報がないため、キャラクター一覧は空になります。</li>}
            {result.characters.length > MAX_ENABLED_CHARACTERS && <li>{MAX_ENABLED_CHARACTERS + 1}人目以降は OFF で保持します。</li>}
            {result.negative && <li>全体ネガティブ　{result.negative.length}件{result.negative.length === 0 ? '（空欄にします）' : ''}</li>}
            {result.characterNegative !== undefined && <li>共通のキャラ用ネガティブ　{result.characterNegative || '（空欄にします）'}</li>}
          </ul>
          {settingsAvailable && (
            <>
              <label className="prompt-import-settings">
                <input type="checkbox" checked={applyGeneration} onChange={(e) => setApplyGeneration(e.target.checked)} />
                生成設定も適用
              </label>
              <ul>{result.generation.labels.map((label) => <li key={label}>{label}</li>)}</ul>
            </>
          )}
          {result.generation.skipped.length > 0 && (
            <p>未記録または適用できない生成設定は現在の値を使います（{result.generation.skipped.join('、')}）。</p>
          )}
          <ul className="hint">{result.notes.map((note, i) => <li key={i}>{note}</li>)}</ul>
        </div>
      )}
      <div className="app-dialog-actions">
        <button type="button" className="btn" onClick={cancel} disabled={busy} autoFocus>{error ? '閉じる' : 'キャンセル'}</button>
        {result && (
          <button ref={applyButton} type="button" className="btn btn-primary" onClick={apply} disabled={busy}>
            適用
          </button>
        )}
      </div>
    </dialog>
  );
}
