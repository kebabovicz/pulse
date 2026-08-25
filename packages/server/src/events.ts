import type { FastifyReply } from 'fastify'
import type { PulseEventDraft } from '@pulse/shared'

export class EventBus {
  private clients = new Set<FastifyReply>()

  publish(event: PulseEventDraft): void {
    const frame = `data: ${JSON.stringify({ ...event, ts: new Date().toISOString() })}\n\n`
    for (const client of this.clients) client.raw.write(frame)
  }

  // вызывать после reply.hijack()
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
