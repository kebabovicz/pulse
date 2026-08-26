import { useState } from 'react'
import { t } from '../i18n'
import { fmtMs, type StepView } from '../runState'

const thousands = (n: number): string => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')

/** Share of the bar a pause may take: it is waiting, not work the API did. */
const PAUSE_SHARE = 1 / 3

const durationOf = (s: StepView): number => s.result?.durationMs ?? s.durationMs ?? 0

/** Duration bar of a run: one segment per executed step, click jumps to it. */
export function Timeline({ steps: allSteps, onPick }: { steps: StepView[]; onPick: (stepId: string) => void }) {
  // the tip is fixed-positioned at the cursor: it neither shifts the bar nor gets clipped
  const [hover, setHover] = useState<{ text: string; x: number; y: number } | null>(null)
  const steps = allSteps.filter((s) => s.status !== 'pending' && s.status !== 'skipped')
  const pauseMs = steps.filter((s) => s.kind === 'sleep').reduce((sum, s) => sum + durationOf(s), 0)
  const total = steps.reduce((sum, s) => sum + durationOf(s), 0)
  if (total === 0) return null

  // A pause is a constant from the scenario file, so a long one would squash every
  // real request into an unreadable sliver. Pauses are scaled down together to keep
  // their combined share of the bar bounded; the tooltip still shows the real time.
  const budget = (total - pauseMs) * PAUSE_SHARE
  const pauseScale = pauseMs > budget ? budget / pauseMs : 1
  const minGrow = total / 100

  return (
    <div className="timeline-wrap">
      <div className="timeline">
        {steps.map((s) => {
          const ms = durationOf(s)
          const pause = s.kind === 'sleep'
          return (
            <div
              key={s.id}
              className={`tl-seg ${pause ? 'pause' : s.status}${!pause && (s.result?.attempts ?? 1) > 1 ? ' retried' : ''}`}
              style={{ flexGrow: Math.max(pause ? ms * pauseScale : ms, minGrow) }}
              onMouseEnter={(e) =>
                setHover({
                  text: `${allSteps.findIndex((x) => x.id === s.id) + 1} · ${s.id} · ${pause ? `${t('pause')} ` : ''}${fmtMs(ms)}`,
                  x: e.clientX,
                  y: e.clientY,
                })
              }
              onMouseLeave={() => setHover(null)}
              onClick={() => onPick(s.id)}
            />
          )
        })}
      </div>
      {hover && (
        <span className="hover-tip" style={{ left: hover.x, top: hover.y - 12 }}>
          {hover.text}
        </span>
      )}
      <span className="tl-total">
        {thousands(total)} ms
        {pauseMs > 0 && <span className="muted"> · {t('inPauses', fmtMs(pauseMs))}</span>}
      </span>
    </div>
  )
}
