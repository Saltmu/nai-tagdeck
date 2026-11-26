import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CSS_DIRS = ['src/styles', 'src/tutorial'] as const;

const HEX_COLOR_RE = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/;
const POINTER_COARSE_RE = /@media[^{]*pointer\s*:\s*coarse[^{]*/g;
const Z_INDEX_VAR_RE = /^var\(--z-[a-z0-9-]+\)$/;
const Z_INDEX_LOCAL_INT_RE = /^(?:[0-9]|10)$/;
const Z_INDEX_KEYWORDS = new Set(['auto', 'inherit', 'initial', 'unset']);

interface CssDeclaration {
  property: string;
  value: string;
  line: number;
  raw: string;
}

interface CssViolation {
  file: string;
  line: number;
  declaration: string;
}

function listCssFiles(): string[] {
  const files: string[] = [];
  for (const dir of CSS_DIRS) {
    const absDir = path.join(ROOT_DIR, dir);
    if (!fs.existsSync(absDir)) continue;
    for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.css')) {
        files.push(`${dir}/${entry.name}`);
      }
    }
  }
  return files.sort();
}

function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\r\n]/g, ' '));
}

function parseCssDeclarations(css: string): CssDeclaration[] {
  const stripped = stripCssComments(css);
  const declarations: CssDeclaration[] = [];

  let line = 1;
  let braceDepth = 0;
  let parenDepth = 0;
  let quote: '"' | "'" | null = null;
  let escaped = false;

  let stmt = '';
  let stmtLine = 1;

  const flushStatement = () => {
    const trimmed = stmt.trim();
    stmt = '';
    if (!trimmed || braceDepth === 0 || trimmed.startsWith('@')) return;

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx <= 0) return;

    const property = trimmed.slice(0, colonIdx).trim().toLowerCase();
    const value = trimmed.slice(colonIdx + 1).trim();
    if (!property || !value) return;

    declarations.push({
      property,
      value,
      line: stmtLine,
      raw: `${property}: ${value}`,
    });
  };

  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i];
    if (ch === undefined) continue;

    if (ch === '\n') {
      line++;
    }

    if (quote) {
      stmt += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      if (!stmt.trim()) stmtLine = line;
      quote = ch;
      stmt += ch;
      continue;
    }

    if (ch === '(') {
      if (!stmt.trim()) stmtLine = line;
      parenDepth++;
      stmt += ch;
      continue;
    }

    if (ch === ')') {
      if (parenDepth > 0) parenDepth--;
      stmt += ch;
      continue;
    }

    if (parenDepth === 0 && ch === '{') {
      braceDepth++;
      stmt = '';
      continue;
    }

    if (parenDepth === 0 && ch === '}') {
      flushStatement();
      if (braceDepth > 0) braceDepth--;
      continue;
    }

    if (parenDepth === 0 && ch === ';') {
      flushStatement();
      continue;
    }

    if (!stmt.trim() && !/\s/.test(ch)) {
      stmtLine = line;
    }
    stmt += ch;
  }

  return declarations;
}

function findHexColorViolations(file: string, css: string): CssViolation[] {
  const violations: CssViolation[] = [];
  for (const decl of parseCssDeclarations(css)) {
    if (HEX_COLOR_RE.test(decl.value)) {
      violations.push({ file, line: decl.line, declaration: decl.raw });
    }
  }
  return violations;
}

function findPointerCoarseViolations(file: string, css: string): CssViolation[] {
  const stripped = stripCssComments(css);
  const violations: CssViolation[] = [];
  for (const match of stripped.matchAll(POINTER_COARSE_RE)) {
    const idx = match.index ?? 0;
    const line = stripped.slice(0, idx).split('\n').length;
    violations.push({ file, line, declaration: match[0].trim() });
  }
  return violations;
}

function findZIndexViolations(file: string, css: string): CssViolation[] {
  const violations: CssViolation[] = [];
  for (const decl of parseCssDeclarations(css)) {
    if (decl.property !== 'z-index') continue;
    const v = decl.value;
    if (Z_INDEX_VAR_RE.test(v) || Z_INDEX_KEYWORDS.has(v) || Z_INDEX_LOCAL_INT_RE.test(v)) {
      continue;
    }
    violations.push({ file, line: decl.line, declaration: decl.raw });
  }
  return violations;
}

function findMatchingBrace(text: string, openBraceIdx: number): number {
  let depth = 0;
  let quote: '"' | "'" | null = null;
  let escaped = false;
  for (let i = openBraceIdx; i < text.length; i++) {
    const ch = text[i];
    if (ch === undefined) continue;
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function extractBlockDeclarations(blockBody: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const decl of parseCssDeclarations(`.scope { ${blockBody} }`)) {
    result[decl.property] = decl.value;
  }
  return result;
}

function extractDarkThemeBlocks(css: string): {
  mediaDark: Record<string, string> | null;
  explicitDark: Record<string, string> | null;
} {
  const stripped = stripCssComments(css);

  let mediaDark: Record<string, string> | null = null;
  const mediaMatch = /@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)\s*\{/.exec(stripped);
  if (mediaMatch) {
    const mediaOpen = mediaMatch.index + mediaMatch[0].length - 1;
    const mediaClose = findMatchingBrace(stripped, mediaOpen);
    if (mediaClose !== -1) {
      const mediaInner = stripped.slice(mediaOpen + 1, mediaClose);
      const innerMatch = /:root:not\(\s*\[data-theme\s*=\s*['"]light['"]\]\s*\)\s*\{/.exec(mediaInner);
      if (innerMatch) {
        const innerOpen = innerMatch.index + innerMatch[0].length - 1;
        const innerClose = findMatchingBrace(mediaInner, innerOpen);
        if (innerClose !== -1) {
          mediaDark = extractBlockDeclarations(mediaInner.slice(innerOpen + 1, innerClose));
        }
      }
    }
  }

  let explicitDark: Record<string, string> | null = null;
  const explicitMatch = /:root\[data-theme\s*=\s*['"]dark['"]\]\s*\{/.exec(stripped);
  if (explicitMatch) {
    const open = explicitMatch.index + explicitMatch[0].length - 1;
    const close = findMatchingBrace(stripped, open);
    if (close !== -1) {
      explicitDark = extractBlockDeclarations(stripped.slice(open + 1, close));
    }
  }

  return { mediaDark, explicitDark };
}

function formatViolations(violations: CssViolation[]): string {
  return violations.map((v) => `${v.file}:${v.line}: ${v.declaration}`).join('\n');
}

describe('デザインガイド規約チェック', () => {
  const cssFiles = listCssFiles();

  it('検査対象の CSS ファイルが 1 件以上見つかる', () => {
    expect(cssFiles).toContain('src/styles/tokens.css');
    expect(cssFiles).toContain('src/styles/touch.css');
    expect(cssFiles).toContain('src/tutorial/tutorial.css');
  });

  it('tokens.css 以外の CSS に #hex カラーが直書きされていない', () => {
    const violations = cssFiles
      .filter((file) => file !== 'src/styles/tokens.css')
      .flatMap((file) => findHexColorViolations(file, fs.readFileSync(path.join(ROOT_DIR, file), 'utf8')));

    expect(violations, formatViolations(violations)).toEqual([]);
  });

  it('tokens.css のダークモード 2 ブロックが存在し、宣言が完全一致する', () => {
    const tokensCss = fs.readFileSync(path.join(ROOT_DIR, 'src/styles/tokens.css'), 'utf8');
    const { mediaDark, explicitDark } = extractDarkThemeBlocks(tokensCss);

    expect(mediaDark).not.toBeNull();
    expect(explicitDark).not.toBeNull();
    expect(Object.keys(mediaDark ?? {}).length).toBeGreaterThan(0);
    expect(mediaDark).toEqual(explicitDark);
  });

  it('@media (pointer: coarse) が touch.css 以外に存在しない', () => {
    const violations = cssFiles
      .filter((file) => file !== 'src/styles/touch.css')
      .flatMap((file) => findPointerCoarseViolations(file, fs.readFileSync(path.join(ROOT_DIR, file), 'utf8')));

    expect(violations, formatViolations(violations)).toEqual([]);
  });

  it('tokens.css 以外の CSS に場当たり的な大きい z-index が使われていない', () => {
    const violations = cssFiles
      .filter((file) => file !== 'src/styles/tokens.css')
      .flatMap((file) => findZIndexViolations(file, fs.readFileSync(path.join(ROOT_DIR, file), 'utf8')));

    expect(violations, formatViolations(violations)).toEqual([]);
  });
});

describe('デザインガイド規約チェッカーのヘルパー単体検証', () => {
  it('ID セレクタ #root やコメント内の #fff を誤検知せず、値側の #hex は行番号付きで検知する', () => {
    const sample = [
      '/* コメント内の #ffffff や #12345678 は無視 */',
      '#root {',
      '  color: var(--text);',
      '}',
      '.bad {',
      '  border-color: #abc;',
      '  background: #112233;',
      '}',
    ].join('\n');

    expect(findHexColorViolations('sample.css', sample)).toEqual([
      { file: 'sample.css', line: 6, declaration: 'border-color: #abc' },
      { file: 'sample.css', line: 7, declaration: 'background: #112233' },
    ]);
  });

  it('コメント内の pointer: coarse を無視し、実コードの記述を検知する', () => {
    const sample = [
      '/* @media (pointer: coarse) { .a { min-height: 44px; } } */',
      '@media (pointer: coarse) {',
      '  .b { min-height: 44px; }',
      '}',
    ].join('\n');

    expect(findPointerCoarseViolations('sample.css', sample)).toEqual([
      { file: 'sample.css', line: 2, declaration: '@media (pointer: coarse)' },
    ]);
  });

  it('z-index の許可値と違反値（11 以上・負値・未定義トークン）を正しく判別する', () => {
    const sample = [
      '.ok { z-index: var(--z-header); }',
      '.ok-local { z-index: 10; }',
      '.ok-kw { z-index: auto; }',
      '.ng-high { z-index: 9999; }',
      '.ng-eleven { z-index: 11; }',
      '.ng-neg { z-index: -1; }',
      '.ng-var { z-index: var(--custom); }',
    ].join('\n');

    expect(findZIndexViolations('sample.css', sample)).toEqual([
      { file: 'sample.css', line: 4, declaration: 'z-index: 9999' },
      { file: 'sample.css', line: 5, declaration: 'z-index: 11' },
      { file: 'sample.css', line: 6, declaration: 'z-index: -1' },
      { file: 'sample.css', line: 7, declaration: 'z-index: var(--custom)' },
    ]);
  });

  it('ダークモード 2 ブロックの差分や欠落を検知できる', () => {
    const mismatched = [
      '@media (prefers-color-scheme: dark) {',
      "  :root:not([data-theme='light']) {",
      '    --bg: #12141a;',
      '    color-scheme: dark;',
      '  }',
      '}',
      ":root[data-theme='dark'] {",
      '  --bg: #000000;',
      '  color-scheme: dark;',
      '}',
    ].join('\n');

    const { mediaDark, explicitDark } = extractDarkThemeBlocks(mismatched);
    expect(mediaDark).not.toEqual(explicitDark);
  });
});
