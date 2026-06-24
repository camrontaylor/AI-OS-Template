#!/usr/bin/env node
// figma-export.mjs - export Figma frames to PNG/JPG/SVG/PDF via the REST API.
// Batches all node IDs into one /v1/images call (the API supports it and the
// rate limits are punishing if you do not), downloads the temporary URLs, and
// saves files with predictable names.
//
// Docs: https://www.figma.com/developers/api#get-images-endpoint
//
// Usage:
//   FIGMA_TOKEN=figd_... node figma-export.mjs \
//     --file-key abc123 \
//     --ids 12:34,12:56,12:78 \
//     --format png --scale 2 --out ./images
//
//   With JSON input (one row per export, fields: id, name, scale, format):
//     FIGMA_TOKEN=figd_... node figma-export.mjs \
//       --file-key abc123 --input nodes.json --out ./images
//
// Notes:
//   * The Figma image URLs returned are temporary S3 links. They are valid
//     for about 30 days. Download them right away.
//   * Free / Starter files are throttled to ~6 image renders per month total,
//     no matter the token. A paid Full or Dev seat is required for real batch
//     volume. Plan accordingly.
//   * On HTTP 429, this script honours the Retry-After header and retries
//     once, then surfaces the error.

import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const flag = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def }

const TOKEN = process.env.FIGMA_TOKEN
if (!TOKEN) {
  console.error('FIGMA_TOKEN is not set. Create one at Figma -> Settings -> Personal access tokens (scope: file_content:read).')
  process.exit(1)
}

const fileKey = flag('file-key', process.env.FIGMA_FILE_KEY)
if (!fileKey) {
  console.error('Pass --file-key or set FIGMA_FILE_KEY. Read it from the Figma URL: figma.com/:type/:file_key/...')
  process.exit(1)
}

const outDir = flag('out', './images')
fs.mkdirSync(outDir, { recursive: true })

const format = (flag('format', 'png') || 'png').toLowerCase()
if (!['png', 'jpg', 'svg', 'pdf'].includes(format)) {
  console.error(`Unsupported --format ${format}. Use png | jpg | svg | pdf.`)
  process.exit(1)
}

const scale = Number(flag('scale', '2'))
if (!(scale >= 0.01 && scale <= 4)) {
  console.error('--scale must be between 0.01 and 4.')
  process.exit(1)
}

// Build the work list. Either --ids (comma-separated) or --input pointing at a
// JSON array of {id, name?, scale?, format?} rows. The JSON path is the one to
// use for batch ad runs because it lets you name each output file.
let rows = []
const inputFile = flag('input')
if (inputFile) {
  const raw = JSON.parse(fs.readFileSync(inputFile, 'utf8'))
  if (!Array.isArray(raw)) { console.error('--input JSON must be an array.'); process.exit(1) }
  rows = raw.map(r => ({ id: String(r.id), name: r.name || String(r.id).replace(/[:/]/g, '_'), scale: r.scale ?? scale, format: r.format || format }))
} else if (flag('ids')) {
  rows = flag('ids').split(',').map(id => ({ id: id.trim(), name: id.trim().replace(/[:/]/g, '_'), scale, format }))
}
if (!rows.length) {
  console.error('Pass --ids id1,id2,id3 or --input nodes.json.')
  process.exit(1)
}

// One /v1/images call per (scale, format) bucket. That keeps requests under
// the rate limit. In practice an ad batch uses a small number of buckets.
const buckets = new Map()
for (const r of rows) {
  const key = `${r.format}|${r.scale}`
  if (!buckets.has(key)) buckets.set(key, [])
  buckets.get(key).push(r)
}

const headers = { 'X-Figma-Token': TOKEN }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function imagesCall(bucketRows, bucketFormat, bucketScale, attempt = 1) {
  const ids = bucketRows.map(r => r.id).join(',')
  const url = `https://api.figma.com/v1/images/${fileKey}?ids=${encodeURIComponent(ids)}&format=${bucketFormat}&scale=${bucketScale}`
  const res = await fetch(url, { headers })
  if (res.status === 429 && attempt === 1) {
    const wait = Number(res.headers.get('retry-after') || '30') * 1000
    console.warn(`429 from Figma, waiting ${wait}ms before one retry`)
    await sleep(wait)
    return imagesCall(bucketRows, bucketFormat, bucketScale, 2)
  }
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Figma /v1/images failed ${res.status}: ${body.slice(0, 500)}`)
  }
  const json = await res.json()
  if (json.err) throw new Error(`Figma returned error: ${json.err}`)
  return json.images || {}
}

async function downloadOne(url, dest) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`download failed ${r.status} for ${dest}`)
  const buf = Buffer.from(await r.arrayBuffer())
  fs.writeFileSync(dest, buf)
}

async function main() {
  let saved = 0
  let missing = 0
  for (const [key, bucketRows] of buckets.entries()) {
    const [bucketFormat, bucketScaleStr] = key.split('|')
    const bucketScale = Number(bucketScaleStr)
    console.log(`Requesting ${bucketRows.length} node(s) as ${bucketFormat} @ ${bucketScale}x`)
    const imgs = await imagesCall(bucketRows, bucketFormat, bucketScale)
    for (const r of bucketRows) {
      const link = imgs[r.id]
      if (!link) { console.warn(`  [skip] no URL returned for ${r.id}`); missing++; continue }
      const file = path.join(outDir, `${r.name}.${bucketFormat}`)
      await downloadOne(link, file)
      console.log(`  saved ${file}`)
      saved++
    }
  }
  console.log(`\nDone. saved=${saved} missing=${missing} out=${outDir}`)
  if (missing > 0) process.exit(2)
}

main().catch(err => { console.error(err.message); process.exit(1) })
