import type { ReactNode } from 'react'
import { Check, ChevronDown, Circle, Cross, Minus, Pause, Spinner } from '../icons'
import { t } from '../i18n'
import { fmtMs, relativeWhen, type StepView } from '../runState'
import { hasDetails } from './labels'
import { useClipped } from '../ui/useClipped'

const STATUS_ICON: Record<StepView['status'], ReactNode> = {
  pending: <Circle size={11} />,
  running: <Spinner size={12} />,
  passed: <Check size={13} />,
  failed: <Cross size={13} />,
  skipped: <Minus size={12} />,
}

/** The name is capped by its column, so it carries a tooltip only when it is cut off. */
function StepName({ label }: { label: string }) {
  const [ref, clipped] = useClipped<HTMLSpanElement>(label)
  return (
    <span ref={ref} className="step-name" title={clipped ? label : undefined}>
      {label}
    </span>
  )
}

/** One row of the step list: status, method, path, code and duration. */
/** Where a cached step's values came from, for the tooltip and the detail line. */
export function cachedHint(result: { cachedFrom?: { scenario: string; run: number; at: string } }): string {
  const from = result.cachedFrom
  if (!from) return t('cached')
  return t('cachedFrom', from.scenario.replace(/\.ya?ml$/, ''), from.run, relativeWhen(from.at))
}

export function StepRow({
  step,
  index,
  open,
  onToggle,
}: {
  step: StepView
  index: number
  open: boolean
  onToggle: () => void
}) {
  const r = step.result
  const attempts = r?.attempts ?? step.attempt ?? 0
  const expandable = hasDetails(step)
  // a finished pause checked nothing, so it gets a neutral mark instead of a tick
  const pause = step.kind === 'sleep' && step.status === 'passed'
  // passed, but not on the first try — the same "attention" tint the timeline uses
  const retried = step.status === 'passed' && attempts > 1
  return (
    <button
      className={`step-row ${step.status}${retried ? ' retried' : ''}${open ? ' open' : ''}`}
      style={expandable ? undefined : { cursor: 'default' }}
      onClick={expandable ? onToggle : undefined}
    >
      <span className={`step-icon ${pause ? 'pause' : step.status}`}>
        {pause ? <Pause size={11} /> : STATUS_ICON[step.status]}
      </span>
      <span className="step-num">{index + 1}</span>
      <StepName label={step.name ?? step.id} />
      <span className="step-method">{step.kind === 'sleep' ? '—' : step.method}</span>
      <span className="step-path">
        {step.kind === 'sleep'
          ? `${t('pause')} ${fmtMs(step.durationMs ?? 0)}${step.remainingMs != null ? ` · ${t('secondsLeft', Math.ceil(step.remainingMs / 1000))}` : ''}`
          : step.path}
      </span>
      <span className="step-attempts">{attempts > 1 ? `×${attempts}` : ''}</span>
      <span
        className={`step-code${r?.response && !r.checks?.find((c) => c.kind === 'status' && !c.passed) ? ' ok' : r?.response ? ' bad' : ''}`}
      >
        {r?.error ? (
          r.error.message
        ) : r?.cached ? (
          <span title={cachedHint(r)}>{t('cached')}</span>
        ) : (
          (r?.response?.status ?? '')
        )}
      </span>
      <span className="step-duration">{r?.durationMs != null ? fmtMs(r.durationMs) : ''}</span>
      <span className="step-chevron" style={{ transform: open ? 'rotate(180deg)' : 'none' }}>
        {expandable && <ChevronDown size={12} />}
      </span>
    </button>
  )
}
