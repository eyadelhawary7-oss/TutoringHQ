/**
 * Verifies resolved t('key') calls against messages/en.json and messages/ar.json.
 * Resolves namespaces from useTranslations / await getTranslations in the same file.
 *
 * Default (strict): fail if any resolved key is missing in en or ar, or if en/ar key trees differ.
 *   npm run i18n:check
 * Legacy (parity relaxed; still enforces used keys exist in both locales):
 *   npx tsx scripts/check-i18n.ts --legacy
 *   npx tsx scripts/check-i18n.ts --soft
 * Write a full report (missing, parity, orphan estimate) to tmp/i18n-audit.txt:
 *   npx tsx scripts/check-i18n.ts --audit
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

function extractNamespaceFromIntlCall(call: ts.CallExpression): string | null {
  if (call.arguments.length < 1) return null;
  const a0 = call.arguments[0];
  if (ts.isStringLiteral(a0) || ts.isNoSubstitutionTemplateLiteral(a0)) {
    return a0.text;
  }
  if (ts.isObjectLiteralExpression(a0)) {
    for (const prop of a0.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      let key = '';
      if (ts.isIdentifier(prop.name)) key = prop.name.text;
      else if (ts.isStringLiteral(prop.name)) key = prop.name.text;
      if (key === 'namespace' && (ts.isStringLiteral(prop.initializer) || ts.isNoSubstitutionTemplateLiteral(prop.initializer))) {
        return prop.initializer.text;
      }
    }
  }
  return null;
}

/** Map translator identifier -> namespace from useTranslations / getTranslations. */
function collectTranslatorNamespaces(sourceFile: ts.SourceFile): Map<string, string> {
  const map = new Map<string, string>();

  function bindFromCall(call: ts.CallExpression, varName: string) {
    if (!ts.isIdentifier(call.expression)) return;
    const fn = call.expression.text;
    if (fn !== 'useTranslations' && fn !== 'getTranslations') return;
    const ns = extractNamespaceFromIntlCall(call);
    if (ns) map.set(varName, ns);
  }

  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const init = node.initializer;
      if (ts.isCallExpression(init)) {
        bindFromCall(init, node.name.text);
      } else if (ts.isAwaitExpression(init) && ts.isCallExpression(init.expression)) {
        bindFromCall(init.expression, node.name.text);
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

function parseArgs(argv: string[]) {
  const legacy = argv.includes('--legacy') || argv.includes('--soft');
  const audit = argv.includes('--audit');
  return { legacy, audit };
}

function main() {
  const root = path.resolve(process.cwd());
  const { legacy, audit } = parseArgs(process.argv.slice(2));

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

  const missingEn = [...used].filter((k) => !enKeys.has(k)).sort();
  const missingAr = [...used].filter((k) => !arKeys.has(k)).sort();
  const onlyEn = [...enKeys].filter((k) => !arKeys.has(k)).sort();
  const onlyAr = [...arKeys].filter((k) => !enKeys.has(k)).sort();
  const orphansBoth = [...enKeys].filter((k) => arKeys.has(k) && !used.has(k)).sort();

  if (audit) {
    const outPath = path.join(root, 'tmp', 'i18n-audit.txt');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const lines: string[] = [];
    lines.push(`=== i18n audit ${new Date().toISOString()} ===`);
    lines.push(`strict parity: ${!legacy}`);
    lines.push(`en keys: ${enKeys.size}  ar keys: ${arKeys.size}  resolved t() keys: ${used.size}`);
    lines.push('');
    lines.push(`--- Missing in en (${missingEn.length}) ---`);
    missingEn.forEach((k) => lines.push(k));
    lines.push('');
    lines.push(`--- Missing in ar (${missingAr.length}) ---`);
    missingAr.forEach((k) => lines.push(k));
    lines.push('');
    lines.push(`--- Only in en.json (${onlyEn.length}) ---`);
    onlyEn.forEach((k) => lines.push(k));
    lines.push('');
    lines.push(`--- Only in ar.json (${onlyAr.length}) ---`);
    onlyAr.forEach((k) => lines.push(k));
    lines.push('');
    lines.push(
      `--- Orphans (present in both JSON files, not resolved by static t() scan; may include dynamic keys) (${orphansBoth.length}) ---`,
    );
    orphansBoth.slice(0, 500).forEach((k) => lines.push(k));
    if (orphansBoth.length > 500) {
      lines.push(`... (${orphansBoth.length - 500} more omitted)`);
    }
    fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
    console.log(`[i18n:check] Wrote audit: ${outPath}`);
  }

  let failed = false;

  if (missingEn.length || missingAr.length) {
    console.error('[i18n:check] Missing keys in en:', missingEn.join('\n') || '(none)');
    console.error('[i18n:check] Missing keys in ar:', missingAr.join('\n') || '(none)');
    failed = true;
  }

  if (!legacy && (onlyEn.length || onlyAr.length)) {
    console.error('[i18n:check] Keys present in en.json but missing in ar.json:', onlyEn.join('\n') || '(none)');
    console.error('[i18n:check] Keys present in ar.json but missing in en.json:', onlyAr.join('\n') || '(none)');
    failed = true;
  }

  if (failed) {
    if (!audit) {
      const hint =
        '[i18n:check] Run with --audit to write tmp/i18n-audit.txt, or --legacy to skip en/ar parity (not recommended).';
      console.error(hint);
    }
    process.exit(1);
  }

  console.log(`[i18n:check] OK (${used.size} resolved t() keys, en/ar parity: ${!legacy ? 'checked' : 'skipped (legacy)'})`);
}

main();
