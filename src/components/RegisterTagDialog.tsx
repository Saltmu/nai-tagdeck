import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import type { CategoryKey } from '../types';
import { CATEGORIES, isCategoryKey } from '../lib/categories';
import { clampWeight } from '../lib/prompt';
import { WeightInput } from './WeightInput';

/** 編集画面から辞書へ登録するときの入力。タグ名は編集画面のタグをそのまま使う。 */
export interface RegisterTagDraft {
  tag: string;
  category: CategoryKey;
  alias: string;
  default_weight: number;
}

interface Props {
  tag: string;
  category: CategoryKey;
  weight: number;
  onClose: (saved: boolean) => void;
  /** 保存に失敗したらエラー文を返す。成功は null。 */
  onSave: (draft: RegisterTagDraft) => Promise<string | null>;
}

export function RegisterTagDialog({ tag, category, weight: initialWeight, onClose, onSave }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const aliasInput = useRef<HTMLInputElement>(null);
  const id = useId();
  const [alias, setAlias] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<CategoryKey>(category);
  const [weight, setWeight] = useState(initialWeight);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    // タグ名は決まっているので、日本語名から入力できるようにする。
    aliasInput.current?.focus();
  }, []);

  useEffect(() => {
    if (saving || !error) return;
    const target = returnFocus.current;
    if (target && form.current?.contains(target)) target.focus();
    else aliasInput.current?.focus();
  }, [error, saving]);

  const close = () => {
    if (saving) return;
    dialog.current?.close();
    onClose(false);
  };

  const readWeight = () => {
    const input = form.current?.querySelector<HTMLInputElement>('input[type="number"]');
    if (!input) return clampWeight(weight);
    const n = Number(input.value);
    // Enter 送信と同じタイミングでは、重み入力の state がまだ反映されていないことがある。
    return input.value.trim() !== '' && Number.isFinite(n) ? clampWeight(n) : clampWeight(weight);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const active = document.activeElement;
    returnFocus.current = active instanceof HTMLElement && form.current?.contains(active) ? active : aliasInput.current;
    setSaving(true);
    setError(null);
    let result: string | null;
    try {
      result = await onSave({
        tag,
        category: selectedCategory,
        alias: alias.trim(),
        default_weight: readWeight(),
      });
    } catch (cause) {
      result = `保存できませんでした: ${String(cause)}`;
    }
    if (result) {
      setSaving(false);
      setError(result);
      return;
    }
    onClose(true);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLFormElement>) => {
    if (e.key !== 'Enter') return;
    // 変換確定の Enter は IME に渡す。preventDefault すると変換自体が確定しないことがある。
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    // Ctrl/Cmd+Enter は生成のショートカット。押しっぱなしの Enter でも登録しない。
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) {
      e.preventDefault();
      return;
    }
    // macOS の Chrome は、閉じたセレクト上の Enter でフォームを送信する。
    // 一覧は Space や Alt+↓ のまま開き、Enter では登録しない。ボタンの Enter はブラウザに任せる。
    if (e.target instanceof HTMLSelectElement) {
      e.preventDefault();
      return;
    }
    if (!(e.target instanceof HTMLInputElement)) return;
    e.preventDefault();
    form.current?.requestSubmit();
  };

  // 狭い画面では編集ペインが display:none になる。中にあるとモーダルだけが残り、操作できなくなる。
  return createPortal(
    <dialog
      ref={dialog}
      className="app-dialog register-tag-dialog"
      aria-labelledby={id}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <h2 id={id} className="app-dialog-title">辞書に登録</h2>
      {/* 編集画面の重みは 0.01 単位。number の step=0.05 では 1.23 などが送信前に弾かれる。 */}
      <form ref={form} className="register-tag-form" noValidate onSubmit={submit} onKeyDown={onKeyDown}>
        <fieldset className="register-tag-fields" disabled={saving}>
          <div className="field field-tag">
            <span>タグ名</span>
            <code className="register-tag-name">{tag}</code>
          </div>
          <label className="field field-alias" htmlFor={`${id}-alias`}>
            <span>日本語名・よみ</span>
            <input
              ref={aliasInput}
              id={`${id}-alias`}
              value={alias}
              placeholder="例: 笑顔 えがお（空白区切りで複数）"
              onChange={(e) => setAlias(e.target.value)}
              autoComplete="off"
            />
          </label>
          <label className="field" htmlFor={`${id}-cat`}>
            <span>カテゴリ</span>
            <select
              id={`${id}-cat`}
              value={selectedCategory}
              onChange={(e) => {
                if (isCategoryKey(e.target.value)) setSelectedCategory(e.target.value);
              }}
            >
              {CATEGORIES.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field field-num" htmlFor={`${id}-weight`}>
            <span>既定の重み</span>
            <WeightInput id={`${id}-weight`} value={weight} label="既定の重み" onChange={setWeight} />
          </label>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              登録
            </button>
            <button type="button" className="btn" disabled={saving} onClick={close}>
              キャンセル
            </button>
          </div>
        </fieldset>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </dialog>,
    document.body,
  );
}
