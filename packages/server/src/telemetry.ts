import fs from 'node:fs'
import path from 'node:path'
import type { FastifyBaseLogger } from 'fastify'
import type { PulseEvent } from '@pulse/shared'

/** A batch is flushed when it reaches this size or this age, whichever comes first. */
const BATCH_SIZE = 50
const BATCH_MS = 2000

/** One rotation step: the file is moved aside once it grows past this. */
const MAX_FILE_BYTES = 32 * 1024 * 1024

export interface TelemetryOptions {
  /** also emit a record per finished step, not just per run */
  steps: boolean
  /** append events as JSON Lines to this file */
  file?: string
  /** POST batches of events here — a collector, an alerting hook, Loki's push API behind a proxy */
  url?: string
  token?: string
}

/** A log record: flat, stable keys, no nesting a collector would have to unwrap. */
type Record_ = { event: string; ts: string } & Record<string, unknown>

export function telemetryOptions(env: NodeJS.ProcessEnv): TelemetryOptions {
  return {
    steps: env.PULSE_LOG_STEPS === '1' || env.PULSE_LOG_STEPS === 'true',
    file: env.PULSE_EVENTS_FILE,
    url: env.PULSE_EVENTS_URL,
    token: env.PULSE_EVENTS_TOKEN,
  }
}

/**
 * Turns the events the UI already receives into structured log records: one line
 * per run (and, when asked, per step), on stdout and — optionally — into a file
 * or to a collector. Nothing here is Pulse-specific plumbing for one vendor: a
 * JSON line on stdout is what promtail, alloy, fluent-bit and the rest ingest.
 */
export function toRecord(event: PulseEvent, steps: boolean): Record_ | null {
  const base = { ts: event.ts, project: event.project }
  switch (event.type) {
    case 'run-started':
      return {
        event: 'run.started',
        ...base,
        scenario: event.scenario,
        run: event.run,
        name: event.scenarioName,
        host: event.host,
        trigger: event.trigger ?? 'manual',
        steps: event.steps.length,
      }
    case 'run-finished':
      return {
        event: 'run.finished',
        ...base,
        scenario: event.scenario,
        run: event.run,
        status: event.status,
        durationMs: event.durationMs,
        failedStep: event.failedStep,
        failedCheck: event.failedCheck && {
          expected: event.failedCheck.expected,
          actual: event.failedCheck.actual,
        },
        cleanupFailed: event.cleanupFailed,
        message: event.message,
      }
    case 'step-finished':
      if (!steps) return null
      return {
        event: 'step.finished',
        ...base,
        scenario: event.scenario,
        run: event.run,
        step: event.stepId,
        status: event.status,
        code: event.response?.status,
        durationMs: event.durationMs,
        attempts: event.attempts,
        error: event.error?.message,
      }
    case 'scenario-changed':
      return {
        event: 'scenario.changed',
        ...base,
        scenario: event.path,
        action: event.action,
        valid: event.summary?.valid,
        error: event.summary?.error?.message,
      }
    case 'health-changed':
      return { event: 'health.changed', ...base, status: event.status, reason: event.reason }
    default:
      return null
  }
}

/** Appends JSON Lines, moving the file aside once when it grows too large. */
class FileSink {
  constructor(
    private readonly file: string,
    private readonly log: FastifyBaseLogger,
  ) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
  }

  write(lines: string): void {
    try {
      const size = fs.statSync(this.file, { throwIfNoEntry: false })?.size ?? 0
      if (size > MAX_FILE_BYTES) fs.renameSync(this.file, `${this.file}.1`)
      fs.appendFileSync(this.file, lines)
    } catch (e) {
      this.log.warn(`events file: ${(e as Error).message}`)
    }
  }
}

/** Batches records and POSTs them; a collector being down must never stall a run. */
class HttpSink {
  private queue: Record_[] = []
  private timer?: ReturnType<typeof setTimeout>

  constructor(
    private readonly url: string,
    private readonly token: string | undefined,
    private readonly log: FastifyBaseLogger,
  ) {}

  push(record: Record_): void {
    this.queue.push(record)
    if (this.queue.length >= BATCH_SIZE) return void this.flush()
    this.timer ??= setTimeout(() => void this.flush(), BATCH_MS)
  }

  async flush(): Promise<void> {
    clearTimeout(this.timer)
    this.timer = undefined
    const batch = this.queue.splice(0)
    if (batch.length === 0) return
    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        },
        body: JSON.stringify({ events: batch }),
      })
      if (!response.ok) this.log.warn(`events endpoint answered ${response.status}`)
    } catch (e) {
      // dropped on purpose: buffering telemetry on disk would outlive its usefulness
      this.log.warn(`events endpoint: ${(e as Error).message}`)
    }
  }
}

/** Wires the event stream into the log; returns a function that flushes pending batches. */
export function attachTelemetry(
  onEvent: (listener: (event: PulseEvent) => void) => void,
  log: FastifyBaseLogger,
  options: TelemetryOptions,
): () => Promise<void> {
  const file = options.file ? new FileSink(options.file, log) : undefined
  const http = options.url ? new HttpSink(options.url, options.token, log) : undefined

  onEvent((event) => {
    const record = toRecord(event, options.steps)
    if (!record) return
    log.info(record, record.event)
    file?.write(`${JSON.stringify(record)}\n`)
    http?.push(record)
  })

  return () => http?.flush() ?? Promise.resolve()
}
