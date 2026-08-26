import { useState } from 'react'
import { fmtMs, type StepView } from '../runState'

const thousands = (n: number): string => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u2009')

/** Duration bar of a run: one segment per executed step, click jumps to it. */
export function Timeline({ steps: allSteps, onPick }: { steps: StepView[]; onPick: (stepId: string) => void }) {
  // the tip is fixed-positioned at the cursor: it neither shifts the bar nor gets clipped
  const [hover, setHover] = useState<{ text: string; x: number; y: number } | null>(null)
  const steps = allSteps.filter((s) => s.status !== 'pending' && s.status !== 'skipped')
  const total = steps.reduce((sum, s) => sum + (s.result?.durationMs ?? s.durationMs ?? 0), 0)
  if (total === 0) return null
  return (
    <div className="timeline-wrap">
      <div className="timeline">
        {steps.map((s) => {
          const ms = s.result?.durationMs ?? s.durationMs ?? 0
          return (
            <div
              key={s.id}
              className={`tl-seg ${s.status}${(s.result?.attempts ?? 1) > 1 ? ' retried' : ''}`}
              style={{ flexGrow: Math.max(ms, total / 100) }}
              onMouseEnter={(e) =>
                setHover({
                  text: `${allSteps.findIndex((x) => x.id === s.id) + 1} · ${s.id} · ${fmtMs(ms)}`,
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
      <span className="tl-total">{thousands(total)} ms</span>
    </div>
  )
}
