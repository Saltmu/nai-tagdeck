import type { TokenState } from '../hooks/useToken';
import type { AnlasState } from '../hooks/useAnlas';
import { TokenSettings } from './TokenSettings';
import { BackupCard } from './BackupCard';
import type { Backup, BackupImportMode } from '../lib/backup';
import { DangerZone } from './DangerZone';
import { tutorialUrl } from '../lib/tutorialLinks';
import type { ThemePreference } from '../types';

const THEME_OPTIONS: Array<{ value: ThemePreference; label: string; hint: string }> = [
  { value: 'system', label: 'システム連動', hint: 'OS の設定に合わせます' },
  { value: 'light', label: 'ライト', hint: '常に明るい配色にします' },
  { value: 'dark', label: 'ダーク', hint: '常に暗い配色にします' },
];

interface Props {
  token: TokenState;
  /** Anlas 残高の表示状態。渡さないときは詳細を出さない。 */
  anlas?: AnlasState;
  notify: (message: string) => void;
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
  getBackup: () => Backup;
  onImportBackup: (data: Backup, mode?: BackupImportMode) => Promise<void>;
  onResetAll: () => void;
  onShowFirstRun: () => void;
  firstRunDisabled: boolean;
  backupImportDisabled?: boolean;
  reloadCount?: number;
}

export function SettingsView({
  token,
  anlas,
  notify,
  theme,
  onThemeChange,
  getBackup,
  onImportBackup,
  onResetAll,
  onShowFirstRun,
  firstRunDisabled,
  backupImportDisabled = false,
  reloadCount = 0,
}: Props) {
  return (
    <div className="settings">
      <section className="card" aria-labelledby="appearance-title">
        <h2 id="appearance-title" className="card-title">外観</h2>
        <fieldset className="theme-picker">
          <legend className="visually-hidden">外観テーマ</legend>
          {THEME_OPTIONS.map((option) => (
            <label key={option.value} className="theme-option">
              <input
                type="radio"
                name="theme"
                value={option.value}
                checked={theme === option.value}
                onChange={() => onThemeChange(option.value)}
              />
              <span className="theme-option-label">{option.label}</span>
              <span className="theme-option-hint">{option.hint}</span>
            </label>
          ))}
        </fieldset>
        <p className="hint">切り替えるとすぐに画面へ反映され、自動保存されます。システム連動は OS のライト／ダーク設定に合わせます。</p>
      </section>
      <section className="card" aria-label="使い方">
        <h2 className="card-title">使い方</h2>
        <div className="tutorial-entry">
          <a
            href={tutorialUrl({ view: 'chapters', from: 'howto' })}
            target="_blank"
            rel="noopener noreferrer"
            className="btn"
          >
            操作チュートリアルを開く
          </a>
          <p className="hint">APIトークンの発行・登録からタグ編集、初回生成までを別タブの練習画面で体験できます。</p>
        </div>
        <div className="accordion-list">
          <details className="accordion">
            <summary>
              初回案内をもう一度表示
              <span className="accordion-summary">タグの例と辞書の読み込みを選び直せます</span>
            </summary>
            <div className="accordion-body">
              <p className="hint">タグの例とタグ辞書の読み込みを選び直せます。辞書と保存済みプリセットは残ります。作業中のタグをタグの例で置き換える前には確認します。</p>
              <button type="button" className="btn" disabled={firstRunDisabled} onClick={onShowFirstRun}>
                初回案内をもう一度表示
              </button>
            </div>
          </details>
          <details className="accordion">
            <summary>
              基本的な使い方
              <span className="accordion-summary">辞書への登録から生成までの流れ</span>
            </summary>
            <div className="accordion-body">
              <ol className="howto-steps">
                <li>辞書にタグを登録し、編集画面でタグを組み合わせてプロンプトを作ります。</li>
                <li>ネガティブプロンプトは専用の編集タブでタグとして編集できます。</li>
                <li>生成画面で生成設定を確認して画像を生成します。生成にはこの画面の「トークン」設定が必要です。</li>
                <li>気に入った組み合わせは、編集画面の「新しいプリセットとして保存」で名前を付けて残せます。プリセットを読み込んだ後の変更は「変更を上書き」で反映できます。</li>
                <li>生成した画像は「PNGをダウンロード」で1枚ずつ、またはピン留めした画像を「ピン留めを ZIP 保存」でまとめて端末にダウンロードします。上限を超えると、新しく生成した画像を残し、既存の画像からピン留め以外・ダウンロード操作済み・古い順で削除されます（既存の画像がすべてピン留めのときは、ピン留め画像から同じ順で削除されます）。</li>
              </ol>
            </div>
          </details>
          <details className="accordion">
            <summary>
              自動保存の補足
              <span className="accordion-summary">作業内容は自動保存されます。生成画像は保存されません</span>
            </summary>
            <div className="accordion-body">
              <p className="hint">作業内容はこのブラウザに自動保存され、次回も続きから編集できます。</p>
              <p className="hint">生成画像は自動保存されません。必要な画像はダウンロードしてください。ピン留めもタブを閉じると消えます。</p>
              <p className="hint">辞書・プリセット・作業内容・設定を別の端末やサイトに移すときは、下の「バックアップを書き出す」を使います。</p>
            </div>
          </details>
          <details className="accordion">
            <summary>
              通信先
              <span className="accordion-summary">外部通信は NovelAI への生成時のみです</span>
            </summary>
            <div className="accordion-body">
              <p className="hint">アプリ本体の読み込み・更新のための配信元への通信を除き、このツールの外部通信先は画像生成時のNovelAIのみです。生成時はプロンプト・生成設定・認証用トークンをブラウザからNovelAIへ直接送信します。辞書・プリセット・作業内容・設定はこのブラウザに保存し、このサイトのサーバーには送信しません。トークンもこのサイトのサーバーには送信しません。</p>
            </div>
          </details>
        </div>
      </section>
      <TokenSettings token={token} notify={notify} anlas={anlas} />
      <BackupCard
        getData={getBackup}
        onImport={onImportBackup}
        notify={notify}
        importDisabled={backupImportDisabled}
        reloadCount={reloadCount}
      />
      <DangerZone onReset={onResetAll} />
      <section className="card" aria-labelledby="disclaimer-title">
        <h2 id="disclaimer-title" className="card-title">免責事項</h2>
        <p className="hint">本ツールはNovelAIの非公式ツールであり、NovelAIの運営元による提供・承認を受けたものではありません。動作や生成結果を保証するものではなく、NovelAIの仕様変更などにより利用できなくなる場合があります。</p>
        <p className="hint">NovelAIの利用条件・料金・生成内容の取り扱いは、同サービスの規約や案内をご確認ください。利用に伴うデータの消失やその他の損害について、開発者は責任を負いかねます。ブラウザのデータ削除などで保存内容が失われる場合があるため、必要なデータはバックアップし、画像はダウンロードしてください。</p>
      </section>
    </div>
  );
}
