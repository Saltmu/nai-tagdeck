import { type KeyboardEvent, type PointerEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { ChevronUpIcon } from './icons';

type DockTab = 'prompt' | 'generate';

interface Props {
  /** 値が変わるたびにドックを閉じる（画像エリアのクリック用）。 */
  collapseSignal: number;
  generating: boolean;
  error: string | null;
  onDismissError: () => void;
  promptPanel: ReactNode;
  generatePanel: ReactNode;
}

/**
 * 画像の下に浮かべる「プロンプト / 生成」のドック。
 * 閉じた状態ではタブのバーだけを見せ、画像を広く使う。スマホでは下からせり上がるシートになり、PC では画像一覧の下に固定される。
 */
export function GenerateDock({ collapseSignal, generating, error, onDismissError, promptPanel, generatePanel }: Props) {
  const id = useId();
  const dockRef = useRef<HTMLElement>(null);
  const tabRefs = useRef<Record<DockTab, HTMLButtonElement | null>>({ prompt: null, generate: null });
  const [tab, setTab] = useState<DockTab>('prompt');
  const [open, setOpen] = useState(false);

  // 狭い画面ではドックが下端に固定される。高さの分だけ通知を持ち上げる。
  useEffect(() => {
    const el = dockRef.current;
    if (!el) return;
    const media = window.matchMedia?.('(max-width: 1099px)');
    const publish = () => {
      const height = media?.matches ? Math.ceil(el.getBoundingClientRect().height) : 0;
      document.documentElement.style.setProperty('--dock-offset', `${height}px`);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    media?.addEventListener('change', publish);
    return () => {
      observer.disconnect();
      media?.removeEventListener('change', publish);
      document.documentElement.style.removeProperty('--dock-offset');
    };
  }, [open, error]);

  const [seenSignal, setSeenSignal] = useState(collapseSignal);
  if (seenSignal !== collapseSignal) {
    setSeenSignal(collapseSignal);
    setOpen(false);
  }
  const dragStart = useRef<number | null>(null);

  // バーの空いた所のタップ・上スワイプで開き、下スワイプで閉じる
  const onBarPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    dragStart.current = e.clientY;
  };
  const onBarPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const start = dragStart.current;
    dragStart.current = null;
    if (start === null) return;
    const dy = e.clientY - start;
    if (dy < -24) setOpen(true);
    else if (dy > 24) setOpen(false);
    else if (Math.abs(dy) < 8 && !open && !(e.target as Element).closest('button')) setOpen(true);
  };

  const select = (next: DockTab) => {
    if (next === tab) setOpen((value) => !value);
    else {
      setTab(next);
      setOpen(true);
    }
  };

  const tabs: Array<{ key: DockTab; label: string }> = [
    { key: 'prompt', label: 'プロンプト' },
    { key: 'generate', label: '生成' },
  ];

  const onTabKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex((t) => t.key === tab);
    let nextIndex: number | null = null;
    if (e.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') nextIndex = 0;
    else if (e.key === 'End') nextIndex = tabs.length - 1;
    if (nextIndex === null) return;
    e.preventDefault();
    const nextKey = tabs[nextIndex]!.key;
    setTab(nextKey);
    setOpen(true);
    tabRefs.current[nextKey]?.focus();
  };

  return (
    <section ref={dockRef} className={`dock${open ? ' is-open' : ''}`} aria-label="プロンプトと生成設定">
      {/* 閉じていてもエラーは見えるようにする */}
      {error && (
        <div className="gen-error" role="alert">
          <p>{error}</p>
          <button type="button" className="icon-btn" aria-label="エラーを閉じる" onClick={onDismissError}>
            ✕
          </button>
        </div>
      )}
      <div className="dock-bar" onPointerDown={onBarPointerDown} onPointerUp={onBarPointerUp} onPointerCancel={() => { dragStart.current = null; }}>
        <div className="dock-tabs" role="tablist" aria-label="ドックの切り替え" onKeyDown={onTabKeyDown}>
          {tabs.map((t) => (
            <button
              key={t.key}
              ref={(el) => { tabRefs.current[t.key] = el; }}
              type="button"
              role="tab"
              id={`${id}-tab-${t.key}`}
              tabIndex={tab === t.key ? 0 : -1}
              aria-selected={open && tab === t.key}
              aria-controls={`${id}-panel-${t.key}`}
              className="dock-tab"
              onClick={() => select(t.key)}
            >
              {t.label}
              {t.key === 'generate' && generating && (
                <>
                  <span className="spinner spinner-small" aria-hidden="true" />
                  <span className="visually-hidden">（生成中）</span>
                </>
              )}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="icon-btn dock-toggle"
          aria-expanded={open}
          aria-label={open ? 'パネルを閉じる' : 'パネルを開く'}
          onClick={() => setOpen((value) => !value)}
        >
          <ChevronUpIcon />
        </button>
      </div>
      <div className="dock-body" inert={!open}>
        <div className="dock-clip">
          <div className="dock-scroll">
            {tabs.map((t) => (
              <div
                key={t.key}
                role="tabpanel"
                id={`${id}-panel-${t.key}`}
                aria-labelledby={`${id}-tab-${t.key}`}
                hidden={tab !== t.key}
              >
                {t.key === 'prompt' ? promptPanel : generatePanel}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
