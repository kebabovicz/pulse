import { createHash } from 'node:crypto'
import type { CaptureResult, RequestStep } from '@pulse/shared'

interface CachedValue {
  value: string
  secret: boolean
  capture: CaptureResult
}

interface Entry {
  expiresAt: number
  values: Record<string, CachedValue>
}

/**
 * What a step captured, kept for the scenarios that come after it. A suite of
 * thirty scenarios signing in thirty times is thirty times the load for one
 * useful token, so a step marked `cache:` hands its captures to the next run
 * instead of repeating the request.
 *
 * The key is the request as it was actually sent — project, host, method, URL,
 * body and the captures asked for — so two accounts never share one token, and
 * an edited request starts its own entry. Values live in memory only: a restart
 * signs in again, which is the safe direction to fail.
 */
export class SharedCache {
  private entries = new Map<string, Entry>()

  /** The request as sent, hashed: the body may carry a password. */
  key(projectId: string, baseUrl: string, step: RequestStep, renderedRequest: string): string {
    const shape = JSON.stringify({ request: renderedRequest, capture: step.capture ?? {} })
    const digest = createHash('sha256').update(shape).digest('hex').slice(0, 32)
    return `${projectId}|${baseUrl}|${digest}`
  }

  get(key: string): Record<string, CachedValue> | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key)
      return undefined
    }
    return entry.values
  }

  set(key: string, values: Record<string, CachedValue>, ttlMs: number): void {
    this.entries.set(key, { expiresAt: Date.now() + ttlMs, values })
  }

  /** Drops every entry of one project and host — used when a cached token is refused. */
  dropHost(projectId: string, baseUrl: string): void {
    const prefix = `${projectId}|${baseUrl}|`
    for (const key of this.entries.keys()) if (key.startsWith(prefix)) this.entries.delete(key)
  }
}
