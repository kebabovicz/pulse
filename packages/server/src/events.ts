import type { FastifyReply } from 'fastify'
import type { PulseEvent, PulseEventDraft } from '@pulse/shared'

export class EventBus {
  private clients = new Set<FastifyReply>()
  private listeners = new Set<(event: PulseEvent) => void>()

  publish(event: PulseEventDraft): void {
    const stamped: PulseEvent = { ...event, ts: new Date().toISOString() }
    const frame = `data: ${JSON.stringify(stamped)}\n\n`
    for (const client of this.clients) client.raw.write(frame)
    for (const listener of this.listeners) listener(stamped)
  }

  /** In-process subscribers — telemetry reads the same stream the UI does. */
  onEvent(listener: (event: PulseEvent) => void): void {
    this.listeners.add(listener)
  }

  // call after reply.hijack()
  subscribe(reply: FastifyReply): void {
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    reply.raw.write(':connected\n\n')
    this.clients.add(reply)
    const ping = setInterval(() => reply.raw.write(':ping\n\n'), 15_000)
    reply.raw.on('close', () => {
      clearInterval(ping)
      this.clients.delete(reply)
    })
  }
}
