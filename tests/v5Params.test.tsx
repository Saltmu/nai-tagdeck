// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CharacterCard } from '../src/components/CharacterCard';
import { GeneratePanel } from '../src/components/GeneratePanel';
import { DialogProvider } from '../src/components/Dialogs';
import { DEFAULT_GENERATION } from '../src/lib/generation';
import { newCharacter } from '../src/lib/workspace';
import type { Generator } from '../src/hooks/useGenerator';
import type { TokenState } from '../src/hooks/useToken';
import type { WorkspaceAction } from '../src/lib/workspace';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const generator: Generator = {
  generating: false,
  error: null,
  generate: vi.fn(async () => {}),
  cancel: vi.fn(),
  dismissError: vi.fn(),
};
const token: TokenState = { token: 'pst-test', storage: 'session', save: () => true, clear: () => {} };

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function inputOf(labelText: string): HTMLInputElement {
  const label = [...container.querySelectorAll('label')].find((el) => el.textContent?.includes(labelText));
  const input = label?.querySelector('input');
  if (!(input instanceof HTMLInputElement)) throw new Error(`${labelText} の入力が見つかりません`);
  return input;
}

async function commitNumber(labelText: string, value: string) {
  const input = inputOf(labelText);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: value }));
  });
  await act(async () => {
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });
}

it('shows the Opus free-tier conditions in the page and edits the advanced settings', async () => {
  const onGenerationChange = vi.fn();
  await act(async () => {
    root.render(
      <GeneratePanel
        generation={DEFAULT_GENERATION}
        onGenerationChange={onGenerationChange}
        generator={generator}
        token={token}
        onOpenSettings={() => {}}
        blocker={null}
        onGenerate={() => {}}
      />,
    );
  });

  const note = container.querySelector('.free-note');
  expect(note?.textContent).toContain('Opus プラン');
  expect(note?.textContent).toContain('28 steps 以下');
  expect(note?.textContent).toContain('1024×1024 相当以下');
  expect(note?.textContent).toContain('Tablet / Scroll');
  expect(container.querySelector('.chip')?.getAttribute('title')).toBeNull();

  const details = container.querySelector('details');
  expect(details?.open).toBe(false);
  await act(async () => {
    container.querySelector('summary')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  if (details && !details.open) details.open = true;

  await commitNumber('CFG リスケール', '0.35');
  expect(onGenerationChange).toHaveBeenCalledWith({ cfgRescale: 0.35 });
  await act(async () => inputOf('ダイナミックしきい値').click());
  expect(onGenerationChange).toHaveBeenCalledWith({ dynamicThresholding: true });
});

it('turns per-character negative and center on from the character card', async () => {
  const character = newCharacter(0);
  character.tags.subject = [{ id: 'girl', tag: 'girl', enabled: true, weight: 1 }];
  const dispatch = vi.fn();
  const renderCard = (current = character) => root.render(
    <DialogProvider>
      <CharacterCard
        character={current}
        index={0}
        count={1}
        dispatch={dispatch}
        entries={[]}
        syntax="numeric"
        isKnown={() => false}
        onCopy={() => {}}
        notify={() => {}}
        onRegister={() => {}}
        sharedNegative="lowres, aliasing, "
      />
    </DialogProvider>,
  );
  await act(async () => renderCard());

  await act(async () => inputOf('個別のネガティブを使う').click());
  expect(dispatch).toHaveBeenCalledWith({
    type: 'setCharacterNegative',
    id: character.id,
    negative: 'lowres, aliasing, ',
  } satisfies WorkspaceAction);

  await act(async () => renderCard({ ...character, negative: '' }));
  const area = container.querySelector('textarea');
  expect(area?.value).toBe('');
  expect(container.textContent).toContain('このキャラにはネガティブを付けません');
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(area, 'blurry');
    area?.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(dispatch).toHaveBeenCalledWith({ type: 'setCharacterNegative', id: character.id, negative: 'blurry' });

  await act(async () => inputOf('位置を指定する').click());
  expect(dispatch).toHaveBeenCalledWith({
    type: 'setCharacterCenter',
    id: character.id,
    center: { x: 0.5, y: 0.5 },
  });
  await act(async () => renderCard({ ...character, negative: 'blurry', center: { x: 0.5, y: 0.5 } }));
  expect(container.textContent).toContain('中央（0.5, 0.5）');
  await commitNumber('横（0 が左、1 が右）', '0.2');
  expect(dispatch).toHaveBeenCalledWith({
    type: 'setCharacterCenter',
    id: character.id,
    center: { x: 0.2, y: 0.5 },
  });
});
