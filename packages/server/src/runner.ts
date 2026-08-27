import { setTimeout as sleep } from 'node:timers/promises'
import {
  isRequestStep,
  type CaptureResult,
  type CheckResult,
  type PartSnapshot,
  type RequestSnapshot,
  type RequestStep,
  type ResponseSnapshot,
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
import { evalChecks, failedLabels } from './checks.js'
import { jsonQuery } from './jsonpath.js'
import { buildMultipart } from './multipart.js'
import type { Project, Settings } from './config.js'
import type { EventBus } from './events.js'
import { stepRefs, type LoadedScenario } from './scenarios.js'
import { RunStore } from './storage.js'
import { MASK, TemplateSpace } from './template.js'
import { parseDuration } from './util.js'

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
  signal: AbortSignal // swapped between phases: main = stop or timeout, cleanup = stop only
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

  /** Starts a run in the background and returns its number immediately. */
  start(
    project: Project,
    loaded: LoadedScenario,
    overrides: Record<string, string>,
    hostName: string,
    baseUrl: string,
    trigger?: 'ci',
  ): { run: number; finished: Promise<RunRecord> } {
    if (!loaded.scenario) throw new Error('scenario is invalid')
    if (this.active.has(project.id)) throw new Error('a run is already in progress')

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
    // runTimeout aborts the main steps; a manual stop (signal) aborts everything
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
      trigger: record.trigger,
      vars: record.vars,
      varUsage: record.varUsage,
      steps: buildPlan(scenario),
    })

    const startedMs = Date.now()
    let failed: StepResult | undefined
    let internalError: string | undefined
    try {
      for (const [i, step] of scenario.steps.entries()) {
        let result: StepResult
        if (failed || ctx.signal.aborted) {
          result = { stepId: step.id, status: 'skipped' }
        } else {
          try {
            result = isRequestStep(step) ? await this.runRequest(ctx, step) : await this.runSleep(ctx, step)
          } catch (e) {
            // a step that blows up mid-flight (a JSONPath the library rejects, a
            // broken URL) fails naming itself: skipping it silently left the run
            // failed with no culprit and nothing to read
            result = {
              stepId: step.id,
              status: 'failed',
              error: { kind: 'internal', message: e instanceof Error ? e.message : String(e) },
            }
          }
        }
        this.publish(ctx, { type: 'step-finished', ...result })
        Object.assign(record.steps[i], result)
        if (result.status === 'failed' && !failed) failed = result
      }
    } catch (e) {
      // a scenario can still blow up mid-flight (a bad regex, a broken URL):
      // record it as a failed run instead of leaving the run hanging forever
      internalError = e instanceof Error ? e.message : String(e)
    }
    clearTimeout(timer)
    const timedOut = runAbort.signal.aborted && !signal.aborted
    ctx.signal = signal // only a manual stop interrupts cleanup

    // cleanup runs even after a failure (that is when it matters most);
    // a manual stop skips it, and a failed cleanup step does not skip its siblings
    let cleanupFailed = false
    const cleanupSteps = scenario.cleanup ?? []
    for (const [i, step] of cleanupSteps.entries()) {
      const recordIndex = scenario.steps.length + i
      let result: StepResult
      if (ctx.signal.aborted) {
        result = { stepId: step.id, status: 'skipped' }
      } else {
        try {
          result = isRequestStep(step) ? await this.runRequest(ctx, step) : await this.runSleep(ctx, step)
        } catch (e) {
          result = {
            stepId: step.id,
            status: 'failed',
            error: { kind: 'internal', message: e instanceof Error ? e.message : String(e) },
          }
        }
      }
      this.publish(ctx, { type: 'step-finished', ...result })
      Object.assign(record.steps[recordIndex], result)
      if (result.status === 'failed') cleanupFailed = true
    }

    record.durationMs = Date.now() - startedMs
    record.finishedAt = new Date().toISOString()
    record.status = signal.aborted ? 'stopped' : failed || timedOut || internalError ? 'failed' : 'passed'
    if (internalError) record.message = internalError
    else if (timedOut) record.message = `run timeout (${Math.round(ctx.project.runTimeoutMs / 1000)}s)`
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

    const url = new URL(
      step.request.url ? track('url', step.request.url) : ctx.baseUrl + track('url', step.request.path!),
    )
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

    // multipart is assembled as FormData: fetch writes the boundary into the
    // content type itself, so a header set by hand would break the request
    let form: FormData | undefined
    let parts: PartSnapshot[] | undefined
    if (step.request.multipart) {
      headers.delete('content-type')
      try {
        const built = buildMultipart(step.request.multipart, ctx.project.scenariosDir, track)
        form = built.form
        parts = built.parts.map((p) => ({
          ...p,
          ...(p.value !== undefined && { value: space.mask(p.value) }),
          ...(p.filename !== undefined && { filename: space.mask(p.filename) }),
        }))
      } catch (e) {
        // a missing or oversized fixture is the scenario's fault, not the API's
        return {
          status: 'failed',
          request: {
            method: step.request.method,
            url: space.mask(url.toString()),
            headers: Object.fromEntries([...headers].map(([k, v]) => [k, space.mask(v)])),
            body: null,
            contentType: 'multipart/form-data',
            substitutions,
          },
          response: null,
          checks: [],
          error: { kind: 'internal', message: e instanceof Error ? e.message : String(e) },
        }
      }
    }

    const snapshot = {
      method: step.request.method,
      url: space.mask(url.toString()),
      headers: Object.fromEntries([...headers].map(([k, v]) => [k, space.mask(v)])),
      body: body === null ? null : space.mask(body),
      contentType: form ? 'multipart/form-data' : headers.get('content-type'),
      substitutions,
      ...(parts && { parts }),
    }

    let res: Response
    const t0 = performance.now()
    try {
      res = await fetch(url, {
        method: step.request.method,
        headers,
        body: form ?? body,
        redirect: 'manual',
        signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(timeoutMs)]),
      })
    } catch (e) {
      if (ctx.signal.aborted) return { status: 'failed', request: snapshot }
      const cause = (e as { cause?: { code?: string } }).cause
      const message =
        (e as Error).name === 'TimeoutError' ? `timeout ${timeoutMs} ms` : (cause?.code ?? (e as Error).message)
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

    const stored = isText
      ? buf.subarray(0, ctx.bodyLimit).toString('utf8')
      : buf.subarray(0, ctx.bodyLimit).toString('base64')
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
        /* not JSON: body-path checks will report null */
      }
    }
    const checks = evalChecks(step.expect, res, text, json, (s) => space.render(s).text)
    if (!checks.every((c) => c.passed)) return { status: 'failed', request: snapshot, response, checks }

    const captures: CaptureResult[] = []
    let hidSecret = false
    for (const [name, spec] of Object.entries(step.capture ?? {})) {
      let value: string
      let detail: string
      if (spec.from === 'body') {
        if (spec.path) {
          // the path may reference earlier captures, same as a check does
          const path = space.render(spec.path).text
          const found: unknown[] = jsonQuery(path, json)
          value = found.length ? String(found[0]) : ''
          detail = path
        } else if (spec.regex) {
          value = safeExec(spec.regex, text)
          detail = `regex: ${spec.regex}`
        } else if (spec.json) {
          // a bare JSON scalar body: "guid" becomes guid instead of "guid"
          value =
            typeof json === 'string' || typeof json === 'number' || typeof json === 'boolean' ? String(json) : text
          detail = 'body as JSON'
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
      // a secret capture is masked everywhere: in the stored run, and in every
      // request snapshot that carries it — a live token must not sit in history
      const secret = spec.secret === true
      ctx.space.set(name, { value, fromStep: step.id, secret })
      captures.push({ name, from: spec.from, detail, value: secret ? MASK : value.slice(0, 4096) })
      if (secret) hidSecret = true
    }
    // a secret is captured after the checks ran, so the value it came from is
    // still spelled out in this step's own snapshot — hide it before storing
    return hidSecret
      ? { status: 'passed', ...maskStep(space, snapshot, response, checks), captures }
      : { status: 'passed', request: snapshot, response, checks, captures }
  }

  private publish(ctx: RunCtx, event: Record<string, unknown> & { type: string }): void {
    this.bus.publish({ project: ctx.project.id, scenario: ctx.scenario, run: ctx.run, ...event } as never)
  }
}

/** Masking keeps the check's shape: the union is discriminated by `kind`. */
function maskCheck(space: TemplateSpace, check: CheckResult): CheckResult {
  const expected = space.mask(check.expected)
  // only the status check always has a value; the rest may report nothing found
  if (check.kind === 'status') return { ...check, expected, actual: space.mask(check.actual) }
  const actual = check.actual === null ? null : space.mask(check.actual)
  if (check.kind === 'header') return { ...check, expected, actual }
  if (check.kind === 'body-path') return { ...check, expected, actual }
  return { ...check, expected, actual }
}

/** Re-masks a finished step once a secret capture revealed what to hide. */
function maskStep(
  space: TemplateSpace,
  request: RequestSnapshot | null,
  response: ResponseSnapshot,
  checks: CheckResult[],
): { request: RequestSnapshot | null; response: ResponseSnapshot; checks: CheckResult[] } {
  return {
    request: request && {
      ...request,
      url: space.mask(request.url),
      headers: Object.fromEntries(Object.entries(request.headers).map(([k, v]) => [k, space.mask(v)])),
      body: request.body === null ? null : space.mask(request.body),
      ...(request.parts && {
        parts: request.parts.map((p) => (p.value === undefined ? p : { ...p, value: space.mask(p.value) })),
      }),
    },
    response: {
      ...response,
      headers: Object.fromEntries(Object.entries(response.headers).map(([k, v]) => [k, space.mask(v)])),
      body: space.mask(response.body),
    },
    checks: checks.map((c) => maskCheck(space, c)),
  }
}

/** First capture group of a scenario regex; a malformed pattern captures nothing instead of throwing. */
function safeExec(pattern: string, text: string): string {
  try {
    return new RegExp(pattern).exec(text)?.[1] ?? ''
  } catch {
    return ''
  }
}

function initVars(scenario: Scenario, overrides: Record<string, string>, space: TemplateSpace): RunVar[] {
  const vars: RunVar[] = []
  for (const [name, def] of Object.entries(scenario.vars ?? {})) {
    const secret = def.secret ?? false
    const override = Object.hasOwn(overrides, name) ? overrides[name] : undefined
    const value = space.render(override ?? String(def.default ?? '')).text
    space.set(name, { value, fromStep: null, secret })
    vars.push({
      name,
      value: secret ? '•••' : value,
      ...(secret && { secret }),
      source: override !== undefined ? 'manual' : 'default',
    })
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
