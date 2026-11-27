// @vitest-environment jsdom
import { StrictMode, useState } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { NumberField } from '../src/components/NumberField';
import {
  SCALE_MAX,
  SCALE_MIN,
  SEED_MAX,
  STEPS_MAX,
  STEPS_MIN,
  normalizeCfgRescale,
  normalizeScale,
  normalizeSeed,
  normalizeSteps,
} from '../src/lib/generation';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

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

function input(): HTMLInputElement {
  const field = container.querySelector('input');
  if (!(field instanceof HTMLInputElement)) throw new Error('入力が見つかりません');
  return field;
}

async function type(value: string) {
  const field = input();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(field, value);
    field.dispatchEvent(new InputEvent('input', { bubbles: true, data: value }));
  });
}

async function focus() {
  const field = input();
  await act(async () => {
    field.focus();
    field.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  });
}

async function blur() {
  await act(async () => {
    input().dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });
}

async function enter() {
  await focus();
  await act(async () => {
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
}

function StepsField() {
  const [steps, setSteps] = useState<number>(STEPS_MAX);
  return (
    <NumberField
      value={steps}
      min={STEPS_MIN}
      max={STEPS_MAX}
      step={1}
      onChange={(value) => setSteps(normalizeSteps(value ?? steps))}
    />
  );
}

function ScaleField() {
  const [scale, setScale] = useState(5);
  return (
    <NumberField
      value={scale}
      min={SCALE_MIN}
      max={SCALE_MAX}
      step={0.1}
      onChange={(value) => setScale(normalizeScale(value ?? scale))}
    />
  );
}

function SeedField() {
  const [seed, setSeed] = useState<number | null>(12);
  return (
    <NumberField
      value={seed}
      min={0}
      max={SEED_MAX}
      step={1}
      allowEmpty
      onChange={(value) => setSeed(normalizeSeed(value))}
    />
  );
}

function CfgField() {
  const [cfg, setCfg] = useState(0);
  return (
    <NumberField
      value={cfg}
      min={0}
      max={1}
      step={0.01}
      onChange={(value) => setCfg(normalizeCfgRescale(value ?? cfg))}
    />
  );
}

function CenterField() {
  const clamp = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 100) / 100;
  const [center, setCenter] = useState(0.5);
  return (
    <NumberField
      value={center}
      min={0}
      max={1}
      step={0.01}
      onChange={(value) => setCenter(clamp(value ?? center))}
    />
  );
}

it('restores the clamped steps after blur and Enter when the value is above the maximum', async () => {
  await act(async () => root.render(<StepsField />));
  expect(input().value).toBe('50');

  await type('80');
  expect(input().value).toBe('80');
  await blur();
  expect(input().value).toBe('50');

  await focus();
  await type('80');
  await enter();
  expect(input().value).toBe('50');
  expect(document.activeElement).toBe(input());
});

it('shows the parent-normalized value after commit for scale, cfg, seed, and center', async () => {
  await act(async () => root.render(<ScaleField />));
  await type('5.55');
  await blur();
  expect(input().value).toBe('5.6');

  await act(async () => root.render(<CfgField />));
  await type('1.234');
  await enter();
  expect(input().value).toBe('1');

  await act(async () => root.render(<SeedField />));
  await type('12.9');
  await blur();
  expect(input().value).toBe('12');

  await act(async () => root.render(<CenterField />));
  await type('1.5');
  await blur();
  expect(input().value).toBe('1');
  await type('0.234');
  await enter();
  expect(input().value).toBe('0.23');
});

it('keeps an in-progress edit until commit, then shows a value that actually changed', async () => {
  await act(async () => root.render(<StrictMode><StepsField /></StrictMode>));
  await focus();
  await type('2');
  expect(input().value).toBe('2');

  await blur();
  expect(input().value).toBe('2');

  await type('2.6');
  await enter();
  expect(input().value).toBe('3');
});

it('leaves an in-progress edit in place when the parent value changes, and restores invalid or empty text on commit', async () => {
  function Field() {
    const [steps, setSteps] = useState<number>(STEPS_MAX);
    return (
      <>
        <button type="button" onClick={() => setSteps(10)}>外部</button>
        <NumberField
          value={steps}
          min={STEPS_MIN}
          max={STEPS_MAX}
          step={1}
          onChange={(value) => setSteps(normalizeSteps(value ?? steps))}
        />
      </>
    );
  }

  await act(async () => root.render(<Field />));
  await focus();
  await type('4');
  await act(async () => {
    container.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  expect(input().value).toBe('4');

  await type('abc');
  await blur();
  expect(input().value).toBe('10');

  function Seed() {
    const [seed, setSeed] = useState<number | null>(12);
    return (
      <NumberField
        value={seed}
        min={0}
        max={SEED_MAX}
        step={1}
        allowEmpty
        onChange={setSeed}
      />
    );
  }

  await act(async () => root.render(<Seed />));
  await type('');
  await blur();
  expect(input().value).toBe('');
  await type('   ');
  await enter();
  expect(input().value).toBe('');
});
