#!/usr/bin/env node
// render-ad.mjs - local deterministic fallback for the Figma engine.
// Renders one HTML template (with Handlebars-style slots) into PNGs at exact
// platform pixel sizes, using node-html-to-image (headless Chromium).
// Same input data plus same template gives the same pixels every time.
//
// Install once:  npm i node-html-to-image
//
// Usage:
//   node render-ad.mjs \
//     --template ./assets/ad-template.html \
//     --rows ./rows.json \
//     --out ./images \
//     --sizes 1080x1080,1080x1350,1080x1920,1200x628
//
// rows.json is an array of objects: each becomes one creative. Common fields
// (the bundled template reads these): name, headline, subhead, cta, image,
// logo, brand_primary, brand_secondary, brand_text, heading_font, body_font.
// Add your own. The template has access to all of them.
//
// One PNG per (row x size). File name: <row.name>_<W>x<H>.png

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

let nodeHtmlToImage
try { nodeHtmlToImage = (await import('node-html-to-image')).default }
catch (e) {
  console.error('node-html-to-image is not installed. Run: npm i node-html-to-image')
  process.exit(1)
}

const args = process.argv.slice(2)
const flag = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d }

const HERE = path.dirname(fileURLToPath(import.meta.url))
const templatePath = flag('template', path.join(HERE, '..', 'assets', 'ad-template.html'))
const rowsPath = flag('rows')
const outDir = flag('out', './images')
const sizesArg = flag('sizes', '1080x1080,1080x1350,1080x1920,1200x628')

if (!rowsPath) { console.error('Pass --rows path/to/rows.json'); process.exit(1) }
if (!fs.existsSync(templatePath)) { console.error(`Template not found: ${templatePath}`); process.exit(1) }

fs.mkdirSync(outDir, { recursive: true })
const template = fs.readFileSync(templatePath, 'utf8')
const rows = JSON.parse(fs.readFileSync(rowsPath, 'utf8'))
if (!Array.isArray(rows)) { console.error('--rows JSON must be an array.'); process.exit(1) }

const sizes = sizesArg.split(',').map(s => {
  const [w, h] = s.trim().split('x').map(Number)
  if (!w || !h) throw new Error(`bad size: ${s}`)
  return { w, h }
})

const slug = (s) => String(s || 'ad').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)

async function renderRow(row) {
  const baseName = slug(row.name || row.headline || 'ad')
  for (const { w, h } of sizes) {
    // Inject the target size as CSS custom properties the template uses to
    // pin the root frame. node-html-to-image fixes the viewport too, so the
    // output is deterministic at the exact pixel count.
    const content = { ...row, __w: w, __h: h }
    const output = path.join(outDir, `${baseName}_${w}x${h}.png`)
    await nodeHtmlToImage({
      output,
      html: template,
      content,
      type: 'png',
      puppeteerArgs: {
        defaultViewport: { width: w, height: h, deviceScaleFactor: 1 },
        args: ['--no-sandbox'],
      },
    })
    console.log(`  saved ${output}`)
  }
}

for (let i = 0; i < rows.length; i++) {
  console.log(`row ${i + 1}/${rows.length} (${rows[i].name || rows[i].headline || 'unnamed'})`)
  await renderRow(rows[i])
}
console.log(`\nDone. rendered ${rows.length} rows x ${sizes.length} sizes = ${rows.length * sizes.length} files in ${outDir}`)
