/**
 * Verifies t('key') calls resolve against messages/en.json + messages/ar.json.
 * Resolves namespaces from `const t = useTranslations('namespace')` in the same file.
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

/** Map translator identifier -> namespace string from useTranslations('ns'). */
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

function main() {
  const root = path.resolve(process.cwd());
  const enPath = path.join(root, 'messages', 'en.json');
  const arPath = path.join(root, 'messages', 'ar.json');
  const en = JSON.parse(fs.readFileSync(enPath, 'utf8'));
  const ar = JSON.parse(fs.readFileSync(arPath, 'utf8'));
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

  const missingEn: string[] = [];
  const missingAr: string[] = [];
  for (const k of used) {
    if (!enKeys.has(k)) missingEn.push(k);
    if (!arKeys.has(k)) missingAr.push(k);
  }

  if (missingEn.length || missingAr.length) {
    console.error('[i18n:check] Missing keys in en:', missingEn.sort().join(', ') || '(none)');
    console.error('[i18n:check] Missing keys in ar:', missingAr.sort().join(', ') || '(none)');
    process.exit(1);
  }
  console.log(`[i18n:check] OK (${used.size} resolved t() keys)`);
}

main();
