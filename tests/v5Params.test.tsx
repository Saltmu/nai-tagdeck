// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CharacterCard } from '../src/components/CharacterCard';
import { GenerateBar } from '../src/components/GenerateBar';
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
        token={token}
        onOpenSettings={() => {}}
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

/** 生成パネルのサイズ指定ボタン（フッターのピクトグラムとは別）。 */
function panelSizeButton(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll<HTMLButtonElement>('.size-groups [role="radio"]')]
    .find((b) => b.getAttribute('aria-label') === label);
  if (!found) throw new Error(`パネルのサイズボタンが見つかりません: ${label}`);
  return found;
}

function panelSizeChecked(): string | null {
  return container.querySelector('.size-groups [role="radio"][aria-checked="true"]')?.getAttribute('aria-label') ?? null;
}

async function setRange(labelText: string, value: string) {
  const label = [...container.querySelectorAll('label')].find((el) => el.textContent?.includes(labelText));
  const input = label?.parentElement?.querySelector('input[type="range"]');
  if (!(input instanceof HTMLInputElement)) throw new Error(`${labelText} のフェーダーが見つかりません`);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

it('switches to a custom size, picks a suggestion, rounds a width and swaps sides', async () => {
  const onGenerationChange = vi.fn();
  function Harness() {
    const [generation, setGeneration] = useState<GenerationSettings>(DEFAULT_GENERATION);
    const handleChange = (patch: Partial<GenerationSettings>) => {
      onGenerationChange(patch);
      setGeneration((prev) => normalizeGeneration({ ...prev, ...patch }));
    };
    return (
      <>
        <GeneratePanel
          generation={generation}
          onGenerationChange={handleChange}
          token={token}
          onOpenSettings={() => {}}
        />
        <GenerateBar
          generation={generation}
          onGenerationChange={handleChange}
          generator={generator}
          token={token}
          blocker={null}
          onGenerate={() => {}}
        />
      </>
    );
  }
  await act(async () => root.render(<Harness />));
  expect(container.querySelector('.custom-size')).toBeNull();
  // パネルのサイズ指定は常時表示され、カスタムはピクトグラムを押さずに選べる
  expect(panelSizeChecked()).toBe('縦 832×1216');

  await act(async () => panelSizeButton('カスタム 832×1216').click());
  expect(onGenerationChange).toHaveBeenCalledWith({ size: 'custom', customWidth: 832, customHeight: 1216 });
  expect(container.querySelector('.custom-size-status')?.textContent).toContain('832×1216（1,011,712 / 1,048,576 px）');
  // フッターのピクトグラムも同じ状態を示す（4 つ目にカスタムが出る）
  expect(container.querySelector('.size-toggle [role="radio"][aria-checked="true"]')?.getAttribute('aria-label')).toBe(
    'カスタム 832×1216',
  );

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

  // 逆方向も連動する。フッターのピクトグラムを押すとパネルの選択も変わる
  const landscapeRadio = [...container.querySelectorAll<HTMLButtonElement>('.size-toggle [role="radio"]')]
    .find((r) => r.getAttribute('aria-label') === '横 1216×832')!;
  await act(async () => landscapeRadio.click());
  expect(onGenerationChange).toHaveBeenCalledWith({ size: 'landscape' });
  expect(panelSizeChecked()).toBe('横 1216×832');
  expect(container.querySelector('.custom-size')).toBeNull();
});

it('puts mode buttons first, groups size buttons by orientation, and uses faders for steps and scale', async () => {
  const onGenerationChange = vi.fn();
  await act(async () => {
    root.render(
      <GeneratePanel
        generation={DEFAULT_GENERATION}
        onGenerationChange={onGenerationChange}
        token={token}
        onOpenSettings={() => {}}
      />,
    );
  });

  // サイズのセレクトボックスは廃止され、パネル内のセレクトはサンプラーとノイズだけ
  expect(container.querySelectorAll('.generate select')).toHaveLength(2);
  // 並びはモード → サイズ指定 → ステップ・スケールのフェーダー
  const grid = container.querySelector('.gen-grid')!;
  const order = (el: Element | null) => (el ? [...grid.children].indexOf(el) : -1);
  const mode = container.querySelector('.mode-toggle')!.closest('.field')!;
  const size = container.querySelector('.size-groups')!.closest('.field')!;
  const steps = container.querySelector<HTMLInputElement>('input[type="range"][id$="-steps"]');
  const scale = container.querySelector<HTMLInputElement>('input[type="range"][id$="-scale"]');
  expect(order(mode)).toBe(0);
  expect(order(size)).toBe(1);
  expect(steps).not.toBeNull();
  expect(scale).not.toBeNull();
  expect(steps!.min).toBe('1');
  expect(steps!.max).toBe('28');
  expect(scale!.min).toBe('0');
  expect(scale!.max).toBe('10');

  // モードはボタン式で、アニメ／ケモノを切り替えられる
  const modeButtons = [...container.querySelectorAll<HTMLButtonElement>('.mode-toggle .mode-btn')];
  expect(modeButtons.map((b) => b.textContent)).toEqual(['アニメ', 'ケモノ']);
  expect(modeButtons[0]!.getAttribute('aria-pressed')).toBe('true');
  await act(async () => modeButtons[1]!.click());
  expect(onGenerationChange).toHaveBeenCalledWith({ mode: 'furry' });

  // サイズボタンは向きごとにグルーピングされ、ピクトグラムと寸法をあわせて表示する
  const groups = [...container.querySelectorAll('.size-group')].map((g) => g.getAttribute('aria-label'));
  expect(groups).toEqual(['縦向き', '横向き', '正方形', 'カスタム']);
  const labels = [...container.querySelectorAll('.size-groups [role="radio"]')].map((b) => b.getAttribute('aria-label'));
  expect(labels).toEqual([
    '縦 832×1216',
    '縦長 768×1344',
    '横 1216×832',
    '横長 1344×768',
    '正方形 1024×1024',
    'カスタム 832×1216',
  ]);
  // ボタンには向きのピクトグラム（SizeIcon の長方形）が入っている
  expect(container.querySelector('.size-groups [role="radio"] svg rect')).not.toBeNull();
  await act(async () => panelSizeButton('縦長 768×1344').click());
  expect(onGenerationChange).toHaveBeenCalledWith({ size: 'tall' });

  // ステップとスケールはフェーダーで、現在値が横に表示される
  await setRange('ステップ', '12');
  expect(onGenerationChange).toHaveBeenCalledWith({ steps: 12 });
  await setRange('スケール', '7.5');
  expect(onGenerationChange).toHaveBeenCalledWith({ scale: 7.5 });
  const stepsOutput = container.querySelector('output[for$="-steps"], .fader-row output');
  expect(stepsOutput?.textContent).toBe(String(DEFAULT_GENERATION.steps));
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
