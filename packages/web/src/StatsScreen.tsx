import { useEffect, useState } from 'react'
import type {
  ChainRun,
  FlakyStep,
  ProjectStats,
  ScenarioStats,
  SlowStep,
  StaleScenario,
  StepStats,
} from '@pulse/shared'
import { fetchStats } from './api'
import { ChevronDown } from './icons'
import { t } from './i18n'
import { fmtMs, relativeWhen } from './runState'
import { colWidth, cols } from './ui/columns'

const WINDOWS = [20, 50, 100, 200]

const pct = (share: number): string => `${Math.round(share * 100)} %`

/** Colour follows the number: nothing green until four runs out of five pass. */
function passClass(rate: number | null): string {
  if (rate === null) return 'muted'
  const percent = Math.round(rate * 100)
  if (percent === 0) return 'muted'
  if (percent <= 40) return 'bad'
  if (percent < 80) return 'warn'
  return 'ok'
}

/** Nothing to report is written as a dash, never as a zero. */
const dash = '—'

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' })
}

/** The run chain: newest on the right, runs outside the count greyed out. */
function Chain({ chain }: { chain: ChainRun[] }) {
  const shown = chain.slice(-50)
  return (
    <span className="chain">
      {shown.map((run, i) => {
        const boundary = i > 0 && !shown[i - 1].counted && run.counted
        return (
          <span
            key={run.run}
            className={`chain-run ${run.counted ? run.status : 'outside'}${run.retried ? ' retried' : ''}${boundary ? ' boundary' : ''}`}
          />
        )
      })}
    </span>
  )
}

/** Percent first, absolute second: +30 % on a fast step matters more than +200 ms on a slow one. */
function Delta({ pctValue, ms }: { pctValue: number | null; ms: number | null }) {
  if (pctValue === null || ms === null) return <span className="muted">{ms === null ? dash : '0 %'}</span>
  return (
    <>
      <span className={pctValue > 0 ? 'warn' : 'ok'}>
        {pctValue > 0 ? '+' : '−'}
        {Math.abs(pctValue)} %
      </span>
      <span className="muted stats-abs">
        {' · '}
        {ms > 0 ? '+' : '−'}
        {fmtMs(Math.abs(ms))}
      </span>
    </>
  )
}

/** A step is worth a line only when something about it changed. */
const hasDeviation = (step: StepStats): boolean => step.deltaPct !== null || step.failures > 0 || step.retried > 0

function StepRows({ steps }: { steps: StepStats[] }) {
  const [showRest, setShowRest] = useState(false)
  const deviating = steps.filter(hasDeviation)
  const rest = steps.length - deviating.length
  const shown = showRest ? steps : deviating

  return (
    <div className="stats-nested">
      <div className="stats-step head">
        <span>{t('stepWord')}</span>
        <span className="muted">{t('onlyWithDeviation')}</span>
        <span>{t('failuresCol')}</span>
        <span>{t('median')}</span>
        <span>{t('deltaMedian')}</span>
        <span>{t('retriedCol')}</span>
      </div>
      {shown.map((step) => (
        <div key={step.stepId} className="stats-step">
          <StepCell step={step} />
          <span className={`mono${step.failures > 0 ? ' bad' : ' muted'}`}>
            {step.failures > 0 ? `${step.failures} / ${step.counted}` : dash}
          </span>
          <span className="mono">{step.medianMs === null ? dash : fmtMs(step.medianMs)}</span>
          <span className="mono">
            <Delta pctValue={step.deltaPct} ms={step.deltaMs} />
          </span>
          <span className={`mono${step.retried > 0 ? ' warn' : ' muted'}`}>
            {step.retried > 0 ? `${step.retried} / ${step.counted}` : dash}
          </span>
        </div>
      ))}
      {rest > 0 && (
        <button className="stats-rest link" onClick={() => setShowRest(!showRest)}>
          {showRest ? t('hideUnchanged') : t('restUnchanged', rest)}
        </button>
      )}
    </div>
  )
}

function ScenarioRow({
  stats,
  open,
  onToggle,
  onOpenRun,
}: {
  stats: ScenarioStats
  open: boolean
  onToggle: () => void
  onOpenRun: (scenario: string, run: number) => void
}) {
  const failing = stats.passRate !== null && stats.passRate < 1
  const calm = stats.passRate === 1 && stats.deltaPct === null
  const expandable = stats.steps.length > 0
  return (
    <>
      <div
        className={`stats-row${failing ? ' failing' : ''}${calm ? ' calm' : ''}${open ? ' open' : ''}`}
        style={expandable ? undefined : { cursor: 'default' }}
        onClick={expandable ? onToggle : undefined}
      >
        <span className={`stats-chevron${open ? ' open' : ''}`}>{expandable && <ChevronDown size={12} />}</span>
        <span className="stats-name">{stats.name}</span>
        <span className={`mono${stats.counted < stats.total ? ' warn' : ' muted'}`}>
          {stats.counted} / {stats.total}
        </span>
        <Chain chain={stats.chain} />
        <span className={`mono ${passClass(stats.passRate)}`}>
          {stats.passRate === null ? dash : pct(stats.passRate)}
        </span>
        <span className={`mono${stats.medianMs === null ? ' muted' : ''}`}>
          {stats.medianMs === null ? dash : fmtMs(stats.medianMs)}
        </span>
        <span className="mono">
          <Delta pctValue={stats.deltaPct} ms={stats.deltaMs} />
        </span>
        <span className="mono stats-last">
          {stats.lastFailure ? (
            <button
              className={stats.lastFailure.counted ? 'link' : 'link muted'}
              onClick={(e) => {
                e.stopPropagation()
                onOpenRun(stats.scenario, stats.lastFailure!.run)
              }}
            >
              #{stats.lastFailure.run} · {relativeWhen(stats.lastFailure.startedAt)}
            </button>
          ) : (
            <span className="muted">{dash}</span>
          )}
        </span>
      </div>
      {open && expandable && <StepRows steps={stats.steps} />}
    </>
  )
}

function FlakyTable({ rows, onOpenRun }: { rows: FlakyStep[]; onOpenRun: (scenario: string, run: number) => void }) {
  return (
    <section className="scn-section">
      <header>{t('notFirstTry')}</header>
      <div className="stats-flaky head">
        <span>{t('scenarioCol')}</span>
        <span>{t('stepWord')}</span>
        <span />
        <span>{t('retriedCol')}</span>
        <span>{t('lastRunCol')}</span>
      </div>
      {rows.map((row) => (
        <div key={`${row.scenario}/${row.stepId}`} className="stats-flaky">
          <ScenarioCell name={row.name} path={row.scenario} />
          <StepCell step={row} />
          <span className="mono">
            <span className="warn">{pct(row.rate)}</span>
            <span className="muted stats-abs">
              {' · '}
              {row.retried} / {row.counted}
            </span>
          </span>
          <span className="mono">
            <button className="link" onClick={() => onOpenRun(row.scenario, row.lastRun.run)}>
              #{row.lastRun.run} · {relativeWhen(row.lastRun.startedAt)}
            </button>
          </span>
        </div>
      ))}
    </section>
  )
}

/** The scenario leads with its own name; the file it lives in follows underneath. */
function ScenarioCell({ name, path }: { name: string; path: string }) {
  return (
    <span className="stats-scenario">
      <span className="stats-scenario-name">{name}</span>
      <span className="muted stats-scenario-path">{path.replace(/\.ya?ml$/, '')}</span>
    </span>
  )
}

/**
 * Two cells, not one: the id keeps its own column and wraps onto further lines,
 * so requests below it stay in a column of their own.
 */
function StepCell({ step }: { step: { stepId: string; method?: string; path?: string } }) {
  return (
    <>
      <span className="stats-step-id">{step.stepId}</span>
      <span className="muted stats-req">{step.path ? `${step.method ?? ''} ${step.path}` : ''}</span>
    </>
  )
}

/** Where the time goes and where it swings — the questions a green project asks. */
function StepsTable({ title, rows, metric }: { title: string; rows: SlowStep[]; metric: 'median' | 'spread' }) {
  return (
    <section className="scn-section">
      <header>{title}</header>
      <div className="stats-flaky head">
        <span>{t('scenarioCol')}</span>
        <span>{t('stepWord')}</span>
        <span />
        <span>{metric === 'median' ? t('median') : t('spreadCol')}</span>
        <span>{metric === 'median' ? t('spreadCol') : t('median')}</span>
      </div>
      {rows.map((row) => (
        <div key={`${row.scenario}/${row.stepId}`} className="stats-flaky">
          <ScenarioCell name={row.name} path={row.scenario} />
          <StepCell step={row} />
          <span className="mono">{metric === 'median' ? fmtMs(row.medianMs) : `×${row.spread.toFixed(1)}`}</span>
          <span className={`mono${metric === 'median' ? ' muted' : ''}`}>
            {metric === 'median' ? `×${row.spread.toFixed(1)}` : fmtMs(row.medianMs)}
          </span>
        </div>
      ))}
    </section>
  )
}

/** Green because nobody ran it: the most dangerous kind of green. */
function StaleTable({
  rows,
  onOpenRun,
}: {
  rows: StaleScenario[]
  onOpenRun: (scenario: string, run: number) => void
}) {
  return (
    <section className="scn-section">
      <header>{t('notRunLately')}</header>
      <div className="stats-flaky head">
        <span>{t('scenarioCol')}</span>
        <span />
        <span />
        <span>{t('sinceCol')}</span>
        <span>{t('lastRunCol')}</span>
      </div>
      {rows.map((row) => (
        <div key={row.scenario} className="stats-flaky">
          <span className="stats-step-id">{row.name}</span>
          <span />
          <span />
          <span className="mono warn">{t('daysAgo', row.days)}</span>
          <span className="mono">
            <button className="link" onClick={() => onOpenRun(row.scenario, row.run)}>
              #{row.run} · {relativeWhen(row.lastRunAt)}
            </button>
          </span>
        </div>
      ))}
    </section>
  )
}

/** Statistics of the whole project: what to fix first, over the last N runs. */
export function StatsScreen({
  project,
  onOpenRun,
}: {
  project: string
  onOpenRun: (scenario: string, run: number) => void
}) {
  const [window, setWindow] = useState(50)
  const [host, setHost] = useState<string | null>(null)
  const [stats, setStats] = useState<ProjectStats | null>(null)
  const [open, setOpen] = useState<Set<string>>(new Set())

  useEffect(() => {
    void fetchStats(project, window, host).then(setStats)
  }, [project, window, host])

  if (!stats) return null
  if ((stats.scenarios ?? []).length === 0) {
    return (
      <div className="empty">
        <div>{t('noStatsYet')}</div>
        <div className="hint">{t('noStatsHint')}</div>
      </div>
    )
  }

  // a server older than this page simply omits the newer tables
  const flaky = stats.flaky ?? []
  const slowest = stats.slowest ?? []
  const unstable = stats.unstable ?? []
  const stale = stats.stale ?? []
  const slower = stats.scenarios.filter((s) => (s.deltaPct ?? 0) > 0).length
  const faster = stats.scenarios.filter((s) => (s.deltaPct ?? 0) < 0).length
  const failing = stats.scenarios.filter((s) => s.passRate !== null && s.passRate < 1).length
  const toggle = (scenario: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(scenario)) next.delete(scenario)
      else next.add(scenario)
      return next
    })

  return (
    <div className="run-screen stats">
      <div className="stats-toolbar">
        <span className="stats-summary">
          {stats.from && stats.to ? `${shortDate(stats.from)} — ${shortDate(stats.to)}` : ''}
        </span>
        <span className="muted stats-filter-label">{t('windowLabel')}</span>
        <span className="seg">
          {WINDOWS.map((size) => (
            <button
              key={size}
              className={`seg-item${size === window ? ' active' : ''}`}
              onClick={() => setWindow(size)}
            >
              {size}
            </button>
          ))}
        </span>
        {stats.hosts.length > 1 && (
          <>
            <span className="muted stats-filter-label">{t('hostCol')}</span>
            <span className="seg">
              {stats.hosts.map((name) => (
                <button
                  key={name}
                  className={`seg-item${name === host ? ' active' : ''}`}
                  onClick={() => setHost(name === host ? null : name)}
                >
                  {name}
                </button>
              ))}
            </span>
          </>
        )}
      </div>

      <div className="stats-headline">
        <span className="warn">{slower}</span> {t('scenariosSlower', slower)}
        {' · '}
        <span className="ok">{faster}</span> {t('scenariosFaster', faster)}
        {' · '}
        <span className="bad">{failing}</span> {t('scenariosFailing', failing)}
        {' · '}
        <span className="warn">{flaky.length}</span> {t('stepsNotFirstTry', flaky.length)}
      </div>

      <section
        className="scn-section stats-table"
        style={cols({
          // one column for scenario names and step ids: the breakdown sits under it
          'stats-name-col': colWidth(
            [
              ...stats.scenarios.map((s) => s.name),
              ...stats.scenarios.flatMap((s) => s.steps.map((step) => step.stepId)),
            ].map((name) => name + '  '),
            34,
            14,
          ),
        })}
      >
        <header>
          {t('scenariosHead')}
          <span className="muted stats-sort">{t('sortedBySlowdown')}</span>
        </header>
        <div className="stats-row head">
          <span />
          <span>{t('scenarioCol')}</span>
          <span>{t('countedCol')}</span>
          <span>{t('runsChainCol')}</span>
          <span>{t('passRateCol')}</span>
          <span>{t('median')}</span>
          <span>{t('deltaMedian')}</span>
          <span>{t('lastFailureCol')}</span>
        </div>
        {stats.scenarios.map((s) => (
          <ScenarioRow
            key={s.scenario}
            stats={s}
            open={open.has(s.scenario)}
            onToggle={() => toggle(s.scenario)}
            onOpenRun={onOpenRun}
          />
        ))}
        <div className="stats-footnote muted">{t('pausesFootnote')}</div>
      </section>

      {flaky.length > 0 && <FlakyTable rows={flaky} onOpenRun={onOpenRun} />}
      {slowest.length > 0 && <StepsTable title={t('slowestSteps')} rows={slowest} metric="median" />}
      {unstable.length > 0 && <StepsTable title={t('unstableSteps')} rows={unstable} metric="spread" />}
      {stale.length > 0 && <StaleTable rows={stale} onOpenRun={onOpenRun} />}
    </div>
  )
}
