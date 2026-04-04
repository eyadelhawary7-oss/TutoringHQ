import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

// ── 1. Collect all source files ───────────────────
function walkDir(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (['node_modules', '.next', 'dist', '.git'].includes(entry)) continue
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) walkDir(full, files)
    else if (/\.(tsx?|jsx?)$/.test(entry)) files.push(full)
  }
  return files
}

const srcFiles = walkDir('src')

// ── 2. Extract all t('key') and t("key") calls ────
// Handles: t('a.b.c'), t("a.b.c"), t('a.b', {n}),
//          useTranslations('ns') then t('key')
const keySet = new Set()
const nsMap = {} // file → namespace from useTranslations('ns')

for (const file of srcFiles) {
  const src = readFileSync(file, 'utf8')

  // Extract namespace declarations
  const nsMatches = [
    ...src.matchAll(
      /(?:useTranslations|getTranslations)\(\s*['"]([^'"]+)['"]\s*\)/g,
    ),
  ]
  const namespaces = nsMatches.map((m) => m[1])
  nsMap[file] = namespaces

  // Extract bare t('key') calls
  const tMatches = [...src.matchAll(/\bt\(['"]([^'"]+)['"]/g)]

  for (const m of tMatches) {
    const key = m[1]
    // If key contains a dot it's already namespaced
    if (key.includes('.')) {
      keySet.add(key)
    } else {
      // Prefix with each namespace found in the file
      for (const ns of namespaces) {
        keySet.add(`${ns}.${key}`)
      }
      // Bare key only when no namespace (global messages root)
      if (namespaces.length === 0) keySet.add(key)
    }
  }
}

// ── 3. Flatten JSON to dot-notation ───────────────
function flatten(obj, prefix = '') {
  const out = {}
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(out, flatten(v, key))
    } else {
      out[key] = v
    }
  }
  return out
}

const enJson = JSON.parse(readFileSync('messages/en.json', 'utf8'))
const arJson = JSON.parse(readFileSync('messages/ar.json', 'utf8'))
const enFlat = flatten(enJson)
const arFlat = flatten(arJson)

// ── 4. Find missing keys ───────────────────────────
const missingFromEn = []
const missingFromAr = []
const missingFromBoth = []

for (const key of keySet) {
  const inEn = key in enFlat
  const inAr = key in arFlat
  if (!inEn && !inAr) missingFromBoth.push(key)
  else if (!inEn) missingFromEn.push(key)
  else if (!inAr) missingFromAr.push(key)
}

console.log('\n═══ MISSING FROM BOTH JSON FILES ═══')
missingFromBoth.sort().forEach((k) => console.log(' ', k))
console.log(`\nTotal missing from both: ${missingFromBoth.length}`)

console.log('\n═══ MISSING FROM en.json ONLY ═══')
missingFromEn.sort().forEach((k) => console.log(' ', k))
console.log(`\nTotal missing from en.json: ${missingFromEn.length}`)

console.log('\n═══ MISSING FROM ar.json ONLY ═══')
missingFromAr.sort().forEach((k) => console.log(' ', k))
console.log(`\nTotal missing from ar.json: ${missingFromAr.length}`)

console.log('\n═══ SUMMARY ═══')
console.log(`Source files scanned: ${srcFiles.length}`)
console.log(`Unique keys found in code: ${keySet.size}`)
console.log(`Keys present in en.json: ${Object.keys(enFlat).length}`)
console.log(`Keys present in ar.json: ${Object.keys(arFlat).length}`)
