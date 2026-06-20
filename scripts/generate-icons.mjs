import { writeFileSync, mkdirSync } from 'fs';
import sharp from 'sharp';

mkdirSync('public/icons', { recursive: true });

// Neutral solid brand-color placeholder icons (no wordmark, no letter mark).
const TEAL = { r: 13, g: 148, b: 136, alpha: 1 }; // #0D9488

const svg = (size) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">\n  <rect width="${size}" height="${size}" fill="#0D9488"/>\n</svg>\n`;

const solidPng = (size) =>
  sharp({ create: { width: size, height: size, channels: 4, background: TEAL } }).png().toBuffer();

writeFileSync('public/icons/icon-192.svg', svg(192));
writeFileSync('public/icons/icon-512.svg', svg(512));
writeFileSync('public/icons/icon.svg', svg(512));
writeFileSync('public/icons/icon-192.png', await solidPng(192));
writeFileSync('public/icons/icon-512.png', await solidPng(512));
writeFileSync('public/icons/icon-512-maskable.png', await solidPng(512));
console.log('Icons generated ✓');
