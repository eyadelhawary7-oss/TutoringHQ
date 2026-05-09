/**
 * One-shot / occasional: fills missing t() keys in messages/en.json and messages/ar.json
 * with humanized English + Arabic placeholder so `npm run i18n:check` passes.
 * Run: npx tsx scripts/i18n-backfill-stubs.ts
 */
import fs from 'fs';
import path from 'path';
import ts from 'typescript';

function flattenKeys(obj: unknown, prefix = ''): Set<string> {
  const out = new Set<string>();
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    if (prefix) out.add(prefix);
    return out;
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      for (const x of flattenKeys(v, p)) out.add(x);
    } else {
      out.add(p);
    }
  }
  return out;
}

function collectTranslatorNamespaces(sourceFile: ts.SourceFile): Map<string, string> {
  const map = new Map<string, string>();
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isCallExpression(node.initializer)) {
      const call = node.initializer;
      if (
        ts.isIdentifier(call.expression) &&
        call.expression.text === 'useTranslations' &&
        call.arguments.length >= 1
      ) {
        const a0 = call.arguments[0];
        if (ts.isStringLiteral(a0) || ts.isNoSubstitutionTemplateLiteral(a0)) {
          const ns = a0.text;
          if (ts.isIdentifier(node.name)) {
            map.set(node.name.text, ns);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return map;
}

function collectResolvedTCalls(sourceFile: ts.SourceFile, namespaces: Map<string, string>): string[] {
  const keys: string[] = [];
  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      namespaces.has(node.expression.text) &&
      node.arguments.length >= 1
    ) {
      const ns = namespaces.get(node.expression.text)!;
      const arg0 = node.arguments[0];
      if (ts.isStringLiteral(arg0) || ts.isNoSubstitutionTemplateLiteral(arg0)) {
        keys.push(`${ns}.${arg0.text}`);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return keys;
}

function walkTsFiles(dir: string, out: string[]) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === '.next') continue;
      walkTsFiles(full, out);
    } else if (/\.(tsx|ts)$/.test(ent.name)) {
      out.push(full);
    }
  }
}

function setDeep(obj: Record<string, unknown>, dotted: string, value: string) {
  const parts = dotted.split('.');
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    const next = cur[p];
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      cur[p] = {};
    }
    cur = cur[p] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
}

function humanizeKey(dotted: string): string {
  const leaf = dotted.split('.').pop() ?? dotted;
  const spaced = leaf
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function main() {
  const root = path.resolve(process.cwd());
  const enPath = path.join(root, 'messages', 'en.json');
  const arPath = path.join(root, 'messages', 'ar.json');
  const en = JSON.parse(fs.readFileSync(enPath, 'utf8')) as Record<string, unknown>;
  const ar = JSON.parse(fs.readFileSync(arPath, 'utf8')) as Record<string, unknown>;
  const enKeys = flattenKeys(en);
  const arKeys = flattenKeys(ar);

  const srcRoot = path.join(root, 'src');
  const files: string[] = [];
  walkTsFiles(srcRoot, files);

  const used = new Set<string>();
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    const sf = ts.createSourceFile(
      file,
      src,
      ts.ScriptTarget.Latest,
      true,
      /\.tsx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const nsMap = collectTranslatorNamespaces(sf);
    for (const k of collectResolvedTCalls(sf, nsMap)) {
      used.add(k);
    }
  }

  let added = 0;
  for (const k of used) {
    const base = humanizeKey(k);
    const enVal = `${base} [TODO: AR review]`;
    const arVal = `${base} — TODO: ترجمة`;
    if (!enKeys.has(k)) {
      setDeep(en, k, enVal);
      added++;
    }
    if (!arKeys.has(k)) {
      setDeep(ar, k, arVal);
      added++;
    }
  }

  fs.writeFileSync(enPath, JSON.stringify(en, null, 2) + '\n', 'utf8');
  fs.writeFileSync(arPath, JSON.stringify(ar, null, 2) + '\n', 'utf8');
  console.log(`[i18n-backfill] Updated keys (writes): ${added}. Re-run npm run i18n:check.`);
}

main();
