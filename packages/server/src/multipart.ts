import fs from 'node:fs'
import path from 'node:path'
import type { MultipartPart, PartSnapshot } from '@pulse/shared'

/** A fixture is held in memory whole, so a stray huge file is rejected instead of eating the process. */
const MAX_FILE_BYTES = 64 * 1024 * 1024

const CONTENT_TYPES: Record<string, string> = {
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.heic': 'image/heic',
  '.zip': 'application/zip',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

const typeByName = (filename: string): string | undefined => CONTENT_TYPES[path.extname(filename).toLowerCase()]

/** A Blob wants a plain view; this one shares the bytes instead of copying a whole file. */
const view = (buf: Buffer): Uint8Array<ArrayBuffer> =>
  new Uint8Array(buf.buffer as ArrayBuffer, buf.byteOffset, buf.byteLength)

/** Reads a fixture, refusing to leave the scenarios folder — a scenario is not a file browser. */
function readFixture(rel: string, scenariosDir: string): Buffer {
  const normalized = path.normalize(rel.replaceAll('\\', '/'))
  const base = path.resolve(scenariosDir)
  const abs = path.resolve(base, normalized)
  if (normalized.startsWith('..') || path.isAbsolute(normalized) || !abs.startsWith(base + path.sep))
    throw new Error(`file "${rel}" is outside the scenarios folder`)
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile())
    throw new Error(`no file "${normalized}" in the scenarios folder`)
  const size = fs.statSync(abs).size
  if (size > MAX_FILE_BYTES)
    throw new Error(
      `file "${normalized}" is ${Math.round(size / 1024 / 1024)} MB, over the ${MAX_FILE_BYTES / 1024 / 1024} MB limit`,
    )
  return fs.readFileSync(abs)
}

/**
 * Builds the multipart/form-data body of a request (SPEC.md): a scalar is a plain
 * field, an object is a file taken from the scenarios folder or written inline.
 * `track` interpolates variables and records the substitution for the UI.
 */
export function buildMultipart(
  multipart: Record<string, MultipartPart | MultipartPart[]>,
  scenariosDir: string,
  track: (location: string, input: string) => string,
): { form: FormData; parts: PartSnapshot[] } {
  const form = new FormData()
  const parts: PartSnapshot[] = []

  for (const [name, value] of Object.entries(multipart)) {
    for (const part of Array.isArray(value) ? value : [value]) {
      const location = `multipart.${name}`
      if (typeof part !== 'object') {
        const text = track(location, String(part))
        form.append(name, text)
        parts.push({ name, value: text })
        continue
      }

      let bytes: Buffer
      let source: string
      let filename: string
      if ('file' in part) {
        source = track(location, part.file)
        bytes = readFixture(source, scenariosDir)
        filename = part.filename ?? path.basename(source)
      } else if ('text' in part) {
        bytes = Buffer.from(track(location, part.text), 'utf8')
        source = 'inline'
        filename = part.filename ?? name
      } else {
        bytes = Buffer.from(part.base64, 'base64')
        source = 'base64'
        filename = part.filename ?? name
      }
      const contentType =
        part.contentType ??
        typeByName(filename) ??
        ('text' in part ? 'text/plain; charset=utf-8' : 'application/octet-stream')
      form.append(name, new Blob([view(bytes)], { type: contentType }), filename)
      parts.push({ name, filename, contentType, sizeBytes: bytes.length, source })
    }
  }
  return { form, parts }
}
