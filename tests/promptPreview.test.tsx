// @vitest-environment jsdom
import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PromptPreview } from '../src/components/PromptPreview';
import type { CharacterPrompt } from '../src/lib/prompt';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const character = (patch: Partial<CharacterPrompt> & Pick<CharacterPrompt, 'id' | 'name' | 'prompt'>): CharacterPrompt => patch;

let container: HTMLDivElement;
let root: Root;
const onCopy = vi.fn();
const onSyntaxChange = vi.fn();

beforeEach(() => {
  onCopy.mockReset();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(props: Partial<ComponentProps<typeof PromptPreview>> = {}) {
  await act(async () => {
    root.render(
      <PromptPreview
        basePrompt="solo"
        characterPrompts={[]}
        syntax="numeric"
        onSyntaxChange={onSyntaxChange}
        onCopy={onCopy}
        negativePrompt="lowres"
        {...props}
      />,
    );
  });
}

function button(label: string, scope: ParentNode = container): HTMLButtonElement {
  const found = [...scope.querySelectorAll('button')].find((node) => node.textContent?.trim() === label);
  if (!found) throw new Error(`Button missing: ${label}`);
  return found;
}

function item(title: string): HTMLElement {
  const found = [...container.querySelectorAll('.preview-item')].find((node) => node.querySelector('dt')?.textContent?.includes(title));
  if (!(found instanceof HTMLElement)) throw new Error(`Preview item missing: ${title}`);
  return found;
}

it('ケモノモードでは送信時と同じ fur dataset を表示し、コピーできる', async () => {
  await render({ mode: 'furry', basePrompt: 'solo, forest' });
  expect(item('ベース').querySelector('output')?.textContent).toBe('fur dataset, solo, forest');
  await act(async () => button('コピー', item('ベース')).click());
  expect(onCopy).toHaveBeenCalledWith('fur dataset, solo, forest', 'プロンプト全体');

  await render({ mode: 'furry', basePrompt: 'fur dataset, wolf' });
  expect(item('ベース').querySelector('output')?.textContent).toBe('fur dataset, wolf');

  await render({ mode: 'furry', basePrompt: '', characterPrompts: [character({ id: 'c1', name: 'キャラ1', prompt: 'wolf' })] });
  expect(item('ベース').querySelector('output')?.textContent).toBe('fur dataset');
  expect(item('ベース').querySelector('output')?.className).not.toContain('is-empty');
  await act(async () => button('コピー', item('ベース')).click());
  expect(onCopy).toHaveBeenCalledWith('fur dataset', 'ベース');
});

it('ケモノでもベースもキャラも空のときは fur dataset を出さず、コピーできない', async () => {
  await render({ mode: 'furry', basePrompt: '', characterPrompts: [] });
  const base = item('ベース');
  expect(base.querySelector('output')?.textContent).toBe('ONのタグがありません');
  expect(button('コピー', base).disabled).toBe(true);
});

it('アニメモードではベースをそのまま出し、空のときはコピーできない', async () => {
  await render({ mode: 'anime', basePrompt: '' });
  const base = item('ベース');
  expect(base.querySelector('output')?.textContent).toBe('ONのタグがありません');
  expect(button('コピー', base).disabled).toBe(true);

  await render({ basePrompt: 'fur dataset, solo' });
  expect(item('ベース').querySelector('output')?.textContent).toBe('fur dataset, solo');
});

it('個別ネガティブと共通ネガティブ、設定した座標を確認でき、ネガティブをコピーできる', async () => {
  await render({
    characterNegative: 'lowres, aliasing, ',
    characterPrompts: [
      character({ id: 'c1', name: 'キャラ1', prompt: 'wolf', negative: 'blurry', center: { x: 0.2, y: 0.8 } }),
      character({ id: 'c2', name: 'キャラ2', prompt: 'cat' }),
      character({ id: 'c3', name: 'キャラ3', prompt: 'fox', negative: '' }),
    ],
  });

  expect(item('キャラ1').querySelector('output')?.textContent).toBe('wolf');
  expect(item('キャラ1').textContent).toContain('位置　横 0.2、縦 0.8');
  expect(item('キャラ2').textContent).not.toContain('位置');
  expect(item('キャラ1のネガティブ').querySelector('output')?.textContent).toBe('blurry');
  expect(item('キャラ2のネガティブ').querySelector('output')?.textContent).toBe('lowres, aliasing, ');
  const empty = item('キャラ3のネガティブ');
  expect(empty.querySelector('output')?.textContent).toBe('ネガティブなし');
  expect(button('コピー', empty).disabled).toBe(true);

  await act(async () => button('コピー', item('キャラ1のネガティブ')).click());
  expect(onCopy).toHaveBeenCalledWith('blurry', 'キャラ1のネガティブ');
  await act(async () => button('コピー', item('キャラ2のネガティブ')).click());
  expect(onCopy).toHaveBeenCalledWith('lowres, aliasing, ', 'キャラ2のネガティブ');
});

it('共通ネガティブを渡さないときは、個別設定のないキャラのネガティブを出さない', async () => {
  await render({
    characterPrompts: [character({ id: 'c1', name: 'キャラ1', prompt: 'wolf', center: { x: 0.5, y: 0.5 } })],
  });
  expect(container.textContent).toContain('位置　横 0.5、縦 0.5');
  expect(container.textContent).not.toContain('キャラ1のネガティブ');
});
