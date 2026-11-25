// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CharacterCard } from '../src/components/CharacterCard';
import { GeneratePanel } from '../src/components/GeneratePanel';
import { DialogProvider } from '../src/components/Dialogs';
import { DEFAULT_GENERATION, normalizeGeneration, type GenerationSettings } from '../src/lib/generation';
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

it('switches to a custom size, picks a suggestion, rounds a width and swaps sides', async () => {
  const onGenerationChange = vi.fn();
  function Harness() {
    const [generation, setGeneration] = useState<GenerationSettings>(DEFAULT_GENERATION);
    return (
      <GeneratePanel
        generation={generation}
        onGenerationChange={(patch) => {
          onGenerationChange(patch);
          setGeneration((prev) => normalizeGeneration({ ...prev, ...patch }));
        }}
        generator={generator}
        token={token}
        onOpenSettings={() => {}}
        blocker={null}
        onGenerate={() => {}}
      />
    );
  }
  await act(async () => root.render(<Harness />));
  expect(container.querySelector('.custom-size')).toBeNull();

  const customRadio = [...container.querySelectorAll<HTMLButtonElement>('[role="radio"]')]
    .find((r) => r.getAttribute('aria-label') === 'カスタム 832×1216')!;
  await act(async () => customRadio.click());
  expect(onGenerationChange).toHaveBeenCalledWith({ size: 'custom', customWidth: 832, customHeight: 1216 });
  expect(container.querySelector('.custom-size-status')?.textContent).toContain('832×1216（1,011,712 / 1,048,576 px）');

  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="カスタムサイズ 896×1152 にする"]')!.click());
  expect(onGenerationChange).toHaveBeenCalledWith({ size: 'custom', customWidth: 896, customHeight: 1152 });
  expect(container.querySelector('.custom-size-status')?.textContent).toContain('896×1152（1,032,192 / 1,048,576 px）');

  await commitNumber('幅', '900');
  expect(onGenerationChange).toHaveBeenCalledWith({ size: 'custom', customWidth: 896, customHeight: 1152 });
  expect(container.querySelector('.custom-size-status')?.textContent).toContain('丸め');

  const swap = [...container.querySelectorAll('button')].find((b) => b.textContent === '縦横を入れ替え');
  await act(async () => swap!.click());
  expect(onGenerationChange).toHaveBeenCalledWith({ size: 'custom', customWidth: 1152, customHeight: 896 });
  expect(container.querySelector('.custom-size-status')?.textContent).toContain('1152×896');
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
        enabledCount={1}
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

it('asks to duplicate a character and explains an OFF copy at the generation limit', async () => {
  const character = newCharacter(0);
  character.name = 'アリス';
  const dispatch = vi.fn();
  const notify = vi.fn();
  const renderCard = (enabledCount: number, count = 2, current = character) => root.render(
    <DialogProvider>
      <CharacterCard
        character={current}
        index={0}
        count={count}
        dispatch={dispatch}
        entries={[]}
        syntax="numeric"
        isKnown={() => false}
        onCopy={() => {}}
        notify={notify}
        onRegister={() => {}}
        sharedNegative=""
        enabledCount={enabledCount}
      />
    </DialogProvider>,
  );
  const clickDuplicate = async () => {
    const button = container.querySelector<HTMLButtonElement>('button[aria-label="アリス を複製"]');
    expect(button).not.toBeNull();
    await act(async () => button!.click());
    return button!;
  };

  await act(async () => renderCard(6));
  await clickDuplicate();
  expect(dispatch).toHaveBeenCalledWith({ type: 'duplicateCharacter', id: character.id });
  expect(notify).toHaveBeenCalledWith('生成対象は最大6人のため、「アリス（コピー）」はOFFで追加しました');

  dispatch.mockClear();
  notify.mockClear();
  await act(async () => renderCard(5));
  await clickDuplicate();
  expect(dispatch).toHaveBeenCalledWith({ type: 'duplicateCharacter', id: character.id });
  expect(notify).not.toHaveBeenCalled();

  dispatch.mockClear();
  notify.mockClear();
  await act(async () => renderCard(6, 2, { ...character, enabled: false }));
  await clickDuplicate();
  expect(notify).not.toHaveBeenCalled();

  dispatch.mockClear();
  await act(async () => renderCard(6, 15));
  const disabled = await clickDuplicate();
  expect(disabled.disabled).toBe(true);
  expect(disabled.title).toBe('アリス を複製');
  expect(dispatch).not.toHaveBeenCalled();
});
