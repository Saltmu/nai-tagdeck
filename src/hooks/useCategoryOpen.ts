import { useState } from 'react';
import type { CategoryKey, TargetId } from '../types';
import { loadCategoryOpen, saveCategoryOpen } from '../lib/categoryOpen';

export function useCategoryOpen(target: TargetId, category: CategoryKey): [boolean, () => void] {
  const key = JSON.stringify([target, category]);
  const [state, setState] = useState(() => ({ key, open: loadCategoryOpen(target, category) }));
  const open = state.key === key ? state.open : loadCategoryOpen(target, category);

  const toggle = () => {
    const next = !open;
    saveCategoryOpen(target, category, next);
    setState({ key, open: next });
  };

  return [open, toggle];
}
