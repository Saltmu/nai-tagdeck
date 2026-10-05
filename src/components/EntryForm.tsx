import { useId, useState, type FormEvent } from 'react';
import type { CategoryKey, DictEntry } from '../types';
import { CATEGORIES } from '../lib/categories';
import { clampWeight } from '../lib/prompt';
import { WeightInput } from './WeightInput';

interface Props {
  initial: DictEntry;
  submitLabel: string;
  /** 保存に失敗したらエラー文を返す。 */
  onSave: (entry: DictEntry) => Promise<string | null>;
  onCancel: () => void;
}

export function EntryForm({ initial, submitLabel, onSave, onCancel }: Props) {
  const [tag, setTag] = useState(initial.tag);
  const [category, setCategory] = useState<CategoryKey>(initial.category);
  const [alias, setAlias] = useState(initial.alias);
  const [weight, setWeight] = useState(initial.default_weight);
  const [sortOrder, setSortOrder] = useState(String(initial.sort_order));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const id = useId();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!tag.trim()) {
      setError('タグを入力してください');
      return;
    }
    setSaving(true);
    const result = await onSave({
      ...initial,
      tag: tag.trim(),
      category,
      alias: alias.trim(),
      default_weight: clampWeight(weight),
      sort_order: Math.trunc(Number(sortOrder)) || 0,
    });
    setSaving(false);
    setError(result);
  };

  return (
    <form className="entry-form" onSubmit={submit} onKeyDown={(e) => e.key === 'Escape' && onCancel()}>
      <label className="field field-tag" htmlFor={`${id}-tag`}>
        <span>タグ</span>
        <input
          id={`${id}-tag`}
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          required
          autoFocus
        />
      </label>
      <label className="field" htmlFor={`${id}-cat`}>
        <span>カテゴリ</span>
        <select id={`${id}-cat`} value={category} onChange={(e) => setCategory(e.target.value as CategoryKey)}>
          {CATEGORIES.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field field-alias" htmlFor={`${id}-alias`}>
        <span>日本語名・よみ（空白区切り）</span>
        <input id={`${id}-alias`} value={alias} onChange={(e) => setAlias(e.target.value)} autoComplete="off" />
      </label>
      <label className="field field-num" htmlFor={`${id}-weight`}>
        <span>既定の重み</span>
        <WeightInput id={`${id}-weight`} value={weight} label="既定の重み" onChange={setWeight} />
      </label>
      <label className="field field-num" htmlFor={`${id}-sort`}>
        <span>並び順</span>
        <input
          id={`${id}-sort`}
          type="number"
          inputMode="numeric"
          step={1}
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value)}
        />
      </label>
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {submitLabel}
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          キャンセル
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
