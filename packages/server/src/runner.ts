import { setTimeout as sleep } from 'node:timers/promises'
import { JSONPath } from 'jsonpath-plus'
import {
  isRequestStep,
  type BodyCheck,
  type CaptureResult,
  type CheckResult,
  type RequestStep,
  type RunRecord,
  type RunVar,
  type Scenario,
  type SleepStep,
  type Step,
  type StepPlan,
  type StepResult,
  type Substitution,
  type VarUsage,
} from '@pulse/shared'
import type { Project, Settings } from './config.js'
import type { EventBus } from './events.js'
import { stepRefs, type LoadedScenario } from './scenarios.js'
import { RunStore } from './storage.js'
import { TemplateSpace } from './template.js'
import { parseDuration } from './util.js'

const PREVIEW_LIMIT = 120
const preview = (s: string): string => (s.length > PREVIEW_LIMIT ? `${s.slice(0, PREVIEW_LIMIT)}…` : s)

interface ActiveRun {
  run: number
  scenario: string
  abort: AbortController
  record: RunRecord
}

interface RunCtx {
  project: Project
  baseUrl: string
  scenario: string
  run: number
  space: TemplateSpace
  jar: Map<string, string>
  signal: AbortSignal // меняется между фазами: main = стоп ∪ таймаут, cleanup = только стоп
  bodyLimit: number
}

export class Runner {
  private active = new Map<string, ActiveRun>()

  constructor(
    private bus: EventBus,
    private runs: RunStore,
    private settings: () => Settings,
  ) {}

  isBusy(projectId: string): boolean {
    return this.active.has(projectId)
  }

  current(projectId: string): RunRecord | undefined {
    return this.active.get(projectId)?.record
  }

  stop(projectId: string): boolean {
    const active = this.active.get(projectId)
    active?.abort.abort()
    return Boolean(active)
  }

  /** Запускает прогон в фоне, сразу возвращает его номер. */
  start(
    project: Project,
    loaded: LoadedScenario,
    overrides: Record<string, string>,
    hostName: string,
    baseUrl: string,
    trigger?: 'ci',
  ): { run: number; finished: Promise<RunRecord> } {
    if (!loaded.scenario) throw new Error('сценарий невалиден')
    if (this.active.has(project.id)) throw new Error('прогон уже идёт')

    const scenario = loaded.scenario
    const relPath = loaded.summary.path
    const run = this.runs.nextRun(project.id, RunStore.scenarioKey(relPath))
    const abort = new AbortController()
    const space = new TemplateSpace()

    const vars = initVars(scenario, overrides, space)
    const record: RunRecord = {
      run,
      project: project.id,
      scenario: relPath,
      scenarioName: scenario.name,
      scenarioHash: loaded.summary.hash,
      host: hostName,
      trigger,
      startedAt: new Date().toISOString(),
      finishedAt: '',
      status: 'error',
      durationMs: 0,
      vars,
      varUsage: buildVarUsage(scenario),
      steps: buildPlan(scenario).map((plan) => ({ ...plan, stepId: plan.id, status: 'skipped' as const })),
    }
    this.active.set(project.id, { run, scenario: relPath, abort, record })
    const finished = this.execute(project, baseUrl, scenario, loaded.raw, record, space, abort.signal)
      .then(() => record)
      .finally(() => this.active.delete(project.id))
    return { run, finished }
  }

  private async execute(
    project: Project,
    baseUrl: string,
    scenario: Scenario,
    raw: string,
    record: RunRecord,
    space: TemplateSpace,
    signal: AbortSignal,
  ): Promise<void> {
    // runTimeout обрывает основные шаги, ручной стоп (signal) — вообще всё
    const runAbort = new AbortController()
    const timer = setTimeout(() => runAbort.abort(), project.runTimeoutMs)
    const ctx: RunCtx = {
      project,
      baseUrl,
      scenario: record.scenario,
      run: record.run,
      space,
      jar: new Map(),
      signal: AbortSignal.any([signal, runAbort.signal]),
      bodyLimit: this.settings().bodyLimitBytes,
    }
    this.publish(ctx, {
      type: 'run-started',
      scenarioName: record.scenarioName,
      scenarioHash: record.scenarioHash,
      host: record.host,
      vars: record.vars,
      varUsage: record.varUsage,
      steps: buildPlan(scenario),
    })

    const startedMs = Date.now()
    let failed: StepResult | undefined
    for (const [i, step] of scenario.steps.entries()) {
      let result: StepResult
      if (failed || ctx.signal.aborted) {
        result = { stepId: step.id, status: 'skipped' }
      } else {
        result = isRequestStep(step) ? await this.runRequest(ctx, step) : await this.runSleep(ctx, step)
      }
      this.publish(ctx, { type: 'step-finished', ...result })
      Object.assign(record.steps[i], result)
      if (result.status === 'failed' && !failed) failed = result
    }
    clearTimeout(timer)
    const timedOut = runAbort.signal.aborted && !signal.aborted
    ctx.signal = signal // уборку прерывает только ручной стоп

    // уборка: выполняется и после провала (тогда она нужнее всего);
    // при ручной остановке пропускается, провалы не скипают соседние cleanup-шаги
    let cleanupFailed = false
    const cleanupSteps = scenario.cleanup ?? []
    for (const [i, step] of cleanupSteps.entries()) {
      const recordIndex = scenario.steps.length + i
      let result: StepResult
      if (ctx.signal.aborted) {
        result = { stepId: step.id, status: 'skipped' }
      } else {
        result = isRequestStep(step) ? await this.runRequest(ctx, step) : await this.runSleep(ctx, step)
      }
      this.publish(ctx, { type: 'step-finished', ...result })
      Object.assign(record.steps[recordIndex], result)
      if (result.status === 'failed') cleanupFailed = true
    }

    record.durationMs = Date.now() - startedMs
    record.finishedAt = new Date().toISOString()
    record.status = signal.aborted ? 'stopped' : failed || timedOut ? 'failed' : 'passed'
    if (timedOut) record.message = `run timeout (${Math.round(ctx.project.runTimeoutMs / 1000)}s)`
    record.failedStep = failed?.stepId
    record.failedCheck = failed?.checks?.find((c) => !c.passed)
    record.cleanupFailed = cleanupFailed || undefined
    this.publish(ctx, {
      type: 'run-finished',
      status: record.status,
      durationMs: record.durationMs,
      failedStep: record.failedStep,
      failedCheck: record.failedCheck,
      cleanupFailed: record.cleanupFailed,
      message: record.message,
    })
    this.runs.save(record, raw)
  }

  private async runSleep(ctx: RunCtx, step: SleepStep): Promise<StepResult> {
    const total = parseDuration(step.sleep)
    const startedAt = new Date().toISOString()
    this.publish(ctx, { type: 'step-started', stepId: step.id, attempt: 1 })
    let remaining = total
    while (remaining > 0 && !ctx.signal.aborted) {
      const chunk = Math.min(1000, remaining)
      await sleep(chunk, { signal: ctx.signal }).catch(() => undefined)
      remaining -= chunk
      if (remaining > 0) this.publish(ctx, { type: 'step-progress', stepId: step.id, remainingMs: remaining })
    }
    if (ctx.signal.aborted) return { stepId: step.id, status: 'skipped' }
    return { stepId: step.id, status: 'passed', startedAt, durationMs: total, attempts: 1 }
  }

  private async runRequest(ctx: RunCtx, step: RequestStep): Promise<StepResult> {
    const maxAttempts = step.retry?.attempts ?? 1
    const retryDelay = step.retry ? parseDuration(step.retry.delay) : 0
    const timeoutMs = step.timeout ? parseDuration(step.timeout) : ctx.project.stepTimeoutMs
    const startedAt = new Date().toISOString()
    const t0 = Date.now()
    const base: StepResult = { stepId: step.id, status: 'failed', startedAt }

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      this.publish(ctx, { type: 'step-started', stepId: step.id, attempt })
      const outcome = await this.attempt(ctx, step, timeoutMs)
      if (ctx.signal.aborted) return { stepId: step.id, status: 'skipped' }
      Object.assign(base, outcome, { attempts: attempt, durationMs: Date.now() - t0 })
      if (outcome.status === 'passed' || attempt === maxAttempts) return base
      this.publish(ctx, {
        type: 'step-retry',
        stepId: step.id,
        attempt,
        maxAttempts,
        failed: failedLabels(outcome),
        nextDelayMs: retryDelay,
      })
      await sleep(retryDelay, { signal: ctx.signal }).catch(() => undefined)
    }
    return base
  }

  private async attempt(
    ctx: RunCtx,
    step: RequestStep,
    timeoutMs: number,
  ): Promise<Pick<StepResult, 'status' | 'request' | 'response' | 'checks' | 'captures' | 'error'>> {
    const { space, jar } = ctx
    const substitutions: Substitution[] = []
    const track = (location: string, input: string): string => {
      const { text, used } = space.render(input)
      for (const name of used) substitutions.push({ location, var: name, fromStep: space.get(name)?.fromStep ?? null })
      return text
    }

    if (step.cookies?.clear) jar.clear()
    for (const [name, value] of Object.entries(step.cookies?.set ?? {})) {
      jar.set(name, track(`cookies.${name}`, value))
    }

    const url = new URL(step.request.url ? track('url', step.request.url) : ctx.baseUrl + track('url', step.request.path!))
    for (const [name, value] of Object.entries(step.request.query ?? {})) {
      url.searchParams.set(name, track(`query.${name}`, String(value)))
    }

    const headers = new Headers()
    for (const [name, value] of Object.entries(step.request.headers ?? {})) {
      headers.set(name, track(`headers.${name}`, value))
    }
    if (jar.size > 0 && !headers.has('cookie')) {
      headers.set('cookie', [...jar].map(([k, v]) => `${k}=${v}`).join('; '))
    }

    let body: string | null = null
    if (step.request.body !== undefined) {
      if (typeof step.request.body === 'string') {
        body = track('body', step.request.body)
        headers.set('content-type', step.request.contentType ?? 'text/plain; charset=utf-8')
      } else {
        body = track('body', JSON.stringify(step.request.body))
        headers.set('content-type', step.request.contentType ?? 'application/json')
      }
    }

    const snapshot = {
      method: step.request.method,
      url: space.mask(url.toString()),
      headers: Object.fromEntries([...headers].map(([k, v]) => [k, space.mask(v)])),
      body: body === null ? null : space.mask(body),
      contentType: headers.get('content-type'),
      substitutions,
    }

    let res: Response
    const t0 = performance.now()
    try {
      res = await fetch(url, {
        method: step.request.method,
        headers,
        body,
        redirect: 'manual',
        signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(timeoutMs)]),
      })
    } catch (e) {
      if (ctx.signal.aborted) return { status: 'failed', request: snapshot }
      const cause = (e as { cause?: { code?: string } }).cause
      const message = (e as Error).name === 'TimeoutError' ? `timeout ${timeoutMs} ms` : (cause?.code ?? (e as Error).message)
      return { status: 'failed', request: snapshot, response: null, checks: [], error: { kind: 'network', message } }
    }
    const durationMs = Math.round(performance.now() - t0)

    const buf = Buffer.from(await res.arrayBuffer())
    const contentType = res.headers.get('content-type')
    const isText = contentType === null || /json|text|xml|urlencoded/.test(contentType)
    const text = isText ? buf.toString('utf8') : ''
    const setCookies = new Map<string, string>()
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';')
      const eq = pair.indexOf('=')
      if (eq > 0) setCookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1))
    }
    for (const [name, value] of setCookies) ctx.jar.set(name, value)

    const stored = isText ? buf.subarray(0, ctx.bodyLimit).toString('utf8') : buf.subarray(0, ctx.bodyLimit).toString('base64')
    const response = {
      status: res.status,
      durationMs,
      sizeBytes: buf.length,
      contentType,
      headers: Object.fromEntries(res.headers),
      body: stored,
      ...(isText ? {} : { bodyEncoding: 'base64' as const }),
      bodyTruncated: buf.length > ctx.bodyLimit,
    }

    let json: unknown
    if (contentType && /json/.test(contentType)) {
      try {
        json = JSON.parse(text)
      } catch {
        /* не JSON — body-path проверки дадут null */
      }
    }
    const checks = evalChecks(step.expect, res, text, json, (s) => space.render(s).text)
    if (!checks.every((c) => c.passed)) return { status: 'failed', request: snapshot, response, checks }

    const captures: CaptureResult[] = []
    for (const [name, spec] of Object.entries(step.capture ?? {})) {
      let value = ''
      let detail = ''
      if (spec.from === 'body') {
        if (spec.path) {
          const found = JSONPath({ path: spec.path, json: json ?? null, wrap: true }) as unknown[]
          value = found.length ? String(found[0]) : ''
          detail = spec.path
        } else if (spec.regex) {
          value = new RegExp(spec.regex).exec(text)?.[1] ?? ''
          detail = `regex: ${spec.regex}`
        } else {
          value = text
          detail = 'entire body'
        }
      } else if (spec.from === 'header') {
        value = res.headers.get(spec.name) ?? ''
        detail = spec.name
      } else {
        value = setCookies.get(spec.name) ?? ''
        detail = spec.name
      }
      ctx.space.set(name, { value, fromStep: step.id, secret: false })
      captures.push({ name, from: spec.from, detail, value: value.slice(0, 4096) })
    }
    return { status: 'passed', request: snapshot, response, checks, captures }
  }

  private publish(ctx: RunCtx, event: Record<string, unknown> & { type: string }): void {
    this.bus.publish({ project: ctx.project.id, scenario: ctx.scenario, run: ctx.run, ...event } as never)
  }
}

function initVars(scenario: Scenario, overrides: Record<string, string>, space: TemplateSpace): RunVar[] {
  const vars: RunVar[] = []
  for (const [name, def] of Object.entries(scenario.vars ?? {})) {
    const secret = def.secret ?? false
    const override = overrides[name]
    const value = space.render(override ?? String(def.default ?? '')).text
    space.set(name, { value, fromStep: null, secret })
    vars.push({ name, value: secret ? '•••' : value, ...(secret && { secret }), source: override !== undefined ? 'manual' : 'default' })
  }
  return vars
}

function planStep(step: Step, cleanup: boolean): StepPlan {
  const base = cleanup ? { cleanup: true as const } : {}
  return isRequestStep(step)
    ? {
        ...base,
        id: step.id,
        name: step.name ?? null,
        kind: 'request' as const,
        method: step.request.method,
        path: step.request.path ?? step.request.url,
        retry: step.retry ? { attempts: step.retry.attempts, delayMs: parseDuration(step.retry.delay) } : null,
      }
    : { ...base, id: step.id, name: step.name ?? null, kind: 'sleep' as const, durationMs: parseDuration(step.sleep) }
}

function buildPlan(scenario: Scenario): StepPlan[] {
  return [...scenario.steps.map((s) => planStep(s, false)), ...(scenario.cleanup ?? []).map((s) => planStep(s, true))]
}

function buildVarUsage(scenario: Scenario): VarUsage {
  const usage: VarUsage = {}
  const allSteps = [...scenario.steps, ...(scenario.cleanup ?? [])]
  for (const step of allSteps) {
    if (!isRequestStep(step)) continue
    for (const name of Object.keys(step.capture ?? {})) usage[name] = { capturedBy: step.id, usedBy: [] }
  }
  for (const step of allSteps) {
    for (const ref of stepRefs(step)) {
      const entry = usage[ref]
      if (entry && entry.capturedBy !== step.id && !entry.usedBy.includes(step.id)) entry.usedBy.push(step.id)
    }
  }
  return usage
}

function evalChecks(
  expect: RequestStep['expect'],
  res: Response,
  text: string,
  json: unknown,
  render: (s: string) => string,
): CheckResult[] {
  const results: CheckResult[] = []
  const statuses = Array.isArray(expect.status) ? expect.status : [expect.status]
  results.push({
    kind: 'status',
    expected: statuses.join(' | '),
    actual: String(res.status),
    passed: statuses.includes(res.status),
  })
  for (const [name, want] of Object.entries(expect.headers ?? {})) {
    const actual = res.headers.get(name)
    if (want === null) {
      results.push({ kind: 'header', name, expected: 'absent', actual, passed: actual === null })
    } else {
      const expected = render(want)
      results.push({ kind: 'header', name, expected, actual, passed: actual !== null && actual.includes(expected) })
    }
  }
  for (const check of expect.body ?? []) {
    results.push(evalBodyCheck(check, text, json, render))
  }
  return results
}

function evalBodyCheck(check: BodyCheck, text: string, json: unknown, render: (s: string) => string): CheckResult {
  if ('text' in check) {
    const expected = render(check.matches)
    return {
      kind: 'body-text',
      expected,
      actual: preview(text),
      passed: new RegExp(expected).test(text),
    }
  }
  const found = json === undefined ? [] : (JSONPath({ path: check.path, json: json as never, wrap: true }) as unknown[])
  const value = found[0]
  const actual = found.length === 0 ? null : typeof value === 'string' ? value : JSON.stringify(value)
  if (check.exists !== undefined) {
    return { kind: 'body-path', path: check.path, predicate: 'exists', expected: String(check.exists), actual, passed: found.length > 0 === check.exists }
  }
  if (check.equals !== undefined) {
    const expected = typeof check.equals === 'string' ? render(check.equals) : String(check.equals)
    return { kind: 'body-path', path: check.path, predicate: 'equals', expected, actual, passed: found.length > 0 && String(value) === expected }
  }
  if (check.notEquals !== undefined) {
    const expected = typeof check.notEquals === 'string' ? render(check.notEquals) : String(check.notEquals)
    return { kind: 'body-path', path: check.path, predicate: 'notEquals', expected: `≠ ${expected}`, actual, passed: found.length > 0 && String(value) !== expected }
  }
  if (check.equalsPath !== undefined) {
    const otherFound = json === undefined ? [] : (JSONPath({ path: check.equalsPath, json: json as never, wrap: true }) as unknown[])
    const other = otherFound.length === 0 ? null : otherFound[0]
    const expected = `${check.equalsPath} = ${other === null ? '—' : typeof other === 'string' ? other : JSON.stringify(other)}`
    return { kind: 'body-path', path: check.path, predicate: 'equalsPath', expected, actual, passed: found.length > 0 && otherFound.length > 0 && String(value) === String(other) }
  }
  if (check.matches !== undefined) {
    const expected = render(check.matches)
    return { kind: 'body-path', path: check.path, predicate: 'matches', expected, actual, passed: found.length > 0 && new RegExp(expected).test(String(value)) }
  }
  if (check.gt !== undefined || check.lt !== undefined) {
    const op = check.gt !== undefined ? 'gt' : 'lt'
    const raw = check.gt ?? check.lt
    const expected = typeof raw === 'string' ? render(raw) : String(raw)
    // числа сравниваются численно, строки — лексикографически (ISO-даты корректны)
    const bothNumeric = typeof value === 'number' && !Number.isNaN(Number(expected))
    const cmp = found.length === 0 ? 0 : bothNumeric ? Number(value) - Number(expected) : String(value) < expected ? -1 : String(value) > expected ? 1 : 0
    const passed = found.length > 0 && (op === 'gt' ? cmp > 0 : cmp < 0)
    return { kind: 'body-path', path: check.path, predicate: op, expected: `${op === 'gt' ? '>' : '<'} ${expected}`, actual, passed }
  }
  if (check.length !== undefined || check.minLength !== undefined || check.maxLength !== undefined) {
    const size = typeof value === 'string' || Array.isArray(value) ? value.length : null
    const predicate = check.length !== undefined ? 'length' : check.minLength !== undefined ? 'minLength' : 'maxLength'
    const bound = check.length ?? check.minLength ?? check.maxLength ?? 0
    const expected = predicate === 'length' ? `length ${bound}` : predicate === 'minLength' ? `length ≥ ${bound}` : `length ≤ ${bound}`
    const passed =
      size !== null && (predicate === 'length' ? size === bound : predicate === 'minLength' ? size >= bound : size <= bound)
    return { kind: 'body-path', path: check.path, predicate, expected, actual: size === null ? actual : `length ${size}`, passed }
  }
  const actualType = found.length === 0 ? null : value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
  return { kind: 'body-path', path: check.path, predicate: 'type', expected: String(check.type), actual: actualType, passed: actualType === check.type }
}

function failedLabels(outcome: Pick<StepResult, 'checks' | 'error'>): string[] {
  if (outcome.error) return [outcome.error.message]
  const labels: string[] = []
  let bodyIndex = 0
  for (const check of outcome.checks ?? []) {
    const isBody = check.kind === 'body-path' || check.kind === 'body-text'
    const label = check.kind === 'status' ? 'status' : check.kind === 'header' ? `headers.${check.name}` : `body[${bodyIndex}]`
    if (isBody) bodyIndex++
    if (!check.passed) labels.push(label)
  }
  return labels
}
