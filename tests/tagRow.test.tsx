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

it('shows the Japanese alias inline by default and moves a tag from the edit accordion', async () => {
  const onMoveTag = vi.fn();
  const moveTargets: MoveTargetGroup[] = [
    { id: 'base', label: 'ベース', options: [{ target: 'base', category: 'outfit', label: '衣装' }] },
    { id: 'c1', label: 'キャラ1', options: [{ target: 'c1', category: 'appearance', label: '外見' }] },
  ];

  // 通常表示: 日本語名をタグ名の横（狭い画面では下）に常時表示する
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
  expect(container.querySelector('.tag-alias')?.textContent).toBe('女の子 / おんなのこ');
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

  // 編集モードを開いたとき: 移動は既定で閉じたアコーディオンに入り、入力のすぐ横には✓／×だけが並ぶ
  const edit = container.querySelector<HTMLButtonElement>('button[aria-label="1girl を編集"]')!;
  await act(async () => edit.click());
  expect(container.querySelector('.tag-alias-edit')?.textContent).toContain('女の子 / おんなのこ');
  expect(container.querySelector('.tag-edit-hint')?.textContent).toBe('Enter で保存・Esc でキャンセル');
  const details = container.querySelector<HTMLDetailsElement>('.tag-edit-move-details')!;
  expect(details.open).toBe(false);
  expect(details.querySelector('summary')?.textContent).toBe('カテゴリ移動');
  // アコーディオンを開いてから select を変えただけでは移動せず、「移動」ボタン押下で onMoveTag が呼ばれる
  await act(async () => { details.open = true; });
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

  // タグ名を変更している間は移動ボタンを無効化し、理由を画面に表示する。元に戻せば再度有効になる
  const nameInput = container.querySelector<HTMLInputElement>('input[aria-label="1girl のタグを編集"]')!;
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    set?.call(nameInput, '2girls');
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(moveButton.disabled).toBe(true);
  expect(container.textContent).toContain('タグ名を変更したままでは移動できません');
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    set?.call(nameInput, '1girl');
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(moveButton.disabled).toBe(false);
  expect(container.textContent).not.toContain('タグ名を変更したままでは移動できません');

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

const DRAG_EVENTS = ['pointermove', 'pointerup', 'pointercancel'] as const;

function pointerEvent(type: string, clientY = 20): MouseEvent {
  return new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientY });
}

/** window に付いた並べ替えドラッグのリスナーを種類ごとに追跡する。 */
function trackDragListeners() {
  const live = new Map<string, Set<EventListener>>();
  const realAdd = window.addEventListener.bind(window);
  const realRemove = window.removeEventListener.bind(window);
  const remember = (type: string, listener: EventListenerOrEventListenerObject | null) => {
    if (!DRAG_EVENTS.includes(type as (typeof DRAG_EVENTS)[number]) || typeof listener !== 'function') return null;
    return listener;
  };
  const addSpy = vi.spyOn(window, 'addEventListener').mockImplementation((type, listener, options) => {
    const fn = remember(type, listener);
    if (fn) {
      const set = live.get(type) ?? new Set<EventListener>();
      set.add(fn);
      live.set(type, set);
    }
    realAdd(type, listener, options);
  });
  const removeSpy = vi.spyOn(window, 'removeEventListener').mockImplementation((type, listener, options) => {
    const fn = remember(type, listener);
    if (fn) live.get(type)?.delete(fn);
    realRemove(type, listener, options);
  });
  return {
    liveCount() {
      let count = 0;
      for (const set of live.values()) count += set.size;
      return count;
    },
    restore() {
      addSpy.mockRestore();
      removeSpy.mockRestore();
    },
  };
}

function renderDragRow(onDrag: (id: string, clientY: number) => void, sorting = true) {
  return root.render(
    <ul>
      <TagRow
        tag={tag}
        sorting={sorting}
        onDrag={onDrag}
        onToggle={() => {}}
        onWeight={() => {}}
        onEdit={onEdit}
        onRemove={onRemove}
      />
    </ul>,
  );
}

async function startSortDrag() {
  const area = container.querySelector<HTMLElement>('.drag-area');
  expect(area).not.toBeNull();
  await act(async () => {
    area!.dispatchEvent(pointerEvent('pointerdown'));
  });
  expect(area!.classList.contains('is-dragging')).toBe(true);
}

it('drops window drag listeners when the row unmounts mid-drag', async () => {
  const onDrag = vi.fn();
  const listeners = trackDragListeners();
  try {
    function Harness({ show }: { show: boolean }) {
      if (!show) return <ul />;
      return (
        <ul>
          <TagRow
            tag={tag}
            sorting
            onDrag={onDrag}
            onToggle={() => {}}
            onWeight={() => {}}
            onEdit={onEdit}
            onRemove={onRemove}
          />
        </ul>
      );
    }
    await act(async () => root.render(<Harness show />));
    await startSortDrag();
    await act(async () => {
      window.dispatchEvent(pointerEvent('pointermove', 40));
    });
    expect(onDrag).toHaveBeenCalledTimes(1);
    expect(onDrag).toHaveBeenCalledWith('1', 40);
    expect(listeners.liveCount()).toBe(3);

    await act(async () => root.render(<Harness show={false} />));
    expect(listeners.liveCount()).toBe(0);
    await act(async () => {
      window.dispatchEvent(pointerEvent('pointermove', 80));
      window.dispatchEvent(pointerEvent('pointerup'));
    });
    expect(onDrag).toHaveBeenCalledTimes(1);
  } finally {
    listeners.restore();
  }
});

it('drops window drag listeners when sorting ends mid-drag', async () => {
  const onDrag = vi.fn();
  const listeners = trackDragListeners();
  try {
    await act(async () => renderDragRow(onDrag, true));
    await startSortDrag();
    await act(async () => {
      window.dispatchEvent(pointerEvent('pointermove', 30));
    });
    expect(onDrag).toHaveBeenCalledTimes(1);
    expect(listeners.liveCount()).toBe(3);

    await act(async () => renderDragRow(onDrag, false));
    expect(container.querySelector('.drag-area')).toBeNull();
    expect(listeners.liveCount()).toBe(0);
    await act(async () => {
      window.dispatchEvent(pointerEvent('pointermove', 90));
    });
    expect(onDrag).toHaveBeenCalledTimes(1);

    await act(async () => renderDragRow(onDrag, true));
    expect(container.querySelector('.drag-area')?.classList.contains('is-dragging')).toBe(false);
    await act(async () => {
      window.dispatchEvent(pointerEvent('pointermove', 100));
    });
    expect(onDrag).toHaveBeenCalledTimes(1);
  } finally {
    listeners.restore();
  }
});

it('replaces window drag listeners when a new drag starts before the previous one ends', async () => {
  const onDrag = vi.fn();
  const listeners = trackDragListeners();
  try {
    await act(async () => renderDragRow(onDrag));
    await startSortDrag();
    expect(listeners.liveCount()).toBe(3);
    await startSortDrag();
    expect(listeners.liveCount()).toBe(3);
    await act(async () => {
      window.dispatchEvent(pointerEvent('pointermove', 55));
    });
    expect(onDrag).toHaveBeenCalledTimes(1);
    expect(onDrag).toHaveBeenCalledWith('1', 55);

    await act(async () => {
      window.dispatchEvent(pointerEvent('pointerup'));
    });
    expect(listeners.liveCount()).toBe(0);
    expect(container.querySelector('.drag-area')?.classList.contains('is-dragging')).toBe(false);
    await act(async () => {
      window.dispatchEvent(pointerEvent('pointermove', 70));
    });
    expect(onDrag).toHaveBeenCalledTimes(1);
  } finally {
    listeners.restore();
  }
});

it('orders unclassified row controls like a normal row, with the suggestion and move select last', async () => {
  const onMoveCategory = vi.fn();
  await act(async () => root.render(
    <ul>
      <TagRow
        tag={tag}
        onToggle={() => {}}
        onWeight={() => {}}
        onEdit={onEdit}
        onRemove={onRemove}
        moveDestinations={['quality', 'outfit']}
        suggestedCategory="outfit"
        onMoveCategory={onMoveCategory}
      />
    </ul>,
  ));
  const row = container.querySelector('.tag-row')!;
  // 通常カテゴリと同じ並び（編集・重み・削除）の後に、推奨カテゴリ表示と移動先ドロップダウン
  const order = [...row.querySelectorAll(':scope > *')].map((el) => {
    if (el.matches('button[aria-label$=" を編集"]')) return 'edit';
    if (el.matches('.weight-control')) return 'weight';
    if (el.matches('button[aria-label$=" を削除"]')) return 'remove';
    if (el.matches('.tag-category-suggest')) return 'suggest';
    if (el.matches('.tag-category-move')) return 'move';
    return el.className;
  });
  expect(order).toEqual(['tag-check', 'edit', 'weight', 'remove', 'suggest', 'move']);
  expect(container.querySelector('.tag-category-suggest')?.textContent).toBe('候補: 衣装');
});
