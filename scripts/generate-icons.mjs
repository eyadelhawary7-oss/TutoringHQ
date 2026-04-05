import { writeFileSync, mkdirSync } from 'fs';

mkdirSync('public/icons', { recursive: true });

const svg192 = `<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192" viewBox="0 0 192 192">
  <rect width="192" height="192" rx="40" fill="#0D9488"/>
  <text x="96" y="116" text-anchor="middle" font-family="Arial" font-size="72" font-weight="bold" fill="white">CH</text>
</svg>`;

const svg512 = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="100" fill="#0D9488"/>
  <text x="256" y="310" text-anchor="middle" font-family="Arial" font-size="192" font-weight="bold" fill="white">CH</text>
</svg>`;

writeFileSync('public/icons/icon-192.svg', svg192);
writeFileSync('public/icons/icon-512.svg', svg512);
writeFileSync('public/icons/icon-192.png', svg192);
writeFileSync('public/icons/icon-512.png', svg512);
console.log('Icons generated ✓');
