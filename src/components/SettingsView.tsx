import type { TokenState } from '../hooks/useToken';
import { TokenSettings } from './TokenSettings';
import { BackupCard } from './BackupCard';
import type { Backup } from '../lib/backup';
import { DangerZone } from './DangerZone';
import { tutorialUrl } from '../lib/tutorialLinks';

interface Props {
  token: TokenState;
  notify: (message: string) => void;
  getBackup: () => Backup;
  onImportBackup: (data: Backup) => Promise<void>;
  onResetAll: () => void;
  onShowFirstRun: () => void;
  firstRunDisabled: boolean;
}

export function SettingsView({ token, notify, getBackup, onImportBackup, onResetAll, onShowFirstRun, firstRunDisabled }: Props) {
  return (
    <div className="settings">
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
            <summary>初回案内をもう一度表示</summary>
            <div className="accordion-body">
              <p className="hint">タグの例とタグ辞書の読み込みを選び直せます。辞書と保存済みプリセットは残ります。作業中のタグをタグの例で置き換える前には確認します。</p>
              <button type="button" className="btn" disabled={firstRunDisabled} onClick={onShowFirstRun}>
                初回案内をもう一度表示
              </button>
            </div>
          </details>
          <details className="accordion">
            <summary>基本的な使い方</summary>
            <div className="accordion-body">
              <ol className="howto-steps">
                <li>辞書にタグを登録し、編集画面でタグを組み合わせてプロンプトを作ります。</li>
                <li>ネガティブプロンプトは専用の編集タブでタグとして編集できます。</li>
                <li>生成画面で生成設定を確認して画像を生成します。生成にはこの画面の「トークン」設定が必要です。</li>
                <li>気に入った組み合わせは、編集画面の「新しいプリセットとして保存」で名前を付けて残せます。プリセットを読み込んだ後の変更は「変更を上書き」で反映できます。</li>
                <li>生成した画像は「PNGをダウンロード」で端末に保存します。</li>
              </ol>
            </div>
          </details>
          <details className="accordion">
            <summary>自動保存の補足</summary>
            <div className="accordion-body">
              <p className="hint">作業内容はこのブラウザに自動保存され、次回も続きから編集できます。</p>
              <p className="hint">生成画像は自動保存されません。「PNGをダウンロード」で端末に残してください。</p>
              <p className="hint">辞書・プリセット・作業内容・設定を別の端末やサイトに移すときは、下の「バックアップを書き出す」を使います。</p>
            </div>
          </details>
          <details className="accordion">
            <summary>通信先</summary>
            <div className="accordion-body">
              <p className="hint">アプリ本体の読み込み・更新のための配信元への通信を除き、このツールの外部通信先は画像生成時のNovelAIのみです。生成時はプロンプト・生成設定・認証用トークンをブラウザからNovelAIへ直接送信します。辞書・プリセット・作業内容・設定はこのブラウザに保存し、このサイトのサーバーには送信しません。トークンもこのサイトのサーバーには送信しません。</p>
            </div>
          </details>
        </div>
      </section>
      <TokenSettings token={token} notify={notify} />
      <BackupCard getData={getBackup} onImport={onImportBackup} notify={notify} />
      <DangerZone onReset={onResetAll} />
      <section className="card" aria-labelledby="disclaimer-title">
        <h2 id="disclaimer-title" className="card-title">免責事項</h2>
        <p className="hint">本ツールはNovelAIの非公式ツールであり、NovelAIの運営元による提供・承認を受けたものではありません。動作や生成結果を保証するものではなく、NovelAIの仕様変更などにより利用できなくなる場合があります。</p>
        <p className="hint">NovelAIの利用条件・料金・生成内容の取り扱いは、同サービスの規約や案内をご確認ください。利用に伴うデータの消失やその他の損害について、開発者は責任を負いかねます。ブラウザのデータ削除などで保存内容が失われる場合があるため、必要なデータはバックアップし、画像はダウンロードしてください。</p>
      </section>
    </div>
  );
}
