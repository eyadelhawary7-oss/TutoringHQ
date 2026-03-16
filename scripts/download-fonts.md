# Local Font Setup

Fonts are copied from `@fontsource` packages on build. To use manually downloaded fonts instead, place woff2 files in `public/fonts/` with the exact filenames below (they will override the copied files on next build).

## Quick setup (uses @fontsource)

```bash
npm run setup-fonts
```

This copies Cairo and JetBrains Mono from `node_modules` to `public/fonts/`. The build runs this automatically.

## Manual download

## Cairo

- **Source:** https://fonts.google.com/specimen/Cairo
- **Download:** Click "Download family" to get the zip
- **Extract** and convert/copy the following as woff2 into `public/fonts/`:
  - `Cairo-Regular.woff2` (weight 400)
  - `Cairo-Medium.woff2` (weight 500)
  - `Cairo-SemiBold.woff2` (weight 600)
  - `Cairo-Bold.woff2` (weight 700)

> Google Fonts typically provides ttf/otf. Use a tool like [transfonter.org](https://transfonter.org) or [fonttools](https://github.com/fonttools/fonttools) to convert to woff2 if needed.

## JetBrains Mono

- **Source:** https://www.jetbrains.com/lp/mono/
- **Download:** Get the zip from the download link
- **Extract** and copy these woff2 files into `public/fonts/`:
  - `JetBrainsMono-Regular.woff2` (weight 400)
  - `JetBrainsMono-Medium.woff2` (weight 500)

> The JetBrains Mono zip usually includes a `fonts/webfonts/` or similar folder with woff2 files. Rename to match exactly if needed.

## Required filenames

```
public/fonts/
├── Cairo-Regular.woff2
├── Cairo-Medium.woff2
├── Cairo-SemiBold.woff2
├── Cairo-Bold.woff2
├── JetBrainsMono-Regular.woff2
└── JetBrainsMono-Medium.woff2
```
