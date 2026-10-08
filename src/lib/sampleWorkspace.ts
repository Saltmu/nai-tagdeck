import { emptyWorkspace, newCharacter, workspaceReducer } from './workspace';

/** 全体の条件と、人物固有の特徴を分けた最小限の編集サンプル。 */
export function createSampleWorkspace() {
  let workspace = emptyWorkspace();
  const character = newCharacter(0);
  character.name = 'サンプルキャラ';
  workspace.characters = [character];
  const picks = [
    ['base', 'quality', 'very aesthetic'],
    ['base', 'quality', 'amazing quality'],
    ['base', 'subject', '1girl'],
    ['base', 'background', 'outdoors'],
    [character.id, 'subject', 'girl'],
    [character.id, 'appearance', 'long hair'],
    [character.id, 'outfit', 'white dress'],
    [character.id, 'pose', 'standing'],
  ] as const;
  for (const [target, category, tag] of picks) {
    workspace = workspaceReducer(workspace, { type: 'add', target, category, tag });
  }
  return workspace;
}
