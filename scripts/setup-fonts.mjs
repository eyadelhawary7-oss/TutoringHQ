#!/usr/bin/env node
/**
 * Copies font files from @fontsource packages to public/fonts/ with the names
 * expected by the app. Run before build if fonts are missing.
 * Alternative: manually download from Google Fonts / JetBrains and place in public/fonts/
 */

import { copyFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const fontsDir = join(root, 'public', 'fonts');

const mappings = [
  {
    src: join(root, 'node_modules', '@fontsource', 'cairo', 'files', 'cairo-arabic-400-normal.woff2'),
    dest: join(fontsDir, 'Cairo-Regular.woff2'),
  },
  {
    src: join(root, 'node_modules', '@fontsource', 'cairo', 'files', 'cairo-arabic-500-normal.woff2'),
    dest: join(fontsDir, 'Cairo-Medium.woff2'),
  },
  {
    src: join(root, 'node_modules', '@fontsource', 'cairo', 'files', 'cairo-arabic-600-normal.woff2'),
    dest: join(fontsDir, 'Cairo-SemiBold.woff2'),
  },
  {
    src: join(root, 'node_modules', '@fontsource', 'cairo', 'files', 'cairo-arabic-700-normal.woff2'),
    dest: join(fontsDir, 'Cairo-Bold.woff2'),
  },
  {
    src: join(root, 'node_modules', '@fontsource', 'jetbrains-mono', 'files', 'jetbrains-mono-latin-400-normal.woff2'),
    dest: join(fontsDir, 'JetBrainsMono-Regular.woff2'),
  },
  {
    src: join(root, 'node_modules', '@fontsource', 'jetbrains-mono', 'files', 'jetbrains-mono-latin-500-normal.woff2'),
    dest: join(fontsDir, 'JetBrainsMono-Medium.woff2'),
  },
];

mkdirSync(fontsDir, { recursive: true });

for (const { src, dest } of mappings) {
  if (existsSync(dest)) {
    continue; // Preserve manually placed fonts
  }
  if (existsSync(src)) {
    copyFileSync(src, dest);
    console.log(`[setup-fonts] Copied ${src.split(/[/\\]/).pop()} -> ${dest.split(/[/\\]/).pop()}`);
  } else {
    console.warn(`[setup-fonts] Source not found: ${src}`);
    process.exitCode = 1;
  }
}
