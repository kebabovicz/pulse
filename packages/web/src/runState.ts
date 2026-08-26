import { dateLocale, t } from './i18n'
import type {
  CheckResult,
  PulseEvent,
  RunRecord,
  RunStatus,
  RunVar,
  StepPlan,
  StepResult,
  VarUsage,
} from '@pulse/shared'

// Run screen state is a fold of the event stream (spec/events.md).
// A live run is fed through the reducer, a stored one through fromRecord; one screen for both.

export type StepViewStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped'

export interface StepView extends StepPlan {
  status: StepViewStatus
  attempt?: number
  remainingMs?: number
  result?: StepResult
}

export interface RunState {
  run: number
  scenario: string
  scenarioName: string
  host?: string
  status: 'running' | RunStatus
  startedAt: string
  durationMs?: number
  failedStep?: string
  failedCheck?: CheckResult
  cleanupFailed?: boolean
  message?: string
  vars: RunVar[]
  varUsage: VarUsage
  steps: StepView[]
}

export function fromRecord(record: RunRecord): RunState {
  return {
    run: record.run,
    scenario: record.scenario,
    scenarioName: record.scenarioName,
    host: record.host,
    status: record.status,
    startedAt: record.startedAt,
    durationMs: record.durationMs,
    failedStep: record.failedStep,
    failedCheck: record.failedCheck,
    cleanupFailed: record.cleanupFailed,
    message: record.message,
    vars: record.vars,
    varUsage: record.varUsage,
    steps: record.steps.map((s) => ({ ...s, result: s, status: s.status })),
  }
}

/**
 * Placeholder until run-started arrives: run === -1 means "adopt the next
 * run-started of this scenario" — SSE events can outrun the POST /run response.
 */
export function pendingRun(scenario: string): RunState {
  return {
    run: -1,
    scenario,
    scenarioName: '',
    status: 'running',
    startedAt: new Date().toISOString(),
    vars: [],
    varUsage: {},
    steps: [],
  }
}

export function reduce(state: RunState, event: PulseEvent): RunState {
  if (!('run' in event) || event.scenario !== state.scenario) return state
  if (state.run === -1 && event.type !== 'run-started') return state
  if (state.run !== -1 && event.run !== state.run) return state
  switch (event.type) {
    case 'run-started':
      return {
        ...state,
        run: event.run,
        scenarioName: event.scenarioName,
        startedAt: event.ts,
        vars: event.vars,
        varUsage: event.varUsage,
        steps: event.steps.map((s) => ({ ...s, status: 'pending' })),
      }
    case 'step-started':
      return patchStep(state, event.stepId, { status: 'running', attempt: event.attempt })
    case 'step-progress':
      return patchStep(state, event.stepId, { remainingMs: event.remainingMs })
    case 'step-retry':
      return patchStep(state, event.stepId, { attempt: event.attempt })
    case 'step-finished': {
      const { type: _type, ts: _ts, project: _p, scenario: _s, run: _r, ...result } = event
      return patchStep(state, event.stepId, { status: event.status, result, remainingMs: undefined })
    }
    case 'run-finished':
      return {
        ...state,
        status: event.status,
        durationMs: event.durationMs,
        failedStep: event.failedStep,
        failedCheck: event.failedCheck,
        cleanupFailed: event.cleanupFailed,
        message: event.message,
      }
    default:
      return state
  }
}

function patchStep(state: RunState, stepId: string, patch: Partial<StepView>): RunState {
  return { ...state, steps: state.steps.map((s) => (s.id === stepId ? { ...s, ...patch } : s)) }
}

/** "today 12:04", "yesterday 11:13" or "25.08 16:29" — the app's one date format. */
export function relativeWhen(iso: string): string {
  const when = new Date(iso)
  const time = when.toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' })
  const day = when.toDateString()
  const now = new Date()
  if (day === now.toDateString()) return `${t('today')} ${time}`
  if (day === new Date(now.getTime() - 86_400_000).toDateString()) return `${t('yesterday')} ${time}`
  return `${when.toLocaleDateString(dateLocale, { day: '2-digit', month: '2-digit' })} ${time}`
}

export const fmtMs = (ms: number): string => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`)

export const fmtTotal = (ms: number): string => {
  const s = ms / 1000
  const mm = String(Math.floor(s / 60)).padStart(2, '0')
  return `${mm}:${(s % 60).toFixed(1).padStart(4, '0')}`
}

/** Formats "3s" as "3 s" for display; no parsing involved. */
export const parseDurationLabel = (d: string): string => d.replace(/(\d+)(ms|s|m)/, '$1 $2')

/** Scenario file name without folders or extension — the primary identifier in the UI. */
export const fileLabel = (path: string): string =>
  path
    .split('/')
    .pop()!
    .replace(/\.ya?ml$/, '')
