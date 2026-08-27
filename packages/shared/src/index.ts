// Pulse domain types. SPEC.md and spec/*.md are the source of truth; keep them in sync.

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

// ── Scenario (SPEC.md) ──────────────────────────────────────────────────────

export interface VarDef {
  default?: string | number | boolean
  secret?: boolean
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'

export interface RequestSpec {
  method: HttpMethod
  path?: string
  url?: string
  query?: Record<string, string | number | boolean>
  headers?: Record<string, string>
  body?: Json
  contentType?: string
  multipart?: Record<string, MultipartPart | MultipartPart[]>
}

/** A multipart/form-data part: a plain field value, or a file from one of three sources. */
export type MultipartPart =
  | string
  | number
  | boolean
  | ({ filename?: string; contentType?: string } & (
      | { file: string } // path inside the project's scenarios folder
      | { text: string } // inline content, interpolated
      | { base64: string } // inline binary
    ))

export type ValueType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null'

export type BodyCheck =
  | {
      path: string
      exists?: boolean
      equals?: string | number | boolean | null
      notEquals?: string | number | boolean | null
      equalsPath?: string
      matches?: string
      type?: ValueType
      gt?: string | number
      lt?: string | number
      length?: number
      minLength?: number
      maxLength?: number
    }
  | { text: true; matches: string }

export interface ExpectSpec {
  status: number | number[]
  headers?: Record<string, string | null> // null means the header must be absent
  body?: BodyCheck[]
}

export type CaptureSpec =
  | { from: 'body'; path?: string; regex?: string; json?: boolean; secret?: boolean }
  | { from: 'header' | 'cookie'; name: string; secret?: boolean }

export interface CookiesSpec {
  clear?: true
  set?: Record<string, string>
}

export interface RetrySpec {
  attempts: number
  delay: string
}

interface StepBase {
  id: string
  name?: string
}

export interface RequestStep extends StepBase {
  request: RequestSpec
  expect: ExpectSpec
  capture?: Record<string, CaptureSpec>
  cookies?: CookiesSpec
  retry?: RetrySpec
  timeout?: string
  /** Reuse what this step captured across runs for this long — a sign-in every
   *  scenario repeats otherwise (SPEC.md). */
  cache?: string
}

export interface SleepStep extends StepBase {
  sleep: string
}

export type Step = RequestStep | SleepStep

export const isRequestStep = (step: Step): step is RequestStep => 'request' in step

export interface Scenario {
  name: string
  description?: string
  vars?: Record<string, VarDef>
  steps: Step[]
  cleanup?: Step[] // always run after the main steps (unless stopped manually)
}

// ── Lists and states (API) ──────────────────────────────────────────────────

export interface HealthState {
  status: 'up' | 'down' | 'unknown'
  reason?: string
  checkedAt?: string
}

export interface ScenarioError {
  message: string
  line?: number
  column?: number
}

export interface ScenarioSummary {
  path: string // relative to the project's scenarios folder
  name: string
  stepCount: number
  valid: boolean
  error?: ScenarioError
  modifiedAt: string
  hash: string // sha256 of the file; comparing it with runs reveals "file changed"
}

/** A scenario list row: file summary plus the outcome of the last run. */
export interface ScenarioListItem extends ScenarioSummary {
  lastRun?: Pick<RunIndexEntry, 'run' | 'status' | 'durationMs' | 'startedAt' | 'failedStep'> & {
    slow?: boolean // took noticeably longer than this scenario usually takes
  }
  ci: boolean // part of the deploy suite (executed by /ci/run)
}

export interface ProjectView {
  id: string
  name: string
  hosts: Record<string, string> // host name -> base URL (config plus UI-added)
  customHosts: string[] // names of UI-added hosts (these can be removed)
  activeHost: string
  baseUrl: string // URL of the active host
  health: HealthState
}

// ── Run (spec/events.md) ────────────────────────────────────────────────────

export type VarSource = 'default' | 'manual' | 'remembered'

export interface RunVar {
  name: string
  value: string
  secret?: boolean
  source: VarSource
}

export type VarUsage = Record<string, { capturedBy: string; usedBy: string[] }>

export interface StepPlan {
  id: string
  name: string | null
  cleanup?: boolean // the step comes from the cleanup section
  kind: 'request' | 'sleep'
  method?: HttpMethod
  path?: string
  durationMs?: number
  retry?: { attempts: number; delayMs: number } | null
}

export interface Substitution {
  location: string // "headers.Authorization", "body", "cookies.refreshToken"
  var: string
  fromStep: string | null // null means the value came from vars
}

export interface RequestSnapshot {
  method: HttpMethod
  url: string
  headers: Record<string, string>
  body: string | null
  contentType: string | null
  substitutions: Substitution[]
  parts?: PartSnapshot[] // multipart request: the parts instead of the assembled bytes
}

/** One part of a sent multipart request, as the UI and the history show it. */
export interface PartSnapshot {
  name: string
  value?: string // plain field: the value itself
  filename?: string // file part
  contentType?: string
  sizeBytes?: number
  source?: string // where the bytes came from: a fixture path, "inline" or "base64"
}

export interface ResponseSnapshot {
  status: number
  durationMs: number
  sizeBytes: number
  contentType: string | null
  headers: Record<string, string>
  body: string
  bodyEncoding?: 'base64'
  bodyTruncated: boolean
}

export type CheckResult =
  | { kind: 'status'; expected: string; actual: string; passed: boolean }
  | { kind: 'header'; name: string; expected: string; actual: string | null; passed: boolean }
  | {
      kind: 'body-path'
      path: string
      predicate:
        | 'exists'
        | 'equals'
        | 'notEquals'
        | 'equalsPath'
        | 'matches'
        | 'type'
        | 'gt'
        | 'lt'
        | 'length'
        | 'minLength'
        | 'maxLength'
      expected: string
      actual: string | null
      passed: boolean
    }
  | { kind: 'body-text'; expected: string; actual: string | null; passed: boolean }

export interface CaptureResult {
  name: string
  from: 'body' | 'header' | 'cookie'
  detail: string
  value: string
}

export type StepStatus = 'passed' | 'failed' | 'skipped'
export type RunStatus = 'passed' | 'failed' | 'stopped' | 'error'

export interface StepError {
  kind: 'network' | 'internal'
  message: string
}

export interface StepResult {
  stepId: string
  status: StepStatus
  cached?: boolean // served from the shared cache: nothing was sent
  startedAt?: string
  durationMs?: number
  attempts?: number
  request?: RequestSnapshot | null
  response?: ResponseSnapshot | null
  checks?: CheckResult[]
  captures?: CaptureResult[]
  error?: StepError | null
}

// ── Events (spec/events.md) ─────────────────────────────────────────────────

interface EventBase {
  ts: string
  project: string
}

interface RunEventBase extends EventBase {
  scenario: string
  run: number
}

export type PulseEvent =
  | (EventBase & { type: 'health-changed'; status: 'up' | 'down'; reason?: string })
  | (EventBase & {
      type: 'scenario-changed'
      path: string
      action: 'added' | 'updated' | 'removed'
      summary?: ScenarioSummary
    })
  | (RunEventBase & {
      type: 'run-started'
      scenarioName: string
      scenarioHash: string
      host?: string
      /** the deploy endpoint started it, not a human */
      trigger?: 'ci'
      vars: RunVar[]
      varUsage: VarUsage
      steps: StepPlan[]
    })
  | (RunEventBase & { type: 'step-started'; stepId: string; attempt: number })
  | (RunEventBase & { type: 'step-progress'; stepId: string; remainingMs: number })
  | (RunEventBase & {
      type: 'step-retry'
      stepId: string
      attempt: number
      maxAttempts: number
      failed: string[]
      nextDelayMs: number
    })
  | (RunEventBase & { type: 'step-finished' } & StepResult)
  | (RunEventBase & {
      type: 'run-finished'
      status: RunStatus
      durationMs: number
      failedStep?: string
      failedCheck?: CheckResult
      cleanupFailed?: boolean
      message?: string
    })

export type PulseEventDraft = DistributiveOmit<PulseEvent, 'ts'>

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never

// ── Storage (spec/config.md) ────────────────────────────────────────────────

export interface RunRecord {
  run: number
  project: string
  scenario: string
  scenarioName: string
  scenarioHash: string
  host?: string // name of the host the run went against
  trigger?: 'ci' // the run was started by the deploy endpoint, not by hand
  startedAt: string
  finishedAt: string
  status: RunStatus
  durationMs: number
  failedStep?: string
  failedCheck?: CheckResult
  cleanupFailed?: boolean // a failed cleanup does not change the verdict, it only flags the run
  message?: string
  vars: RunVar[]
  varUsage: VarUsage
  steps: (StepPlan & StepResult)[]
}

// ── Project statistics (Statistics tab) ────────────────────────────────────

/** One run in the pass/fail chain drawn next to a scenario. */
export interface ChainRun {
  run: number
  status: RunStatus
  /** false for runs older than the last change of the scenario file: shown, not counted */
  counted: boolean
}

export interface StepStats {
  stepId: string
  method?: string
  path?: string
  medianMs: number | null
  /** the slow tail: how long the step takes in its worst tenth of runs */
  p90Ms: number | null
  /** median of the newer half against the older half of the window */
  deltaMs: number | null
  deltaPct: number | null
  failures: number
  retried: number
  counted: number
}

export interface ScenarioStats {
  scenario: string
  name: string
  /** runs that count towards the numbers, and how many were in the window at all */
  counted: number
  total: number
  chain: ChainRun[]
  passRate: number | null
  medianMs: number | null
  deltaMs: number | null
  deltaPct: number | null
  lastFailure?: { run: number; startedAt: string; counted: boolean }
  steps: StepStats[]
}

/** A step listed among the slowest endpoints of the project. */
export interface SlowStep {
  scenario: string
  stepId: string
  method?: string
  path?: string
  medianMs: number
  /** p90 / median: how much the slow tail exceeds the usual time */
  spread: number
  counted: number
}

/** A scenario nobody has run for a while: green only because it stands still. */
export interface StaleScenario {
  scenario: string
  name: string
  run: number
  lastRunAt: string
  days: number
}

/** A step that passes only on a retry inside a scenario that looks healthy. */
export interface FlakyStep {
  scenario: string
  stepId: string
  method?: string
  path?: string
  rate: number
  retried: number
  counted: number
  lastRun: { run: number; startedAt: string }
}

export interface ProjectStats {
  window: number
  host: string | null
  hosts: string[]
  scenarios: ScenarioStats[]
  flaky: FlakyStep[]
  slowest: SlowStep[]
  unstable: SlowStep[]
  stale: StaleScenario[]
  runs: number
  from?: string
  to?: string
  /** below this many counted runs the numbers are not shown at all */
  minRuns: number
}

export interface RunsGroup {
  scenario: string // relative file path
  name: string
  runs: RunIndexEntry[] // newest first
}

export interface RunIndexEntry {
  run: number
  startedAt: string
  status: RunStatus
  durationMs: number
  failedStep?: string
  stepStatuses: StepStatus[]
  scenarioHash: string
  host?: string
  trigger?: 'ci'
}
