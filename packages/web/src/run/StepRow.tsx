import type { ReactNode } from 'react'
import { Check, ChevronDown, Circle, Cross, Minus, Pause, Spinner } from '../icons'
import { t } from '../i18n'
import { fmtMs, type StepView } from '../runState'
import { hasDetails } from './labels'

const STATUS_ICON: Record<StepView['status'], ReactNode> = {
  pending: <Circle size={11} />,
  running: <Spinner size={12} />,
  passed: <Check size={13} />,
  failed: <Cross size={13} />,
  skipped: <Minus size={12} />,
}

/** One row of the step list: status, method, path, code and duration. */
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
  return (
    <button
      className={`step-row ${step.status}${open ? ' open' : ''}`}
      style={expandable ? undefined : { cursor: 'default' }}
      onClick={expandable ? onToggle : undefined}
    >
      <span className={`step-icon ${pause ? 'pause' : step.status}`}>
        {pause ? <Pause size={11} /> : STATUS_ICON[step.status]}
      </span>
      <span className="step-num">{index + 1}</span>
      <span className="step-name">{step.name ?? step.id}</span>
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
        {r?.error ? r.error.message : (r?.response?.status ?? '')}
      </span>
      <span className="step-duration">{r?.durationMs != null ? fmtMs(r.durationMs) : ''}</span>
      <span className="step-chevron" style={{ transform: open ? 'rotate(180deg)' : 'none' }}>
        {expandable && <ChevronDown size={12} />}
      </span>
    </button>
  )
}
