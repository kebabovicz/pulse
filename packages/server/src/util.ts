const DURATION = /^(\d+)(ms|s|m)$/
const SIZE = /^(\d+)(b|kb|mb)$/i

export function parseDuration(value: string): number {
  const m = DURATION.exec(value)
  if (!m) throw new Error(`не длительность: "${value}" (ожидается 500ms / 3s / 1m)`)
  const n = Number(m[1])
  return m[2] === 'ms' ? n : m[2] === 's' ? n * 1000 : n * 60_000
}

export function parseSize(value: string): number {
  const m = SIZE.exec(value)
  if (!m) throw new Error(`не размер: "${value}" (ожидается 512b / 256kb / 1mb)`)
  const n = Number(m[1])
  const unit = m[2].toLowerCase()
  return unit === 'b' ? n : unit === 'kb' ? n * 1024 : n * 1024 * 1024
}
