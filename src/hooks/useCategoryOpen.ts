import { useEffect, useState } from 'react';
import type { WorkspaceCategoryKey, TargetId } from '../types';
import { loadCategoryOpen, saveCategoryOpen, subscribeCategoryOpen } from '../lib/categoryOpen';

export function useCategoryOpen(target: TargetId, category: WorkspaceCategoryKey): [boolean, () => void] {
  const key = JSON.stringify([target, category]);
  const [state, setState] = useState(() => ({ key, open: loadCategoryOpen(target, category) }));
  const open = state.key === key ? state.open : loadCategoryOpen(target, category);

  useEffect(() => subscribeCategoryOpen((change) => {
    if (change.target !== target || !change.categories.includes(category)) return;
    setState({ key, open: change.open });
  }), [key, target, category]);

  const toggle = () => {
    const next = !open;
    saveCategoryOpen(target, category, next);
    setState({ key, open: next });
  };

  return [open, toggle];
}
