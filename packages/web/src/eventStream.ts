import type { PulseEvent } from '@pulse/shared'

type Listener = (event: PulseEvent) => void

const listeners = new Set<Listener>()
let source: EventSource | null = null

/**
 * One SSE connection shared by the whole app, opened lazily on the first
 * subscription — so an unauthorized page never connects.
 */
export function subscribeToEvents(listener: Listener): () => void {
  listeners.add(listener)
  source ??= openStream()
  return () => {
    listeners.delete(listener)
  }
}

function openStream(): EventSource {
  const stream = new EventSource('/api/events')
  stream.onmessage = ({ data }: MessageEvent<string>) => {
    const event = JSON.parse(data) as PulseEvent
    for (const listener of [...listeners]) listener(event)
  }
  return stream
}
