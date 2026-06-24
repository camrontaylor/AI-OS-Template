#!/usr/bin/env node
// falgen.mjs - submit a job to the fal.ai queue and download the resulting images.
// No SDK needed; uses the REST queue and Node 18+ global fetch.
// Docs: https://docs.fal.ai/model-apis/model-endpoints/queue
//
// Usage:
//   FAL_KEY=... node falgen.mjs --model fal-ai/flux/dev/image-to-image --input req.json --out ./images
//   FAL_KEY=... node falgen.mjs --model fal-ai/flux/dev --prompt "..." --seed 123 --image-size square_hd --out ./images
//   (repeat --image-url to pass several reference images; one becomes image_url, many become image_urls)

import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const flag = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def }
const flags = (name) => { const out = []; args.forEach((a, i) => { if (a === '--' + name) out.push(args[i + 1]) }); return out }

const KEY = process.env.FAL_KEY
if (!KEY) { console.error('FAL_KEY is not set. Get one at https://fal.ai/dashboard'); process.exit(1) }

const model = flag('model')
if (!model) { console.error('Pass --model, for example fal-ai/flux/dev/image-to-image'); process.exit(1) }

const outDir = flag('out', './images')
fs.mkdirSync(outDir, { recursive: true })

let input
const inputFile = flag('input')
if (inputFile) {
  input = JSON.parse(fs.readFileSync(inputFile, 'utf8'))
} else {
  input = {}
  if (flag('prompt')) input.prompt = flag('prompt')
  const refs = flags('image-url')
  if (refs.length === 1) input.image_url = refs[0]
  if (refs.length > 1) input.image_urls = refs
  if (flag('strength')) input.strength = Number(flag('strength'))
  if (flag('seed')) input.seed = Number(flag('seed'))
  if (flag('num-images')) input.num_images = Number(flag('num-images'))
  if (flag('image-size')) input.image_size = flag('image-size')
  if (flag('aspect-ratio')) input.aspect_ratio = flag('aspect-ratio')
  input.output_format = flag('output-format', 'png')
}

const base = 'https://queue.fal.run/' + model
const headers = { Authorization: 'Key ' + KEY, 'Content-Type': 'application/json' }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const sub = await fetch(base, { method: 'POST', headers, body: JSON.stringify(input) })
  if (!sub.ok) { console.error('Submit failed', sub.status, await sub.text()); process.exit(1) }
  const { request_id } = await sub.json()
  console.log('Submitted', request_id)

  let result
  for (let i = 0; i < 150; i++) {
    await sleep(2000)
    const st = await fetch(`${base}/requests/${request_id}/status`, { headers })
    const sj = await st.json()
    if (sj.status === 'COMPLETED') {
      const res = await fetch(`${base}/requests/${request_id}`, { headers })
      result = await res.json()
      break
    }
    if (sj.status === 'FAILED' || sj.status === 'ERROR') { console.error('\nJob failed', JSON.stringify(sj)); process.exit(1) }
    process.stdout.write('.')
  }
  if (!result) { console.error('\nTimed out waiting for result'); process.exit(1) }

  const images = result.images || (result.image ? [result.image] : [])
  if (!images.length) { console.log('\nNo images in result:', JSON.stringify(result).slice(0, 600)); return }

  let n = 0
  for (const img of images) {
    const url = img.url || img
    const bin = Buffer.from(await (await fetch(url)).arrayBuffer())
    const file = path.join(outDir, `out-${++n}.png`)
    fs.writeFileSync(file, bin)
    console.log('\nSaved', file)
  }
}

main()
