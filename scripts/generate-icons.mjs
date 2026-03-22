import sharp from 'sharp'
import { writeFileSync } from 'fs'

async function generateIcon(size) {
  const radius = Math.round(size * 0.2)
  const fontSize = Math.round(size * 0.55)
  const half = size / 2
  const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg"><rect width="${size}" height="${size}" rx="${radius}" fill="#0D9488"/><text x="${half}" y="${half}" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="bold" fill="white" text-anchor="middle" dominant-baseline="central">C</text></svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

async function main() {
  const icons = [
    { name: 'logo-icon-64.png',     size: 64  },
    { name: 'logo-icon-192.png',    size: 192 },
    { name: 'logo-icon-512.png',    size: 512 },
    { name: 'apple-touch-icon.png', size: 180 },
  ]
  for (const { name, size } of icons) {
    const buffer = await generateIcon(size)
    writeFileSync(`public/${name}`, buffer)
    console.log(`Generated public/${name}`)
  }
}

main().catch(console.error)
