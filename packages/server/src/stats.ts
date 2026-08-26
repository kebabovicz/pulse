import type {
  ChainRun,
  FlakyStep,
  ProjectStats,
  RunIndexEntry,
  RunRecord,
  ScenarioStats,
  SlowStep,
  StaleScenario,
  StepStats,
} from '@pulse/shared'
import { RunStore } from './storage.js'

/** Fewer runs than this and a median says nothing, so nothing is shown. */
const MIN_RUNS = 5

/** A duration change is reported only when it is both relatively and absolutely visible. */
const MIN_DELTA_SHARE = 0.1
const MIN_DELTA_MS = 20

/** Slowest tenth of the runs: the tail that a median hides. */
function p90(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.9) - 1)]
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid]
}

/**
 * Median of the newer half of the window against the older half. Returns nulls
 * when either half is too small to mean anything, or when the change is noise.
 */
function trend(values: number[]): { deltaMs: number | null; deltaPct: number | null } {
  const half = Math.floor(values.length / 2)
  if (half < 2) return { deltaMs: null, deltaPct: null }
  const older = median(values.slice(0, half))
  const newer = median(values.slice(values.length - half))
  if (older === null || newer === null || older === 0) return { deltaMs: null, deltaPct: null }
  const deltaMs = newer - older
  const share = Math.abs(deltaMs) / older
  if (Math.abs(deltaMs) < MIN_DELTA_MS || share < MIN_DELTA_SHARE) return { deltaMs: null, deltaPct: null }
  return { deltaMs, deltaPct: Math.round((deltaMs / older) * 100) }
}

interface StepSamples {
  method?: string
  path?: string
  durations: number[]
  failures: number
  retried: number
  counted: number
}

/** Pauses are constants from the file: they neither degrade nor fail. */
const isMeasurable = (step: RunRecord['steps'][number]): boolean => step.kind !== 'sleep'

function collectSteps(records: RunRecord[]): StepStats[] {
  const samples = new Map<string, StepSamples>()
  for (const record of records) {
    for (const step of record.steps) {
      if (!isMeasurable(step)) continue
      const entry = samples.get(step.stepId) ?? {
        method: step.kind === 'request' ? step.method : undefined,
        path: step.kind === 'request' ? step.path : undefined,
        durations: [],
        failures: 0,
        retried: 0,
        counted: 0,
      }
      entry.counted++
      if (step.durationMs != null) entry.durations.push(step.durationMs)
      if (step.status === 'failed') entry.failures++
      if ((step.attempts ?? 1) > 1 && step.status === 'passed') entry.retried++
      samples.set(step.stepId, entry)
    }
  }
  return [...samples].map(([stepId, s]) => ({
    stepId,
    method: s.method,
    path: s.path,
    medianMs: median(s.durations),
    p90Ms: p90(s.durations),
    ...trend(s.durations),
    failures: s.failures,
    retried: s.retried,
    counted: s.counted,
  }))
}

/**
 * Runs older than the last change of the scenario file are shown in the chain
 * but left out of every number: comparing them to the current file is meaningless.
 */
function inScope(entries: RunIndexEntry[]): RunIndexEntry[] {
  const currentHash = entries.at(-1)?.scenarioHash
  let changedAt = -1
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].scenarioHash !== currentHash) {
      changedAt = i
      break
    }
  }
  return entries.slice(changedAt + 1)
}

function scenarioStats(
  store: RunStore,
  projectId: string,
  scenario: string,
  name: string,
  windowed: RunIndexEntry[],
): ScenarioStats {
  const key = RunStore.scenarioKey(scenario)
  const counted = inScope(windowed)
  const chain: ChainRun[] = windowed.map((e) => ({
    run: e.run,
    status: e.status,
    counted: counted.some((c) => c.run === e.run),
  }))
  const lastFailureEntry = [...windowed].reverse().find((e) => e.status === 'failed')
  const enough = counted.length >= MIN_RUNS
  const durations = counted.map((e) => e.durationMs)
  const records = enough
    ? counted.map((e) => store.getRun(projectId, key, e.run)).filter((r): r is RunRecord => r !== undefined)
    : []

  return {
    scenario,
    name,
    counted: counted.length,
    total: windowed.length,
    chain,
    passRate: enough ? counted.filter((e) => e.status === 'passed').length / counted.length : null,
    medianMs: enough ? median(durations) : null,
    ...(enough ? trend(durations) : { deltaMs: null, deltaPct: null }),
    lastFailure: lastFailureEntry && {
      run: lastFailureEntry.run,
      startedAt: lastFailureEntry.startedAt,
      counted: counted.some((c) => c.run === lastFailureEntry.run),
    },
    steps: collectSteps(records),
  }
}

/** Steps that pass only on a retry while their scenario looks perfectly healthy. */
function flakySteps(scenarios: ScenarioStats[], store: RunStore, projectId: string): FlakyStep[] {
  const flaky: FlakyStep[] = []
  for (const s of scenarios) {
    if (s.passRate !== 1) continue // a failing scenario is already at the top of the table
    for (const step of s.steps) {
      if (step.retried === 0) continue
      const key = RunStore.scenarioKey(s.scenario)
      const lastRun = [...s.chain]
        .reverse()
        .find(
          (c) =>
            c.counted &&
            store.getRun(projectId, key, c.run)?.steps.some((r) => r.stepId === step.stepId && (r.attempts ?? 1) > 1),
        )
      if (!lastRun) continue
      const record = store.getRun(projectId, key, lastRun.run)
      flaky.push({
        scenario: s.scenario,
        stepId: step.stepId,
        method: step.method,
        path: step.path,
        rate: step.retried / step.counted,
        retried: step.retried,
        counted: step.counted,
        lastRun: { run: lastRun.run, startedAt: record?.startedAt ?? '' },
      })
    }
  }
  return flaky.sort((a, b) => b.rate - a.rate)
}

/** How many entries each supporting table shows before it becomes a wall of text. */
const TOP_N = 6

/** A tail twice the median is a real swing, not measurement noise. */
const SPREAD_RATIO = 2
const SPREAD_MIN_MS = 50

/** A scenario untouched for this long is green only because nobody ran it. */
const STALE_DAYS = 7

const stepsOf = (scenarios: ScenarioStats[]): (StepStats & { scenario: string; spread: number })[] =>
  scenarios.flatMap((s) =>
    s.steps
      .filter((step): step is StepStats & { medianMs: number } => step.medianMs !== null && step.medianMs > 0)
      .map((step) => ({
        ...step,
        scenario: s.scenario,
        spread: step.p90Ms !== null ? step.p90Ms / step.medianMs : 1,
      })),
  )

/** The slowest endpoints of the project — the question a green project asks. */
function slowestSteps(scenarios: ScenarioStats[]): SlowStep[] {
  return stepsOf(scenarios)
    .sort((a, b) => b.medianMs - a.medianMs)
    .slice(0, TOP_N)
    .map(({ scenario, stepId, method, path, medianMs, spread, counted }) => ({
      scenario,
      stepId,
      method,
      path,
      medianMs: medianMs!,
      spread,
      counted,
    }))
}

/** Steps whose time swings: stable 300 ms and "either 100 or 900" are different things. */
function unstableSteps(scenarios: ScenarioStats[]): SlowStep[] {
  return stepsOf(scenarios)
    .filter((step) => step.medianMs! >= SPREAD_MIN_MS && step.spread >= SPREAD_RATIO)
    .sort((a, b) => b.spread - a.spread)
    .slice(0, TOP_N)
    .map(({ scenario, stepId, method, path, medianMs, spread, counted }) => ({
      scenario,
      stepId,
      method,
      path,
      medianMs: medianMs!,
      spread,
      counted,
    }))
}

/** Sorted by how much the scenario slowed down, then by how often it fails. */
function bySeverity(a: ScenarioStats, b: ScenarioStats): number {
  const slow = (s: ScenarioStats) => s.deltaPct ?? -Infinity
  if (slow(a) !== slow(b)) return slow(b) - slow(a)
  return (a.passRate ?? 2) - (b.passRate ?? 2)
}

export function projectStats(
  store: RunStore,
  projectId: string,
  scenarios: { path: string; name: string }[],
  window: number,
  host: string | null,
): ProjectStats {
  // one read of every index: hosts, the window and the date range all come from it
  const indexes = scenarios.map((s) => ({ ...s, entries: store.readIndex(projectId, RunStore.scenarioKey(s.path)) }))
  const hosts = [
    ...new Set(indexes.flatMap((i) => i.entries.map((e) => e.host).filter((h): h is string => Boolean(h)))),
  ]
  hosts.sort()

  const windows = indexes
    .map((i) => ({ ...i, windowed: (host ? i.entries.filter((e) => e.host === host) : i.entries).slice(-window) }))
    .filter((i) => i.windowed.length > 0)

  const stats = windows.map((i) => scenarioStats(store, projectId, i.path, i.name, i.windowed)).sort(bySeverity)
  const dates = windows.flatMap((i) => i.windowed.map((e) => e.startedAt)).sort()

  const dayMs = 86_400_000
  const stale: StaleScenario[] = windows
    .map((i) => ({ item: i, last: i.windowed.at(-1) }))
    .filter((x) => x.last !== undefined)
    .map(({ item, last }) => ({
      scenario: item.path,
      name: item.name,
      run: last!.run,
      lastRunAt: last!.startedAt,
      days: Math.floor((Date.now() - Date.parse(last!.startedAt)) / dayMs),
    }))
    .filter((s) => s.days >= STALE_DAYS)
    .sort((a, b) => b.days - a.days)

  return {
    window,
    host,
    hosts,
    scenarios: stats,
    flaky: flakySteps(stats, store, projectId),
    slowest: slowestSteps(stats),
    unstable: unstableSteps(stats),
    stale,
    runs: windows.reduce((sum, i) => sum + i.windowed.length, 0),
    from: dates[0],
    to: dates.at(-1),
    minRuns: MIN_RUNS,
  }
}
