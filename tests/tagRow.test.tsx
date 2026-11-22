// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TagRow, type MoveTargetGroup } from '../src/components/TagRow';
import type { WorkTag } from '../src/types';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const tag: WorkTag = { id: '1', tag: '1girl', enabled: true, weight: 1 };

let container: HTMLDivElement;
let root: Root;
const onRemove = vi.fn();
const onEdit = vi.fn(() => null);

function renderRow() {
  return root.render(
    <ul>
      <TagRow
        tag={tag}
        onToggle={() => {}}
        onWeight={() => {}}
        onEdit={onEdit}
        onRemove={onRemove}
      />
    </ul>,
  );
}

beforeEach(() => {
  onRemove.mockClear();
  onEdit.mockClear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const removeButtons = () => container.querySelectorAll('button[aria-label="1girl を削除"]');

it('hides the delete button while the tag name is being edited', async () => {
  await act(async () => renderRow());
  expect(removeButtons()).toHaveLength(1);

  const edit = container.querySelector<HTMLButtonElement>('button[aria-label="1girl を編集"]')!;
  await act(async () => edit.click());

  expect(removeButtons()).toHaveLength(0);
  expect(container.querySelector('button[aria-label="保存"]')).not.toBeNull();
  expect(container.querySelector('button[aria-label="キャンセル"]')).not.toBeNull();
  expect(container.querySelectorAll('button')).toHaveLength(2);

  const cancel = container.querySelector<HTMLButtonElement>('button[aria-label="キャンセル"]')!;
  await act(async () => cancel.click());
  expect(removeButtons()).toHaveLength(1);
  expect(onRemove).not.toHaveBeenCalled();
  expect(onEdit).not.toHaveBeenCalled();
});

it('shows alias only as title tooltip by default, and renders inline alias or move select on alias search / edit mode', async () => {
  const onMoveTag = vi.fn();
  const moveTargets: MoveTargetGroup[] = [
    { label: 'ベース', options: [{ target: 'base', category: 'outfit', label: '衣装' }] },
    { label: 'キャラ1', options: [{ target: 'c1', category: 'appearance', label: '外見' }] },
  ];

  // 通常表示: title のみで .tag-alias や移動 select は出ない
  await act(async () => root.render(
    <ul>
      <TagRow
        tag={tag}
        alias="女の子 おんなのこ"
        moveTargets={moveTargets}
        onMoveTag={onMoveTag}
        onToggle={() => {}}
        onWeight={() => {}}
        onEdit={onEdit}
        onRemove={onRemove}
      />
    </ul>,
  ));
  expect(container.querySelector('.tag-name')?.getAttribute('title')).toBe('女の子 おんなのこ');
  expect(container.querySelector('.tag-alias')).toBeNull();
  expect(container.querySelector('.tag-edit-move')).toBeNull();

  // 日本語エイリアスで検索ヒット時: .tag-alias を出し一致箇所を mark する
  await act(async () => root.render(
    <ul>
      <TagRow
        tag={tag}
        alias="女の子 おんなのこ"
        query="女"
        moveTargets={moveTargets}
        onMoveTag={onMoveTag}
        onToggle={() => {}}
        onWeight={() => {}}
        onEdit={onEdit}
        onRemove={onRemove}
      />
    </ul>,
  ));
  const aliasEl = container.querySelector('.tag-alias');
  expect(aliasEl?.textContent).toBe('女の子 おんなのこ');
  expect(aliasEl?.querySelector('mark')?.textContent).toBe('女');

  // 編集モードを開いたとき: .tag-alias と移動 select が表示され、選択すると onMoveTag が呼ばれる
  const edit = container.querySelector<HTMLButtonElement>('button[aria-label="1girl を編集"]')!;
  await act(async () => edit.click());
  expect(container.querySelector('.tag-alias-edit')?.textContent).toContain('女の子 おんなのこ');
  const select = container.querySelector<HTMLSelectElement>('.tag-edit-move')!;
  expect(select).not.toBeNull();
  await act(async () => {
    select.value = '1:0';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(onMoveTag).toHaveBeenCalledWith('1', 'c1', 'appearance');
});
