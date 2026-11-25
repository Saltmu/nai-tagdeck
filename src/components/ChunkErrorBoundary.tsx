import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * 動的 import() で分離した画面・モーダルの読み込み失敗を受け止める。
 * デプロイ直後のチャンクハッシュ不整合やオフライン遷移でチャンクが
 * 取得できなくてもアプリ全体はクラッシュせず、復旧案内を出す。
 * なお React.lazy は失敗した import をキャッシュするため、チャンク取得
 * そのものに失敗した場合は「再試行」では直らず、ページの再読み込みが必要。
 */
export class ChunkErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  private retry = () => {
    this.setState({ error: null });
  };

  private reload = () => {
    window.location.reload();
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <section className="card" role="alert">
        <p>画面の読み込みに失敗しました。</p>
        <p className="hint">
          デプロイ直後やオフラインでは、チャンクの取得に失敗することがあります。
          ページを再読み込みすると直る場合があります。
        </p>
        <div className="app-dialog-actions">
          <button type="button" className="btn" onClick={this.retry}>再試行</button>
          <button type="button" className="btn btn-primary" onClick={this.reload}>ページを再読み込み</button>
        </div>
      </section>
    );
  }
}
