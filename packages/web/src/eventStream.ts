import type { PulseEvent } from '@pulse/shared'

type Listener = (event: PulseEvent) => void

const listeners = new Set<Listener>()
let source: EventSource | null = null
let retry: ReturnType<typeof setTimeout> | null = null

const RETRY_DELAY_MS = 3000

/**
 * One SSE connection shared by the whole app, opened lazily on the first
 * subscription — so an unauthorized page never connects. A dropped stream is
 * reopened, and the connection closes once nobody listens any more.
 */
export function subscribeToEvents(listener: Listener): () => void {
  listeners.add(listener)
  open()
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) close()
  }
}

function open(): void {
  if (source) return
  const stream = new EventSource('/api/events')
  stream.onmessage = ({ data }: MessageEvent<string>) => {
    let event: PulseEvent
    try {
      event = JSON.parse(data) as PulseEvent
    } catch {
      return // a malformed frame must not take the stream down
    }
    for (const listener of [...listeners]) listener(event)
  }
  stream.onerror = () => {
    // EventSource gives up permanently on a non-200 response — reconnect ourselves
    stream.close()
    if (source === stream) source = null
    if (listeners.size > 0 && retry === null) {
      retry = setTimeout(() => {
        retry = null
        open()
      }, RETRY_DELAY_MS)
    }
  }
  source = stream
}

function close(): void {
  source?.close()
  source = null
  if (retry !== null) {
    clearTimeout(retry)
    retry = null
  }
}
