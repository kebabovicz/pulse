import { useState } from 'react'
import type { RunIndexEntry, RunsGroup, StepStatus } from '@pulse/shared'
import { ChevronDown, Check, Cross, StopSquare, GitCompare, Trash } from './icons'
import { t, dateLocale } from './i18n'

export function MiniMap({ statuses }: { statuses: StepStatus[] }) {
  return (
    <span className="minimap">
      {statuses.map((s, i) => (
        <span key={i} className={`mm-cell ${s}`} />
      ))}
    </span>
  )
}

export function relativeWhen(iso: string): string {
  const when = new Date(iso)
  const time = when.toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' })
  const day = when.toDateString()
  const now = new Date()
  if (day === now.toDateString()) return `${t('today')} ${time}`
  if (day === new Date(now.getTime() - 86_400_000).toDateString()) return `${t('yesterday')} ${time}`
  return `${when.toLocaleDateString(dateLocale, { day: '2-digit', month: '2-digit' })} ${time}`
}

const fmtSec = (ms: number): string => `${(ms / 1000).toFixed(1).padStart(4, '0')} s`

function Outcome({ run }: { run: RunIndexEntry }) {
  if (run.status === 'passed')
    return (
      <span className="ok">
        <Check size={11} /> {t('passed')}
      </span>
    )
  if (run.status === 'failed') {
    const at = run.stepStatuses.indexOf('failed') + 1
    return (
      <span className="bad">
        <Cross size={11} /> {t('failedAtStep', at || '?', run.stepStatuses.length)}
      </span>
    )
  }
  if (run.status === 'stopped')
    return (
      <span className="muted">
        <StopSquare size={11} /> {t('stoppedManually')}
      </span>
    )
  return <span className="warn">{t('notStarted')}</span>
}

// History tab: every run of the project, grouped by scenario (req 41, 46).
export function HistoryScreen({
  groups,
  filter,
  onFilter,
  onOpen,
  onCompare,
  onClear,
}: {
  groups: RunsGroup[]
  filter: string | null // the "this scenario only" chip
  onFilter: (scenario: string | null) => void
  onOpen: (scenario: string, run: number) => void
  onCompare: (scenario: string, a: number, b: number) => void
  onClear: (scenario: string | null) => void
}) {
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  // second-click confirmation: a scenario path, or '*' for the whole project
  const [confirmClear, setConfirmClear] = useState<string | null>(null)
  // only runs of the same scenario can be compared
  const [selected, setSelected] = useState<{ scenario: string; runs: number[] }>({ scenario: '', runs: [] })

  const visible = groups.filter(
    (g) => (!filter || g.scenario === filter) && (!query || g.scenario.toLowerCase().includes(query.toLowerCase())),
  )
  const totalRuns = visible.reduce((n, g) => n + g.runs.length, 0)

  const toggleRun = (scenario: string, run: number) =>
    setSelected((prev) => {
      if (prev.scenario !== scenario) return { scenario, runs: [run] }
      const runs = prev.runs.includes(run) ? prev.runs.filter((r) => r !== run) : [...prev.runs.slice(-1), run]
      return { scenario, runs }
    })

  const toggleGroup = (scenario: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(scenario)) next.delete(scenario)
      else next.add(scenario)
      return next
    })

  return (
    <div className="run-screen">
      <div className="history-toolbar">
        <span className="history-summary">{t('historySummary', totalRuns, visible.length)}</span>
        {filter && (
          <span className="chip" title={t('filterChipHint')}>
            {filter}
            <button title={t('clearFilter')} onClick={() => onFilter(null)}>
              ✕
            </button>
          </span>
        )}
        <span className="spacer" />
        <span className="filter-wrap">
          <input
            className="filter-input"
            type="search"
            name="runs-filter"
            autoComplete="off"
            spellCheck={false}
            data-bwignore="true"
            data-1p-ignore="true"
            data-lpignore="true"
            placeholder={t('filterRuns')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </span>
        <button
          className={`btn${confirmClear === '*' ? ' danger' : ''}`}
          onClick={() => {
            if (confirmClear !== '*') return setConfirmClear('*')
            setConfirmClear(null)
            onClear(null)
          }}
        >
          <Trash size={12} /> {confirmClear === '*' ? t('sure') : t('clearHistory')}
        </button>
        <button
          className="btn primary"
          disabled={selected.runs.length !== 2}
          onClick={() => onCompare(selected.scenario, Math.min(...selected.runs), Math.max(...selected.runs))}
        >
          <GitCompare size={12} /> {t('compareBtn', selected.runs.length)}
        </button>
      </div>
      <table className="history">
        <thead>
          <tr>
            <th style={{ width: 28 }} />
            <th style={{ width: 60 }}>{t('runCol')}</th>
            <th style={{ width: 140 }}>{t('when').toLowerCase()}</th>
            <th>{t('result').toLowerCase()}</th>
            <th style={{ width: 180 }}>{t('stepsCol').toLowerCase()}</th>
            <th style={{ width: 70 }}>{t('hostCol')}</th>
            <th className="num" style={{ width: 90 }}>
              {t('durationCol').toLowerCase()}
            </th>
          </tr>
        </thead>
        {visible.map((group) => (
          <tbody key={group.scenario}>
            <tr className="hgroup" onClick={() => toggleGroup(group.scenario)}>
              <td>
                <span
                  style={{
                    display: 'inline-flex',
                    transform: collapsed.has(group.scenario) ? 'rotate(-90deg)' : 'none',
                  }}
                >
                  <ChevronDown size={12} />
                </span>
              </td>
              <td colSpan={3}>
                {group.scenario.replace(/\.ya?ml$/, '')}
                <span className="hgroup-count">{t('runsCount', group.runs.length)}</span>
              </td>
              <td colSpan={3} className="hgroup-last" style={{ textAlign: 'right' }}>
                {t('lastAt', relativeWhen(group.runs[0].startedAt))}
                <button
                  className={`icon-btn${confirmClear === group.scenario ? ' bad' : ''}`}
                  title={confirmClear === group.scenario ? t('sure') : t('clearHistory')}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (confirmClear !== group.scenario) return setConfirmClear(group.scenario)
                    setConfirmClear(null)
                    onClear(group.scenario)
                  }}
                >
                  <Trash size={11} />
                </button>
              </td>
            </tr>
            {!collapsed.has(group.scenario) &&
              group.runs.map((run) => {
                const isSel = selected.scenario === group.scenario && selected.runs.includes(run.run)
                return (
                  <tr
                    key={run.run}
                    className={`run-row${isSel ? ' selected' : ''}${run.status === 'failed' ? ' failed' : ''}`}
                    onClick={() => onOpen(group.scenario, run.run)}
                  >
                    <td onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={isSel} onChange={() => toggleRun(group.scenario, run.run)} />
                    </td>
                    <td>#{run.run}</td>
                    <td>{relativeWhen(run.startedAt)}</td>
                    <td>
                      <Outcome run={run} />
                    </td>
                    <td>
                      <MiniMap statuses={run.stepStatuses} />
                    </td>
                    <td className="muted">{run.host ?? ''}</td>
                    <td className="num">{fmtSec(run.durationMs)}</td>
                  </tr>
                )
              })}
          </tbody>
        ))}
      </table>
      {totalRuns === 0 && (
        <div className="empty" style={{ height: 200 }}>
          {t('noRunsYet')}
        </div>
      )}
    </div>
  )
}
