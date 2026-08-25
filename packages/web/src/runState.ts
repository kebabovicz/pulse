import type { CheckResult, PulseEvent, RunRecord, RunStatus, RunVar, StepPlan, StepResult, VarUsage } from '@pulse/shared'

// Состояние экрана прогона = свёртка потока событий (spec/events.md).
// Живой прогон кормится редьюсером, исторический — fromRecord; экран один.

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
 * Заготовка до события run-started: run === -1 означает «жду ближайший
 * run-started этого сценария» — события SSE могут прийти раньше ответа POST /run.
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

export const fmtMs = (ms: number): string => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`)

export const fmtTotal = (ms: number): string => {
  const s = ms / 1000
  const mm = String(Math.floor(s / 60)).padStart(2, '0')
  return `${mm}:${(s % 60).toFixed(1).padStart(4, '0')}`
}

/** «3s» → «3 s» для показа; не парсит, только оформляет. */
export const parseDurationLabel = (d: string): string => d.replace(/(\d+)(ms|s|m)/, '$1 $2')

/** Имя файла сценария без папок и расширения — главный идентификатор в UI. */
export const fileLabel = (path: string): string => path.split('/').pop()!.replace(/\.ya?ml$/, '')
