import type { RunRecord, StepResult } from '@pulse/shared'
import { Cross } from './icons'
import { t, dateLocale } from './i18n'
import { fmtMs, fmtTotal } from './runState'

const ICON: Record<StepResult['status'], string> = { passed: '✓', failed: '✕', skipped: '—' }

interface Row {
  id: string
  a?: RunRecord['steps'][number]
  b?: RunRecord['steps'][number]
}

// A duration difference counts only when it is both relatively and absolutely
// visible: network jitter makes a few ms on a fast step look like tens of
// percent, while 20 ms on a two-second step is noise.
const MIN_SHARE = 0.1
const MIN_MS = 20

type Trend = 'faster' | 'slower' | 'same'

function trendOf(delta: number | null, base: number | undefined): Trend {
  if (delta === null || base === undefined || base === 0) return 'same'
  if (Math.abs(delta) < MIN_MS || Math.abs(delta) / base < MIN_SHARE) return 'same'
  return delta < 0 ? 'faster' : 'slower'
}

const TREND_CLASS: Record<Trend, string> = { faster: 'ok', slower: 'warn', same: '' }

// Steps are matched by id; ones missing from either run are marked (req 48).
function pairSteps(a: RunRecord, b: RunRecord): Row[] {
  const ids = [...new Set([...a.steps.map((s) => s.id), ...b.steps.map((s) => s.id)])]
  return ids.map((id) => ({ id, a: a.steps.find((s) => s.id === id), b: b.steps.find((s) => s.id === id) }))
}

function Cell({ step }: { step?: RunRecord['steps'][number] }) {
  if (!step) return <span className="muted">{t('noStep')}</span>
  return (
    <>
      <span className={step.status === 'passed' ? 'ok' : step.status === 'failed' ? 'bad' : 'muted'}>
        {ICON[step.status]}
      </span>{' '}
      <span className="mono">{step.durationMs != null ? fmtMs(step.durationMs) : '—'}</span>
      {(step.attempts ?? 1) > 1 && <span className="warn mono"> ×{step.attempts}</span>}
    </>
  )
}

export function CompareScreen({
  a,
  b,
  onClose,
  onOpen,
}: {
  a: RunRecord
  b: RunRecord
  onClose: () => void
  onOpen: (run: number) => void
}) {
  const rows = pairSteps(a, b)
  const maxMs = Math.max(1, ...rows.flatMap((r) => [r.a?.durationMs ?? 0, r.b?.durationMs ?? 0]))
  const totalDelta = b.durationMs - a.durationMs

  const fmtDelta = (delta: number) => `${delta > 0 ? '+' : delta < 0 ? '−' : ''}${fmtMs(Math.abs(delta))}`

  const runChip = (r: RunRecord, side: 'a' | 'b') => (
    <button className={`run-chip ${r.status}`} onClick={() => onOpen(r.run)}>
      <span className={`run-key ${side}`} />
      <b>#{r.run}</b> {r.status === 'passed' ? t('passed') : r.status === 'failed' ? t('failed') : r.status} ·{' '}
      {fmtTotal(r.durationMs)}{' '}
      <span className="muted">
        {new Date(r.startedAt).toLocaleDateString(dateLocale, { day: '2-digit', month: '2-digit' })}{' '}
        {new Date(r.startedAt).toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' })}
      </span>
    </button>
  )

  return (
    <div className="run-screen">
      <div className="run-header">
        <h1>{t('comparison')}</h1>
        <span className="muted">· {a.scenarioName}</span>
        <div className="run-actions">
          <button className="icon-btn modal-close" onClick={onClose}>
            <Cross size={16} />
          </button>
        </div>
      </div>
      <div className="compare-chips">
        {runChip(a, 'a')}
        <span className="muted">⇄</span>
        {runChip(b, 'b')}
      </div>
      <table className="history compare">
        <thead>
          <tr>
            <th>{t('stepWord')}</th>
            <th>
              <span className="run-key a" />#{a.run}
            </th>
            <th>
              <span className="run-key b" />#{b.run}
            </th>
            <th>Δ</th>
            <th>{t('durationCol')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const delta =
              row.a?.durationMs != null && row.b?.durationMs != null ? row.b.durationMs - row.a.durationMs : null
            const differs = row.a?.status !== row.b?.status
            return (
              <tr key={row.id} className={differs ? 'diverged' : ''}>
                <td>
                  <span className="muted mono">{i + 1}</span> <span className="mono">{row.id}</span>
                </td>
                <td>
                  <Cell step={row.a} />
                </td>
                <td>
                  <Cell step={row.b} />
                </td>
                <td className={`mono ${TREND_CLASS[trendOf(delta, row.a?.durationMs)]}`}>
                  {delta == null ? '—' : fmtDelta(delta)}
                </td>
                <td className="dur-bars">
                  <div className="dur-bar a" style={{ width: `${((row.a?.durationMs ?? 0) / maxMs) * 100}%` }} />
                  <div
                    className={`dur-bar b${trendOf(delta, row.a?.durationMs) === 'slower' ? ' slow' : ''}`}
                    style={{ width: `${((row.b?.durationMs ?? 0) / maxMs) * 100}%` }}
                  />
                </td>
              </tr>
            )
          })}
          <tr className="total">
            <td>{t('total')}</td>
            <td className="mono">{fmtTotal(a.durationMs)}</td>
            <td className="mono">{fmtTotal(b.durationMs)}</td>
            <td className={`mono ${TREND_CLASS[trendOf(totalDelta, a.durationMs)]}`}>{fmtDelta(totalDelta)}</td>
            <td />
          </tr>
        </tbody>
      </table>
    </div>
  )
}
