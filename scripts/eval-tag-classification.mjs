import { createServer } from 'vite';

const server = await createServer({
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true, hmr: false },
});

try {
  const { CHARACTER_CATEGORY_KEYS, PROMPT_CATEGORY_KEYS, categoryLabel } = await server.ssrLoadModule('/src/lib/categories.ts');
  const { sampleDictionary } = await server.ssrLoadModule('/src/lib/sampleDictionary.ts');
  const {
    VECTOR_MIN_MARGIN,
    VECTOR_MIN_SCORE,
    VECTOR_TOP_K,
    createTagVectorIndex,
    predictTagCategory,
  } = await server.ssrLoadModule('/src/lib/tagClassification.ts');
  const { evaluateTagVectorClassification } = await server.ssrLoadModule('/src/lib/tagClassificationEval.ts');

  const entries = sampleDictionary();
  const base = evaluateTagVectorClassification(entries, PROMPT_CATEGORY_KEYS);
  const character = evaluateTagVectorClassification(entries, CHARACTER_CATEGORY_KEYS);

  const fmtPct = (v) => `${(v * 100).toFixed(1)}%`;

  console.log('# 単語ベクトル分類 Leave-One-Out 評価結果');
  console.log('');
  console.log(`設定: topK=${VECTOR_TOP_K}, minScore=${VECTOR_MIN_SCORE}, minMargin=${VECTOR_MIN_MARGIN}`);
  console.log('');
  console.log('| 対象 | 件数 | 正解 | 誤分類 | 未分類 | 分類した分の正解率 |');
  console.log('| --- | ---: | ---: | ---: | ---: | ---: |');
  console.log(`| ベース用 | ${base.total} | ${base.correct} | ${base.wrong} | ${base.unclassified} | ${fmtPct(base.accuracy)} |`);
  console.log(`| キャラ用 | ${character.total} | ${character.correct} | ${character.wrong} | ${character.unclassified} | ${fmtPct(character.accuracy)} |`);

  const index = createTagVectorIndex(entries);
  console.log('');
  console.log('## 未登録タグの確認');
  for (const probe of ['asymmetrical bomber jacket', 'rain soaked alley', 'completely unknown xyzzy']) {
    const basePred = predictTagCategory(probe, index, PROMPT_CATEGORY_KEYS);
    const charPred = predictTagCategory(probe, index, CHARACTER_CATEGORY_KEYS);
    const fmtPred = (pred) => (pred ? `${categoryLabel(pred.category)} (score=${pred.score.toFixed(3)}, margin=${pred.margin.toFixed(3)})` : '未分類');
    console.log(`- \`${probe}\`: ベース=${fmtPred(basePred)} / キャラ=${fmtPred(charPred)}`);
  }

  const printErrors = (title, list) => {
    console.log('');
    console.log(`## ${title}（${list.length}件）`);
    for (const item of list) {
      console.log(
        `- \`${item.tag}\`: 正解=${categoryLabel(item.expected)} → 推定=${categoryLabel(item.predicted)} (score=${item.score.toFixed(3)}, margin=${item.margin.toFixed(3)})`,
      );
    }
  };

  printErrors('ベース用の誤分類例', base.misclassified);
  printErrors('キャラ用の誤分類例', character.misclassified);
} finally {
  await server.close();
}
