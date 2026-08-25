import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { CheckResult } from '@pulse/shared'
import { copyWithBadge } from './copy'
import { Check, ChevronDown, ChevronsDownUp, ChevronsUpDown, Circle, Copy, Cross, Minus, Repeat, Spinner, StopSquare } from './icons'
import { t } from './i18n'
import { JsonTree } from './JsonTree'
import { fileLabel, fmtMs, fmtTotal, type RunState, type StepView } from './runState'

const STATUS_ICON: Record<StepView['status'], ReactNode> = {
  pending: <Circle size={11} />,
  running: <Spinner size={12} />,
  passed: <Check size={13} />,
  failed: <Cross size={13} />,
  skipped: <Minus size={12} />,
}

const RUN_LABEL: Record<RunState['status'], string> = {
  running: t('running'),
  passed: t('runPassed'),
  failed: t('runFailed'),
  stopped: t('runStopped'),
  error: t('runError'),
}

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

  const scrollToStep = (stepId: string) => {
    setOpen((prev) => new Set([...prev, stepId]))
    const el = stepRefs.current.get(stepId)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    if (el) {
      el.classList.remove('row-flash')
      void el.offsetWidth // перезапуск анимации при повторном переходе
      el.classList.add('row-flash')
      setTimeout(() => el.classList.remove('row-flash'), 1000)
    }
  }

  // провалившийся шаг раскрывается сам
  useEffect(() => {
    if (state.failedStep) scrollToStep(state.failedStep)
  }, [state.failedStep])

  const currentIndex = state.steps.findIndex((s) => s.status === 'running')
  const failedIndex = state.steps.findIndex((s) => s.id === state.failedStep)

  return (
    <div className="run-screen">
      <div className="run-header">
        <h1>{fileLabel(state.scenario)}</h1>
        <span className="run-number">#{state.run}</span>
        {state.scenarioName && state.scenarioName !== fileLabel(state.scenario) && (
          <span className="muted">{state.scenarioName}</span>
        )}
        <div className="run-actions">
          <button
            className="btn"
            title={allOpen ? t('collapseAll') : t('expandAll')}
            onClick={() => setOpen(allOpen ? new Set() : new Set(withDetails))}
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
            <div className="fail-detail">{t('expectedGot', state.failedCheck.expected, state.failedCheck.actual ?? '—')}</div>
          </div>
          <button className="link" onClick={() => scrollToStep(state.failedStep!)}>
            {t('toStep')}
          </button>
        </div>
      )}

      <Timeline steps={state.steps} onPick={scrollToStep} />

      <div className="steps">
        {state.steps.map((step, i) => (
          <div
            key={step.id}
            ref={(el) => {
              if (el) stepRefs.current.set(step.id, el)
            }}
          >
            {step.cleanup && !state.steps[i - 1]?.cleanup && <div className="cleanup-divider">{t('cleanupLabel')}</div>}
            <StepRow step={step} index={i} open={open.has(step.id)} onToggle={() => toggleStep(step.id)} />
            {open.has(step.id) && hasDetails(step) && <StepDetails step={step} state={state} projectId={projectId} />}
          </div>
        ))}
      </div>
    </div>
  )
}

// Значение, копируемое кликом; плашка «copied» всплывает от курсора.
function CopyValue({ value }: { value: string }) {
  return (
    <span className="mono clip copy-value" title={t('copyHint')} onClick={(e) => copyWithBadge(value, e)}>
      {value}
    </span>
  )
}

// Панель переменных прогона: входные значения и всё захваченное по шагам.
function RunVariables({ state, onStep }: { state: RunState; onStep: (stepId: string) => void }) {
  const captured = state.steps.flatMap((step) =>
    (step.result?.captures ?? []).map((c) => ({ ...c, stepId: step.id })),
  )
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
            {v.secret ? <span className="warn">{t('secret')}</span> : v.source === 'manual' ? t('sourceManual') : t('fromFile')}
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

function Elapsed({ state }: { state: RunState }) {
  const [, tick] = useState(0)
  const running = state.status === 'running'
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => tick((n) => n + 1), 100)
    return () => clearInterval(timer)
  }, [running])
  const ms = state.durationMs ?? Date.now() - Date.parse(state.startedAt)
  return <span className="mono">{fmtTotal(Math.max(0, ms))}</span>
}

const thousands = (n: number): string => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u2009')

function Timeline({ steps: allSteps, onPick }: { steps: StepView[]; onPick: (stepId: string) => void }) {
  // подсказка позиционируется от курсора фиксированно: не двигает полосу и не обрезается
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

const hasDetails = (step: StepView): boolean => Boolean(step.result) && step.status !== 'skipped' && step.status !== 'pending'

function StepRow({ step, index, open, onToggle }: { step: StepView; index: number; open: boolean; onToggle: () => void }) {
  const r = step.result
  const attempts = r?.attempts ?? step.attempt ?? 0
  const expandable = hasDetails(step)
  return (
    <button
      className={`step-row ${step.status}${open ? ' open' : ''}`}
      style={expandable ? undefined : { cursor: 'default' }}
      onClick={expandable ? onToggle : undefined}
    >
      <span className={`step-icon ${step.status}`}>{STATUS_ICON[step.status]}</span>
      <span className="step-num">{index + 1}</span>
      <span className="step-name" title={step.name ?? step.id}>{step.name ?? step.id}</span>
      <span className="step-method">{step.kind === 'sleep' ? '—' : step.method}</span>
      <span className="step-path">
        {step.kind === 'sleep'
          ? `${t('pause')} ${fmtMs(step.durationMs ?? 0)}${step.remainingMs != null ? ` · ${t('secondsLeft', Math.ceil(step.remainingMs / 1000))}` : ''}`
          : step.path}
      </span>
      <span className="step-attempts">{attempts > 1 ? `×${attempts}` : ''}</span>
      <span className={`step-code${r?.response && !r.checks?.find((c) => c.kind === 'status' && !c.passed) ? ' ok' : r?.response ? ' bad' : ''}`}>
        {r?.error ? r.error.message : (r?.response?.status ?? '')}
      </span>
      <span className="step-duration">{r?.durationMs != null ? fmtMs(r.durationMs) : ''}</span>
      <span className="step-chevron" style={{ transform: open ? 'rotate(180deg)' : 'none' }}>
        {expandable && <ChevronDown size={12} />}
      </span>
    </button>
  )
}

// Режим просмотра запоминается на проект (DESIGN.md, «Режимы просмотра»).
function useViewMode(projectId: string, kind: string, initial: string) {
  const key = `pulse.mode.${projectId}.${kind}`
  const [mode, setMode] = useState(() => localStorage.getItem(key) ?? initial)
  return [
    mode,
    (m: string) => {
      setMode(m)
      localStorage.setItem(key, m)
    },
  ] as const
}

function Seg({
  modes,
  mode,
  onPick,
}: {
  modes: { id: string; label: string; enabled: boolean }[]
  mode: string
  onPick: (m: string) => void
}) {
  return (
    <span className="seg">
      {modes.map((m) => (
        <button key={m.id} className={`seg-item${mode === m.id ? ' active' : ''}`} disabled={!m.enabled} onClick={() => onPick(m.id)}>
          {m.label}
        </button>
      ))}
    </span>
  )
}

function CopyButton({ text }: { text: string }) {
  return (
    <button className="icon-btn" title={t('copyHint')} onClick={(e) => copyWithBadge(text, e)}>
      <Copy size={13} />
    </button>
  )
}

function toCurl(r: NonNullable<StepView['result']>['request'] & object): string {
  const parts = [`curl -X ${r.method} '${r.url}'`]
  for (const [name, value] of Object.entries(r.headers)) parts.push(`-H '${name}: ${value}'`)
  if (r.body !== null) parts.push(`--data '${r.body.replaceAll("'", String.raw`'\''`)}'`)
  return parts.join(' \\\n  ')
}

function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

function isStructuredJson(text: string): boolean {
  try {
    const parsed: unknown = JSON.parse(text)
    return parsed !== null && typeof parsed === 'object'
  } catch {
    return false
  }
}

function StepDetails({ step, state, projectId }: { step: StepView; state: RunState; projectId: string }) {
  const r = step.result!
  const checks = r.checks ?? []
  const sorted = [...checks].sort((a, b) => Number(a.passed) - Number(b.passed))
  const [reqMode, setReqMode] = useViewMode(projectId, 'req', 'tree')
  const [respMode, setRespMode] = useViewMode(projectId, 'resp', 'tree')
  // «Дерево» и JSON осмысленны только для структурного тела: объект или массив
  const structured = Boolean(r.response?.contentType?.includes('json')) && isStructuredJson(r.response?.body ?? '')
  const respModes = [
    { id: 'tree', label: t('tree'), enabled: structured },
    { id: 'json', label: 'JSON', enabled: structured },
    { id: 'text', label: t('text'), enabled: !structured },
    { id: 'raw', label: t('raw'), enabled: true },
  ]
  const effRespMode = respModes.find((m) => m.id === respMode)?.enabled ? respMode : structured ? 'tree' : 'text'
  const rawResponse = r.response
    ? [`HTTP ${r.response.status}`, ...Object.entries(r.response.headers).map(([n, v]) => `${n}: ${v}`), '', r.response.body].join('\n')
    : ''
  const failed = checks.filter((c) => !c.passed).length

  return (
    <div className="step-details">
      {checks.length > 0 && (
        <section>
          <header>
            {t('checks')}
            {failed > 0 && ` · ${t('checksFailed', failed, checks.length)}`}
            <CopyButton text={checks.map((c) => `${checkLabel(c)}\t${c.expected}\t${c.actual ?? ''}`).join('\n')} />
          </header>
          {sorted.map((c, i) => (
            <div key={i} className={`check-row ${c.passed ? 'passed' : 'failed'}`}>
              <span className={c.passed ? 'ok' : 'bad'}>{c.passed ? <Check size={12} /> : <Cross size={12} />}</span>
              <span className="mono check-name" title={checkLabel(c)}>
                {checkLabel(c)}
              </span>
              <span className="muted check-label">{t('expected')}</span>
              <span className="mono check-value" title={c.expected}>
                {c.expected}
              </span>
              <span className="muted check-label">{t('actual')}</span>
              <span className={`mono check-value${c.passed ? '' : ' bad'}`} title={c.actual ?? '—'}>
                {c.actual ?? '—'}
              </span>
            </div>
          ))}
        </section>
      )}
      {r.request && (
        <section>
          <header>
            {t('request')}
            <Seg
              modes={[
                { id: 'tree', label: t('fields'), enabled: true },
                { id: 'curl', label: 'cURL', enabled: true },
                { id: 'raw', label: t('raw'), enabled: true },
              ]}
              mode={reqMode}
              onPick={setReqMode}
            />
            <CopyButton text={toCurl(r.request)} />
          </header>
          {reqMode === 'curl' ? (
            <pre className="body-text">{toCurl(r.request)}</pre>
          ) : reqMode === 'raw' ? (
            <pre className="body-text">
              {[`${r.request.method} ${r.request.url}`, ...Object.entries(r.request.headers).map(([n, v]) => `${n}: ${v}`), ...(r.request.body !== null ? ['', r.request.body] : [])].join('\n')}
            </pre>
          ) : (
            <>
              <div className="kv-row">
                <span className="kv-origin">url</span>
                <span className="kv-key">{r.request.method}</span>
                <span className="mono clip" title={r.request.url}>
                  {r.request.url}
                </span>
              </div>
              {Object.entries(r.request.headers).map(([name, value]) => {
                const sub = r.request!.substitutions.find((s) => s.location === `headers.${name}`)
                return (
                  <div key={name} className="kv-row">
                    <span className="kv-origin">header</span>
                    <span className="kv-key">{name}</span>
                    <span className="mono clip" title={value}>
                      {value}
                    </span>
                    {sub && (
                      <span className="sub-badge">
                        ← {sub.var}
                        {sub.fromStep && ` · ${sub.fromStep}`}
                      </span>
                    )}
                  </div>
                )
              })}
              {r.request.body && <RequestBodyRows body={r.request.body} />}
            </>
          )}
        </section>
      )}
      {r.response && (
        <section>
          <header>
            {t('response')} · {r.response.status} · {r.response.contentType?.split(';')[0] ?? '—'} · {r.response.sizeBytes} B
            {r.response.bodyTruncated && ` · ${t('truncated')}`}
            {r.response.body !== '' && <Seg modes={respModes} mode={effRespMode} onPick={setRespMode} />}
            <CopyButton text={effRespMode === 'json' ? prettyJson(r.response.body) : effRespMode === 'raw' ? rawResponse : r.response.body} />
          </header>
          {r.response.body === '' ? null : effRespMode !== 'raw' && r.response.headers['set-cookie'] ? (
            <div className="kv-row">
              <span className="kv-origin">header</span>
              <span className="kv-key">set-cookie</span>
              <span className="mono clip" title={r.response.headers['set-cookie']}>
                {r.response.headers['set-cookie']}
              </span>
              {r.captures?.find((c) => c.from === 'cookie') && (
                <span className="sub-badge">{r.captures.find((c) => c.from === 'cookie')!.name}</span>
              )}
            </div>
          ) : null}
          {r.response.body === '' ? null : effRespMode === 'tree' ? (
            <JsonTree text={r.response.body} />
          ) : effRespMode === 'json' ? (
            <pre className="body-text">{prettyJson(r.response.body)}</pre>
          ) : effRespMode === 'raw' ? (
            <pre className="body-text">{rawResponse}</pre>
          ) : (
            <pre className="body-text">{r.response.body}</pre>
          )}
        </section>
      )}
      {(r.captures?.length ?? 0) > 0 && (
        <section>
          <header>
            {t('variables')}
            <CopyButton text={r.captures!.map((c) => `${c.name}=${c.value}`).join('\n')} />
          </header>
          {r.captures!.map((c) => {
            const usedBy = state.varUsage[c.name]?.usedBy ?? []
            return (
              <div key={c.name} className="capture-row">
                <span className="kv-origin">{c.from}</span>
                <span className="kv-key accent">{c.name}</span>
                <span className="mono clip capture-value" title={c.value}>
                  {c.value}
                </span>
                <span className="muted clip capture-detail" title={c.detail}>
                  {c.detail}
                </span>
                {usedBy.length > 0 && (
                  <span className="sub-badge" title={usedBy.join(', ')}>
                    {t('usedIn', usedBy.length)}
                  </span>
                )}
              </div>
            )
          })}
        </section>
      )}
      {r.error && (
        <section>
          <header className="bad">{t('error')}</header>
          <div className="kv-row mono">{r.error.message}</div>
        </section>
      )}
    </div>
  )
}

function RequestBodyRows({ body }: { body: string }) {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    parsed = undefined
  }
  if (parsed === undefined || parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return <pre className="body-text">{body}</pre>
  }
  return (
    <>
      {Object.entries(parsed as Record<string, unknown>).map(([key, value]) => (
        <div key={key} className="kv-row">
          <span className="kv-origin">body</span>
          <span className="kv-key">{key}</span>
          <span className="mono clip">{typeof value === 'string' ? `"${value}"` : JSON.stringify(value)}</span>
        </div>
      ))}
    </>
  )
}

function checkLabel(check: CheckResult): string {
  switch (check.kind) {
    case 'status':
      return 'status'
    case 'header':
      return `headers.${check.name}`
    case 'body-path':
      return check.path
    case 'body-text':
      return t('bodyText')
  }
}
