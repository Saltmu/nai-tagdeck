import { useLayoutEffect, useRef } from 'react';
import type { Generator } from '../hooks/useGenerator';
import type { TokenState } from '../hooks/useToken';
import { resolveSize, sizeChangePatch, type GenerationSettings, type SizeKey } from '../lib/generation';
import { SizePicker } from './SizePicker';

interface Props {
  generation: GenerationSettings;
  onGenerationChange: (patch: Partial<GenerationSettings>) => void;
  generator: Generator;
  token: TokenState;
  /** 生成できない理由（なければ null）。 */
  blocker: string | null;
  onGenerate: () => void;
}

/**
 * 生成ボタンとサイズのピクトグラムを常に下部に置くバー。
 * 編集タブでも生成タブでも表示する（生成ペインの子だが、狭い画面では画面下端に固定する）。
 * サイズは生成パネルのサイズ選択と同一の状態（generation.size）を操作し、表示も一致する。
 */
export function GenerateBar({ generation, onGenerationChange, generator, token, blocker, onGenerate }: Props) {
  const barRef = useRef<HTMLElement>(null);
  const { generating } = generator;
  const customSize = resolveSize(generation);

  // 狭い画面では下端に固定するため、実測の高さを --generate-bar-height として公開する。
  // ドックや通知の持ち上げに使う。作業画面でなければ高さは 0 になる。
  useLayoutEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const publish = () => {
      const height = el.getBoundingClientRect().height;
      document.documentElement.style.setProperty('--generate-bar-height', `${height}px`);
    };
    publish();
    if (typeof ResizeObserver === 'undefined') {
      return () => {
        document.documentElement.style.removeProperty('--generate-bar-height');
      };
    }
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty('--generate-bar-height');
    };
  }, []);

  /** ピクトグラムからのサイズ変更。カスタムは現在の実効寸法で入る。 */
  const handleSizeChange = (next: SizeKey) => {
    onGenerationChange(sizeChangePatch(generation, next));
  };

  return (
    <section ref={barRef} className="generate-bar" aria-label="生成操作">
      {blocker && token.token && <p className="hint gen-blocker">{blocker}</p>}
      <div className="gen-actions">
        <SizePicker size={generation.size} customSize={customSize} onSizeChange={handleSizeChange} />
        {generating && (
          <button type="button" className="btn" onClick={generator.cancel}>
            中止
          </button>
        )}
        <button
          type="button"
          className="btn btn-primary btn-large"
          disabled={generating || blocker !== null}
          title={blocker ?? undefined}
          onClick={onGenerate}
        >
          {generating ? '生成中…' : '生成する'}
        </button>
      </div>
    </section>
  );
}
