import { t } from '../i18n'
import type { RunState } from '../runState'
import { CopyValue } from '../ui/CopyButton'

/** Run variables panel: input values and everything captured along the way. */
export function RunVariables({ state, onStep }: { state: RunState; onStep: (stepId: string) => void }) {
  const captured = state.steps.flatMap((step) => (step.result?.captures ?? []).map((c) => ({ ...c, stepId: step.id })))
  const capturedNames = new Set(captured.map((c) => c.name))
  const pending = Object.entries(state.varUsage).filter(([name]) => !capturedNames.has(name))
  return (
    <section className="scn-section vars-panel">
      <header>{t('variables')}</header>
      {state.vars.map((v) => (
        <div key={v.name} className="scn-var">
          <span className="kv-origin">var</span>
          <span className="kv-key">{v.name}</span>
          {v.secret ? <span className="mono clip">{v.value}</span> : <CopyValue value={v.value} />}
          <span />
          <span className="muted scn-var-source">
            {v.secret ? (
              <span className="warn">{t('secret')}</span>
            ) : v.source === 'manual' ? (
              t('sourceManual')
            ) : (
              t('fromFile')
            )}
          </span>
        </div>
      ))}
      {captured.map((c) => (
        <div key={c.name} className="scn-var">
          <span className="kv-origin">capture</span>
          <span className="kv-key accent">{c.name}</span>
          <CopyValue value={c.value} />
          <span className="scn-var-step">
            <button className="link" onClick={() => onStep(c.stepId)}>
              {c.stepId}
            </button>
          </span>
          <span className="muted scn-var-source" title={state.varUsage[c.name]?.usedBy.join(', ')}>
            {state.varUsage[c.name]?.usedBy.length ? t('usedIn', state.varUsage[c.name].usedBy.length) : ''}
          </span>
        </div>
      ))}
      {pending.map(([name, usage]) => (
        <div key={name} className="scn-var">
          <span className="kv-origin">capture</span>
          <span className="kv-key muted">{name}</span>
          <span className="muted">{t('notCaptured')}</span>
          <span className="scn-var-step muted">{usage.capturedBy}</span>
          <span />
        </div>
      ))}
    </section>
  )
}
