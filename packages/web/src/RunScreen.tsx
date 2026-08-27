import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { ChevronsDownUp, ChevronsUpDown, Repeat, StopSquare } from './icons'
import { t } from './i18n'
import { checkLabel, hasDetails } from './run/labels'
import { RunVariables } from './run/RunVariables'
import { StepDetails } from './run/StepDetails'
import { StepRow } from './run/StepRow'
import { Timeline } from './run/Timeline'
import { fileLabel, fmtTotal, relativeWhen, type RunState } from './runState'
import { colWidth, cols } from './ui/columns'

/**
 * Name and attempts columns are sized from the whole run: a step without retries
 * keeps the attempts column, so codes and durations never shift between rows.
 */
function stepCols(steps: RunState['steps']): CSSProperties {
  return cols({
    'step-col': colWidth(
      steps.map((s) => (s.name ?? s.id) + '  '),
      46,
      12,
    ),
    'attempts-col': colWidth(
      steps.map((s) => {
        const attempts = s.result?.attempts ?? s.attempt ?? 0
        return attempts > 1 ? `x${attempts}` : ''
      }),
      6,
      2,
    ),
  })
}

const RUN_LABEL: Record<RunState['status'], string> = {
  running: t('running'),
  passed: t('runPassed'),
  failed: t('runFailed'),
  stopped: t('runStopped'),
  error: t('runError'),
}

/** Run screen: identical for a live run and for a stored one. */
export function RunScreen({
  state,
  projectId,
  onStop,
  onRepeat,
}: {
  state: RunState
  projectId: string
  onStop: () => void
  onRepeat: () => void
}) {
  const running = state.status === 'running'
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [varsOpen, setVarsOpen] = useState(false)
  // "expand all steps" opens the response bodies too, down to their branches
  const [treesOpen, setTreesOpen] = useState(false)
  const stepRefs = useRef(new Map<string, HTMLDivElement>())

  const toggleStep = (stepId: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(stepId)) next.delete(stepId)
      else next.add(stepId)
      return next
    })

  const withDetails = state.steps.filter(hasDetails).map((s) => s.id)
  const allOpen = withDetails.length > 0 && withDetails.every((id) => open.has(id))

  /** Scrolls to a step row and flashes it; no state involved. */
  const focusStep = (stepId: string) => {
    const el = stepRefs.current.get(stepId)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    if (el) {
      el.classList.remove('row-flash')
      void el.offsetWidth // restart the animation when navigating to the same step again
      el.classList.add('row-flash')
      setTimeout(() => el.classList.remove('row-flash'), 1000)
    }
  }

  /** Opens a step and brings it into view — used by links and the timeline. */
  const scrollToStep = (stepId: string) => {
    setOpen((prev) => new Set([...prev, stepId]))
    focusStep(stepId)
  }

  // the failed step expands by itself: adjust state during render, scroll in an effect
  // seeded empty so a stored failed run also expands on its very first render
  const [seenFailure, setSeenFailure] = useState<string | undefined>(undefined)
  if (state.failedStep !== seenFailure) {
    setSeenFailure(state.failedStep)
    if (state.failedStep) setOpen((prev) => new Set([...prev, state.failedStep!]))
  }
  useEffect(() => {
    if (state.failedStep) focusStep(state.failedStep)
  }, [state.failedStep])

  const currentIndex = state.steps.findIndex((s) => s.status === 'running')
  const failedIndex = state.steps.findIndex((s) => s.id === state.failedStep)

  return (
    <div className="run-screen">
      <div className="run-header">
        {/* the scenario's own name leads, the file it lives in follows it */}
        <h1>{state.scenarioName || fileLabel(state.scenario)}</h1>
        <span className="run-number">#{state.run}</span>
        <span className="muted run-file">{state.scenario.replace(/\.ya?ml$/, '')}</span>
        <div className="run-actions">
          <button
            className="btn"
            title={allOpen ? t('collapseAll') : t('expandAll')}
            onClick={() => {
              setOpen(allOpen ? new Set() : new Set(withDetails))
              setTreesOpen(!allOpen)
            }}
          >
            <span key={String(allOpen)} className="flip-icon">
              {allOpen ? <ChevronsDownUp size={13} /> : <ChevronsUpDown size={13} />}
            </span>
          </button>
          {running ? (
            <button className="btn danger" onClick={onStop}>
              <StopSquare size={13} /> {t('stop')}
            </button>
          ) : (
            <button className="btn" onClick={onRepeat}>
              <Repeat size={13} /> {t('repeat')}
            </button>
          )}
        </div>
      </div>
      <div className={`run-status ${state.status}`}>
        {RUN_LABEL[state.status]}
        {running && currentIndex >= 0 && ` · ${t('stepOf', currentIndex + 1, state.steps.length)}`}
        {state.status === 'failed' && failedIndex >= 0 && ` ${t('atStepOf', failedIndex + 1, state.steps.length)}`}
        {' · '}
        <Elapsed state={state} />
        {state.vars.length > 0 && (
          <span className="muted">
            {' · '}
            <button className="link" onClick={() => setVarsOpen(!varsOpen)}>
              {t('varsCount', state.vars.length + Object.keys(state.varUsage).length)}
            </button>
          </span>
        )}
        {state.host && <span className="muted"> · {state.host}</span>}
        {!running && state.durationMs != null && (
          <span className="muted">
            {' '}
            · {relativeWhen(new Date(Date.parse(state.startedAt) + state.durationMs).toISOString())}
          </span>
        )}
        {state.cleanupFailed && <span className="warn"> · {t('cleanupFailed')}</span>}
        {state.message && <span className="warn"> · {state.message}</span>}
      </div>

      {varsOpen && <RunVariables state={state} onStep={scrollToStep} />}

      {state.failedStep && state.failedCheck && (
        <div className="fail-banner">
          <div>
            <b>
              {t('stepWord')} {failedIndex + 1} · {state.failedStep}
            </b>
            {' · '}
            {t('checkNotPassed', checkLabel(state.failedCheck))}
            <div className="fail-detail">
              {t('expectedGot', state.failedCheck.expected, state.failedCheck.actual ?? '—')}
            </div>
          </div>
          <button className="link" onClick={() => scrollToStep(state.failedStep!)}>
            {t('toStep')}
          </button>
        </div>
      )}

      <Timeline steps={state.steps} onPick={scrollToStep} />

      <div className="steps" style={stepCols(state.steps)}>
        {state.steps.map((step, i) => (
          <div
            key={step.id}
            ref={(el) => {
              if (el) stepRefs.current.set(step.id, el)
            }}
          >
            {step.cleanup && !state.steps[i - 1]?.cleanup && <div className="cleanup-divider">{t('cleanupLabel')}</div>}
            <StepRow step={step} index={i} open={open.has(step.id)} onToggle={() => toggleStep(step.id)} />
            {open.has(step.id) && hasDetails(step) && (
              <StepDetails step={step} state={state} projectId={projectId} expandAll={treesOpen} />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

/** Live elapsed time; ticks only while the run is in progress. */
function Elapsed({ state }: { state: RunState }) {
  const running = state.status === 'running'
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => setNow(Date.now()), 100)
    return () => clearInterval(timer)
  }, [running])
  const ms = state.durationMs ?? now - Date.parse(state.startedAt)
  return <span className="mono">{fmtTotal(Math.max(0, ms))}</span>
}
