// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TagRow } from '../src/components/TagRow';
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
