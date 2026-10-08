// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { DialogProvider, useDialogs, type DialogApi } from '../src/components/Dialogs';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
it('backdrop closes the opted-in dialog without choosing, while interior padding does not', async () => {
  const prototype = HTMLDialogElement.prototype;
  const originals = ['showModal', 'close'].map((name) => [name, Object.getOwnPropertyDescriptor(prototype, name)] as const);
  Object.defineProperties(prototype, {
    showModal: { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } },
    close: { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } },
  });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  let dialogs!: DialogApi;
  function Harness() { dialogs = useDialogs(); return null; }
  try {
    await act(async () => root.render(<DialogProvider><Harness /></DialogProvider>));
    let result!: Promise<string | null>;
    await act(async () => { result = dialogs.choose('初回案内', [{ value: 'sample', label: '読み込む', primary: true }], { dismissOnBackdrop: true }); });
    const dialog = container.querySelector('dialog')!;
    vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({ left: 100, right: 300, top: 100, bottom: 300 } as DOMRect);
    await act(async () => { dialog.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 110, clientY: 110 })); });
    expect(container.querySelector('dialog')).not.toBeNull();
    await act(async () => { dialog.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 50, clientY: 50 })); });
    expect(await result).toBeNull();
    expect(container.querySelector('dialog')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(prototype, name, descriptor);
      else Reflect.deleteProperty(prototype, name);
    }
  }
});
