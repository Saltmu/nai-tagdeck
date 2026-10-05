import { useId } from 'react';
import type { Settings } from '../types';
import type { TokenState } from '../hooks/useToken';
import { DEFAULT_SETTINGS } from '../lib/settings';
import { TokenSettings } from './TokenSettings';

interface Props {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  token: TokenState;
  notify: (message: string) => void;
}

type TextKey = 'negativePrompt' | 'characterNegativePrompt';

const FIELDS: Array<{ key: TextKey; label: string; help: string }> = [
  {
    key: 'negativePrompt',
    label: 'ネガティブ（Undesired Content）',
    help: '生成時にだけ送ります。既定値は公式UIの UC プリセット「heavy」と同じ文面です。NSFW を生成するときは先頭の nsfw を消してください。',
  },
  {
    key: 'characterNegativePrompt',
    label: 'キャラクター用のネガティブ',
    help: 'ON のキャラクターすべてに同じ文面を付けます。',
  },
];

export function SettingsView({ settings, onChange, token, notify }: Props) {
  const id = useId();
  return (
    <div className="settings">
      <TokenSettings token={token} notify={notify} />
      <section className="card" aria-labelledby={`${id}-gen`}>
        <h2 id={`${id}-gen`} className="card-title">
          生成の設定
        </h2>
        {FIELDS.map(({ key, label, help }) => (
          <div className="setting" key={key}>
            <div className="setting-head">
              <label htmlFor={`${id}-${key}`}>{label}</label>
              <button
                type="button"
                className="btn btn-small"
                disabled={settings[key] === DEFAULT_SETTINGS[key]}
                onClick={() => onChange({ [key]: DEFAULT_SETTINGS[key] })}
              >
                既定値に戻す
              </button>
            </div>
            <textarea
              id={`${id}-${key}`}
              rows={key === 'negativePrompt' ? 5 : 2}
              spellCheck={false}
              autoCapitalize="off"
              value={settings[key]}
              onChange={(e) => onChange({ [key]: e.target.value })}
            />
            <p className="hint">{help}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
