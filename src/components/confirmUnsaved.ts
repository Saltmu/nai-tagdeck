import type { DialogApi } from './Dialogs';

/** 未保存の編集を捨てて進むときの選択。保存して進むなら save、そのままで進むなら proceed。 */
export type UnsavedChoice = 'proceed' | 'save';

/**
 * 作業中のタグを置き換える前に、プリセットへ反映するか確認する。
 * 読み込み中のプリセットがなければ、未保存のまま進むかどうかだけを聞く。
 */
export async function confirmUnsavedChanges(
  dialogs: DialogApi,
  options: { dirty: boolean; activeName: string | null; action: string; okLabel: string },
): Promise<UnsavedChoice | null> {
  const { dirty, activeName, action, okLabel } = options;
  if (!dirty) return 'proceed';
  if (!activeName) {
    const ok = await dialogs.confirm(`今のタグはプリセットに保存されていません。${action}`, { okLabel });
    return ok ? 'proceed' : null;
  }
  const choice = await dialogs.choose(`プリセット「${activeName}」に変更が反映されていません。${action}`, [
    { value: 'discard', label: `反映せずに${okLabel}` },
    { value: 'save', label: `変更を反映してから${okLabel}`, primary: true },
  ]);
  if (choice === 'save') return 'save';
  if (choice === 'discard') return 'proceed';
  return null;
}
