import { useEffect, useState } from 'react'
import type { ChainRun, FlakyStep, ProjectStats, ScenarioStats, StepStats } from '@pulse/shared'
import { fetchStats } from './api'
import { ChevronDown } from './icons'
import { t } from './i18n'
import { fmtMs, relativeWhen } from './runState'
import { colWidth, cols } from './ui/columns'

const WINDOWS = [20, 50, 100, 200]

const pct = (share: number): string => `${Math.round(share * 100)} %`

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
            className={`chain-run ${run.counted ? run.status : 'outside'}${boundary ? ' boundary' : ''}`}
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
        <span>{t('statsStepHead')}</span>
        <span>{t('failuresCol')}</span>
        <span>{t('median')}</span>
        <span>{t('deltaMedian')}</span>
        <span>{t('retriedCol')}</span>
      </div>
      {shown.map((step) => (
        <div key={step.stepId} className="stats-step">
          <span className="stats-step-id">
            {step.stepId}
            {step.path && (
              <span className="muted stats-req">
                {' '}
                {step.method} {step.path}
              </span>
            )}
          </span>
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
        <span className={`stats-chevron${open ? ' open' : ''}`}>
          {expandable && <ChevronDown size={12} />}
        </span>
        <span className="stats-name">{stats.name}</span>
        <span className={`mono${stats.counted < stats.total ? ' warn' : ' muted'}`}>
          {stats.counted} / {stats.total}
        </span>
        <Chain chain={stats.chain} />
        <span className={`mono${stats.passRate === null ? ' muted' : stats.passRate < 0.9 ? ' bad' : ''}`}>
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
        <span>{t('retriedCol')}</span>
        <span>{t('lastRunCol')}</span>
      </div>
      {rows.map((row) => (
        <div key={`${row.scenario}/${row.stepId}`} className="stats-flaky">
          <span className="muted">{row.scenario.replace(/\.ya?ml$/, '')}</span>
          <span className="stats-step-id">
            {row.stepId}
            {row.path && (
              <span className="muted stats-req">
                {' '}
                {row.method} {row.path}
              </span>
            )}
          </span>
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
  if (stats.scenarios.length === 0) {
    return (
      <div className="empty">
        <div>{t('noStatsYet')}</div>
        <div className="hint">{t('noStatsHint', stats.minRuns)}</div>
      </div>
    )
  }

  const slower = stats.scenarios.filter((s) => (s.deltaPct ?? 0) > 0).length
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
        <span className="warn">{slower}</span> {t('scenariosSlower')}
        {' · '}
        <span className="bad">{failing}</span> {t('scenariosFailing')}
        {' · '}
        <span className="warn">{stats.flaky.length}</span> {t('stepsNotFirstTry')}
      </div>

      <section
        className="scn-section stats-table"
        style={cols({
          'stats-name-col': colWidth(
            stats.scenarios.map((s) => s.name + '  '),
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

      {stats.flaky.length > 0 && <FlakyTable rows={stats.flaky} onOpenRun={onOpenRun} />}
    </div>
  )
}
