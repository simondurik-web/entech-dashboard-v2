import { spawn } from 'child_process'
import { createRequire } from 'module'
import path from 'path'

/**
 * Runs ALL untrusted-PDF work in a separate OS process with a hard memory cap.
 *
 * Why a process and not a worker thread: worker_threads `resourceLimits` does
 * NOT contain a V8 out-of-memory. Measured on Node 25 — a worker that exhausts
 * the heap raises V8's OOM handler, which is process-FATAL and takes the whole
 * dashboard down with it. A child process with --max-old-space-size dies alone:
 * the parent observes a non-zero exit and stays flat. Verified both ways before
 * this was written.
 *
 * Everything that parses the upload lives here, not just the reshaping. pdf-lib
 * inflates object streams during `load`, so keeping inspection in-process would
 * have left the bomb vector open while looking protected.
 */

export type PdfWorkerOptions = {
  targetWidth: number
  targetHeight: number
  fitMargin: number
  labelTolerance: number
  isLabel: boolean
  quarterTurns: number
  fitToPage: boolean
  firstPageOnly: boolean
  maxPages: number
}

export type PdfWorkerMeta = {
  encrypted: boolean
  pageCount: number
  annotations: boolean
  optionalContent: boolean
  /** 1-based index of the first page too large for a 4x6 label, else 0. */
  oversizedLabelPage: number
  /** True when the page was NOT re-laid, for any reason. */
  fitSkipped: boolean
}

export type PdfWorkerResult =
  | { ok: true; meta: PdfWorkerMeta; bytes: Uint8Array | null }
  | { ok: false; reason: 'timeout' | 'memory' | 'unreadable' | 'unavailable' }

const MEMORY_CAP_MB = 256
// The prepared PDF is bounded by the upload cap and the page cap; anything far
// beyond that is a runaway child, not a document.
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024
const TIMEOUT_MS = 25_000

/**
 * Child source. Kept as a string and passed with `-e` on purpose: there is no
 * file for a bundler to miss, and no path to resolve differently in dev and in
 * the container. stdout is binary, so diagnostics MUST go to stderr.
 * Framing: 4-byte little-endian JSON length, the JSON, then the PDF bytes.
 */
const CHILD_SOURCE = `
const chunks = []
process.stdin.on('data', (c) => chunks.push(c))
process.stdin.on('end', async () => {
  try {
    // Resolve pdf-lib defensively. The bundler can rewrite a parent-side
    // require.resolve into the bare specifier, so the child tries the path it
    // was handed, then plain resolution, then the app's node_modules. This is
    // infrastructure resolution, never influenced by the upload.
    const path_ = require('path')
    let PDFLib = null
    const candidates = [
      process.argv[1],
      'pdf-lib',
      path_.join(process.cwd(), 'node_modules', 'pdf-lib'),
    ]
    for (const candidate of candidates) {
      if (!candidate) continue
      try { PDFLib = require(candidate); break } catch (_) { /* try the next */ }
    }
    if (!PDFLib) { process.stderr.write('PDF_WORKER_NO_PDFLIB', () => process.exit(4)); return }
    const { PDFDocument, PDFName, degrees } = PDFLib
    const o = JSON.parse(process.argv[2])
    const input = new Uint8Array(Buffer.concat(chunks))
    const src = await PDFDocument.load(input, { updateMetadata: false, ignoreEncryption: true })
    const pages = src.getPages()

    const meta = {
      encrypted: Boolean(src.isEncrypted),
      pageCount: pages.length,
      annotations: pages.some((p) => { const a = p.node.Annots(); return Boolean(a && a.size() > 0) }),
      optionalContent: src.catalog.has(PDFName.of('OCProperties')),
      oversizedLabelPage: 0,
      fitSkipped: true,
    }

    if (o.isLabel) {
      const idx = pages.findIndex((p) => {
        const { width, height } = p.getSize()
        return Math.min(width, height) > o.targetWidth * o.labelTolerance ||
               Math.max(width, height) > o.targetHeight * o.labelTolerance
      })
      meta.oversizedLabelPage = idx + 1
    }

    const relayable = o.fitToPage && !meta.annotations && !meta.optionalContent
    // Refuse early on anything the caller will reject anyway, so a 5000-page
    // document is never re-laid just to be thrown away.
    const tooLong = meta.pageCount > o.maxPages
    let outBytes = null

    if (meta.encrypted || tooLong || meta.pageCount < 1) {
      // nothing to produce; caller decides the error
    } else if (!relayable) {
      if (o.quarterTurns || o.firstPageOnly) {
        const keep = o.firstPageOnly ? pages.slice(0, 1) : pages
        keep.forEach((p) => {
          const angle = (((p.getRotation().angle + o.quarterTurns * 90) % 360) + 360) % 360
          p.setRotation(degrees(angle))
        })
        if (o.firstPageOnly) for (let i = pages.length - 1; i >= 1; i -= 1) src.removePage(i)
        outBytes = await src.save()
      }
      meta.fitSkipped = true
    } else {
      // A valid page with no /Contents stream makes embedPages throw. Refusing
      // the whole document over that would be wrong, so the re-lay falls back
      // to printing it as-is rather than not at all.
      try {
      const use = o.firstPageOnly ? pages.slice(0, 1) : pages
      const out = await PDFDocument.create()
      const boxes = use.map((p) => {
        const b = p.getCropBox()
        return { left: b.x, bottom: b.y, right: b.x + b.width, top: b.y + b.height }
      })
      const embedded = await out.embedPages(use, boxes)
      const availW = o.targetWidth - o.fitMargin * 2
      const availH = o.targetHeight - o.fitMargin * 2
      const scaleFor = (w, h) =>
        w <= o.targetWidth && h <= o.targetHeight ? 1 : Math.min(availW / w, availH / h)
      embedded.forEach((ep, i) => {
        const sp = use[i]
        const crop = sp.getCropBox()
        const rw = crop.width, rh = crop.height
        const ang = ((sp.getRotation().angle % 360) + 360) % 360
        const pageTurns = Math.round(ang / 90) % 4
        const dW = pageTurns % 2 === 1 ? rh : rw
        const dH = pageTurns % 2 === 1 ? rw : rh
        const autoTurn = scaleFor(dH, dW) > scaleFor(dW, dH)
        const turns = (pageTurns + (autoTurn ? 1 : 0) + o.quarterTurns) % 4
        const swapped = turns % 2 === 1
        const fW = swapped ? rh : rw
        const fH = swapped ? rw : rh
        const scale = scaleFor(fW, fH)
        const bW = fW * scale, bH = fH * scale
        const left = (o.targetWidth - bW) / 2, bottom = (o.targetHeight - bH) / 2
        const anchor = turns === 0 ? { x: left, y: bottom }
          : turns === 1 ? { x: left + bW, y: bottom }
          : turns === 2 ? { x: left + bW, y: bottom + bH }
          : { x: left, y: bottom + bH }
        out.addPage([o.targetWidth, o.targetHeight]).drawPage(ep, {
          ...anchor, xScale: scale, yScale: scale, rotate: degrees(turns * 90),
        })
      })
      outBytes = await out.save()
      meta.fitSkipped = false
      } catch (relayError) {
        process.stderr.write('PDF_WORKER_RELAY_FALLBACK: ' + String((relayError && relayError.message) || relayError))
        outBytes = null
        meta.fitSkipped = true
      }
    }

    const json = Buffer.from(JSON.stringify(meta), 'utf8')
    const header = Buffer.alloc(4)
    header.writeUInt32LE(json.length, 0)
    const payload = Buffer.concat([header, json, outBytes ? Buffer.from(outBytes) : Buffer.alloc(0)])
    // process.exit() ABORTS a pending stdout write. stdout to a pipe is async,
    // so exiting straight after write() truncates the payload at the OS pipe
    // buffer -- about 64 KiB. Every real drawing is larger than that, so this
    // silently produced corrupt PDFs that the parent accepted as success.
    // Wait for the flush, and only then exit.
    process.stdout.write(payload, () => process.exit(0))
  } catch (e) {
    process.stderr.write('PDF_WORKER_ERROR: ' + String((e && e.message) || e), () => process.exit(3))
  }
})
`

function resolvePdfLib(): string | null {
  // A bundler can rewrite require.resolve so it hands back the bare specifier
  // rather than a path; only an absolute path is a real answer here. The child
  // has its own fallbacks, so returning null is a hint, not a failure.
  const candidates = [
    () => createRequire(import.meta.url).resolve('pdf-lib'),
    () => createRequire(path.join(process.cwd(), 'package.json')).resolve('pdf-lib'),
    () => path.join(process.cwd(), 'node_modules', 'pdf-lib'),
  ]
  for (const candidate of candidates) {
    try {
      const resolved = candidate()
      if (resolved && path.isAbsolute(resolved)) return resolved
    } catch {
      // try the next
    }
  }
  return null
}

export async function runPdfWorker(
  bytes: Uint8Array,
  options: PdfWorkerOptions
): Promise<PdfWorkerResult> {
  // If the parent cannot produce a path the child still resolves for itself;
  // what we never do is fall back to parsing in-process, which would restore
  // the exact exposure this exists to remove at the moment it is least expected.
  const pdfLibPath = resolvePdfLib() ?? 'pdf-lib'

  return new Promise<PdfWorkerResult>((resolve) => {
    let child
    try {
      child = spawn(
        process.execPath,
        [`--max-old-space-size=${MEMORY_CAP_MB}`, '-e', CHILD_SOURCE, pdfLibPath, JSON.stringify(options)],
        { stdio: ['pipe', 'pipe', 'pipe'] }
      )
    } catch {
      resolve({ ok: false, reason: 'unavailable' })
      return
    }

    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let stdoutBytes = 0
    let settled = false
    const finish = (result: PdfWorkerResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish({ ok: false, reason: 'timeout' })
    }, TIMEOUT_MS)

    child.stdout.on('data', (c: Buffer) => {
      stdoutBytes += c.length
      // Bound the PARENT too: a child streaming without end would move the
      // memory problem across the process boundary rather than contain it.
      if (stdoutBytes > MAX_OUTPUT_BYTES) {
        child.kill('SIGKILL')
        finish({ ok: false, reason: 'memory' })
        return
      }
      stdout.push(c)
    })
    child.stderr.on('data', (c: Buffer) => {
      if (stderr.length < 20) stderr.push(c)
    })
    child.on('error', () => finish({ ok: false, reason: 'unavailable' }))

    child.on('close', (code, signal) => {
      if (settled) return
      // Killed by a signal, or V8 aborting on its heap cap, is the bomb case.
      if (signal || code === null || code === 134) {
        console.error('pdf worker died:', { code, signal })
        finish({ ok: false, reason: 'memory' })
        return
      }
      if (code !== 0) {
        console.error('pdf worker failed:', Buffer.concat(stderr).toString().slice(0, 300))
        finish({ ok: false, reason: 'unreadable' })
        return
      }
      const body = Buffer.concat(stdout)
      if (body.length < 4) return finish({ ok: false, reason: 'unreadable' })
      const jsonLength = body.readUInt32LE(0)
      if (body.length < 4 + jsonLength) return finish({ ok: false, reason: 'unreadable' })
      try {
        const meta = JSON.parse(body.subarray(4, 4 + jsonLength).toString('utf8')) as PdfWorkerMeta
        const rest = body.subarray(4 + jsonLength)
        finish({ ok: true, meta, bytes: rest.length > 0 ? new Uint8Array(rest) : null })
      } catch {
        finish({ ok: false, reason: 'unreadable' })
      }
    })

    child.stdin.on('error', () => finish({ ok: false, reason: 'unavailable' }))
    child.stdin.end(Buffer.from(bytes))
  })
}
