export type TutorialSceneId =
  | 'example'
  | 'issue-token'
  | 'register-token'
  | 'edit-tags'
  | 'generate';

export type TutorialEntrySource = 'first-run' | 'howto' | 'token-settings';

export interface TutorialLinkOptions {
  scene?: TutorialSceneId;
  view?: 'chapters';
  from?: TutorialEntrySource;
}

/** サブディレクトリ配信でも解決できるチュートリアルページの相対 URL を組み立てる。 */
export function tutorialUrl(options: TutorialLinkOptions = {}): string {
  const base = import.meta.env.BASE_URL || './';
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  const params = new URLSearchParams();
  if (options.scene) params.set('scene', options.scene);
  if (options.view) params.set('view', options.view);
  if (options.from) params.set('from', options.from);
  const query = params.toString();
  return `${normalizedBase}tutorial/${query ? `?${query}` : ''}`;
}
