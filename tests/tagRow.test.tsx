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
    { id: 'base', label: 'ベース', options: [{ target: 'base', category: 'outfit', label: '衣装' }] },
    { id: 'c1', label: 'キャラ1', options: [{ target: 'c1', category: 'appearance', label: '外見' }] },
  ];

  // 通常表示: title のみで .tag-alias や移動 select は出ない
  await act(async () => root.render(
    <ul>
      <TagRow
        tag={tag}
        aliases={['女の子 / おんなのこ']}
        moveTargets={moveTargets}
        onMoveTag={onMoveTag}
        onToggle={() => {}}
        onWeight={() => {}}
        onEdit={onEdit}
        onRemove={onRemove}
      />
    </ul>,
  ));
  expect(container.querySelector('.tag-name')?.getAttribute('title')).toBe('女の子 / おんなのこ');
  expect(container.querySelector('.tag-alias')).toBeNull();
  expect(container.querySelector('.tag-edit-move')).toBeNull();

  // 日本語エイリアス（' / ' を含む単一エイリアス含む）で検索ヒット時: .tag-alias を出し一致箇所を mark する
  await act(async () => root.render(
    <ul>
      <TagRow
        tag={tag}
        aliases={['女の子 / おんなのこ']}
        query="女の子 / おんなのこ"
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
  expect(aliasEl?.textContent).toBe('女の子 / おんなのこ');
  expect(aliasEl?.querySelector('mark')?.textContent).toBe('女の子 / おんなのこ');

  // 編集モードを開いたとき: select を変えただけでは移動せず、「移動」ボタン押下で onMoveTag が呼ばれる
  const edit = container.querySelector<HTMLButtonElement>('button[aria-label="1girl を編集"]')!;
  await act(async () => edit.click());
  expect(container.querySelector('.tag-alias-edit')?.textContent).toContain('女の子 / おんなのこ');
  const select = container.querySelector<HTMLSelectElement>('.tag-edit-move')!;
  const moveButton = container.querySelector<HTMLButtonElement>('button[aria-label="1girl を移動"]')!;
  expect(select).not.toBeNull();
  expect(moveButton.disabled).toBe(true);

  await act(async () => {
    select.value = JSON.stringify(['c1', 'appearance']);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(onMoveTag).not.toHaveBeenCalled();
  expect(moveButton.disabled).toBe(false);

  // タグ名を変更している間は移動ボタンを無効化し、元に戻せば再度有効になる
  const nameInput = container.querySelector<HTMLInputElement>('input[aria-label="1girl のタグを編集"]')!;
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    set?.call(nameInput, '2girls');
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(moveButton.disabled).toBe(true);
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    set?.call(nameInput, '1girl');
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(moveButton.disabled).toBe(false);

  // moveTargets の並び順が変わっても target ID に基づいて正しい移動先へ送る
  const reorderedTargets: MoveTargetGroup[] = [
    { id: 'c2', label: 'キャラ2', options: [{ target: 'c2', category: 'appearance', label: '外見' }] },
    { id: 'c1', label: 'キャラ1', options: [{ target: 'c1', category: 'appearance', label: '外見' }] },
  ];
  await act(async () => root.render(
    <ul>
      <TagRow
        tag={tag}
        aliases={['女の子 / おんなのこ']}
        moveTargets={reorderedTargets}
        onMoveTag={onMoveTag}
        onToggle={() => {}}
        onWeight={() => {}}
        onEdit={onEdit}
        onRemove={onRemove}
      />
    </ul>,
  ));
  await act(async () => moveButton.click());
  expect(onMoveTag).toHaveBeenCalledWith('1', 'c1', 'appearance');

  // インタラクション接頭辞付きタグの編集時はベース移動先を除外する
  const actionTag: WorkTag = { id: '2', tag: 'source#hug', enabled: true, weight: 1 };
  await act(async () => root.render(
    <ul>
      <TagRow
        key={actionTag.id}
        tag={actionTag}
        moveTargets={reorderedTargets.concat({ id: 'base', label: 'ベース', options: [{ target: 'base', category: 'pose', label: 'ポーズ' }] })}
        onMoveTag={onMoveTag}
        onToggle={() => {}}
        onWeight={() => {}}
        onEdit={onEdit}
        onRemove={onRemove}
      />
    </ul>,
  ));
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="source#hug を編集"]')!.click());
  const actionGroups = [...container.querySelectorAll('.tag-edit-move optgroup')].map((el) => el.getAttribute('label'));
  expect(actionGroups).toEqual(['キャラ2', 'キャラ1']);
  const actionOptions = [...container.querySelectorAll('.tag-edit-move option')].map((el) => el.textContent);
  expect(actionOptions).toEqual(['カテゴリ移動', 'キャラ2 / 外見', 'キャラ1 / 外見']);
});
