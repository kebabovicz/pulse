import { useEffect, useState, type CSSProperties } from 'react'
import { isRequestStep, type Scenario } from '@pulse/shared'
import { fetchScenarioDetail, type ScenarioDetail } from './api'
import { copyWithBadge } from './copy'
import { Copy } from './icons'
import { t } from './i18n'
import { parseDurationLabel } from './runState'
import { ScenarioVars } from './ScenarioVars'
import { ClipValue } from './ui/ClipValue'
import { colWidth, cols } from './ui/columns'

function CopyRaw({ text }: { text: string }) {
  return (
    <button className="icon-btn" title={t('copyHint')} onClick={(e) => copyWithBadge(text, e)}>
      <Copy size={13} />
    </button>
  )
}

/** Labels of the expect and capture columns, so both keep their width in rows that lack them. */
const expectLabel = (step: Scenario['steps'][number], checks: string): string =>
  isRequestStep(step)
    ? `${Array.isArray(step.expect.status) ? step.expect.status.join('|') : step.expect.status} · ${checks}${
        step.retry ? ` · x${step.retry.attempts}` : ''
      }`
    : ''

const captureLabel = (step: Scenario['steps'][number]): string =>
  isRequestStep(step) && step.capture ? `-> ${Object.keys(step.capture).join(', ')}` : ''

/**
 * Every column is sized from the whole step list, so a step without a name, a
 * retry or a capture keeps the columns of its neighbours in place.
 */
function stepCols(steps: Scenario['steps'], checksOf: (step: Scenario['steps'][number]) => string): CSSProperties {
  return cols({
    'id-col': colWidth(
      steps.map((s) => s.id + '  '),
      40,
      10,
    ),
    'name-col': colWidth(
      steps.map((s) => (s.name ? s.name + '  ' : '')),
      30,
    ),
    'expect-col': colWidth(
      steps.map((s) => expectLabel(s, checksOf(s)) + '  '),
      30,
      12,
    ),
    'captures-col': colWidth(
      steps.map((s) => captureLabel(s) + '  '),
      34,
      8,
    ),
  })
}

/** Same text as the row renders, used both for the cell and for its column width. */
const checksLabel = (step: Scenario['steps'][number]): string =>
  isRequestStep(step)
    ? t('checksCount', 1 + Object.keys(step.expect.headers ?? {}).length + (step.expect.body?.length ?? 0))
    : ''

// Scenario tab: a rendered view of the YAML file and its raw text (read-only).
export function ScenarioScreen({ project, path }: { project: string; path: string }) {
  const [detail, setDetail] = useState<ScenarioDetail | null>(null)
  const [mode, setMode] = useState<'rendered' | 'raw'>('rendered')

  // drop stale content when the scenario changes, then load the new one
  const [loadedPath, setLoadedPath] = useState(path)
  if (loadedPath !== path) {
    setLoadedPath(path)
    setDetail(null)
  }
  useEffect(() => {
    void fetchScenarioDetail(project, path).then(setDetail)
  }, [project, path])

  if (!detail) return null
  const scenario = detail.scenario

  return (
    <div className="run-screen">
      <div className="run-header">
        <h1>{scenario?.name ?? detail.summary.name}</h1>
        <span className="run-number">{path}</span>
        <div className="run-actions">
          <span className="seg" style={{ marginLeft: 0 }}>
            {(['rendered', 'raw'] as const).map((m) => (
              <button
                key={m}
                className={`seg-item${mode === m ? ' active' : ''}`}
                disabled={m === 'rendered' && !scenario}
                onClick={() => setMode(m)}
              >
                {m === 'rendered' ? t('rendered') : t('raw')}
              </button>
            ))}
          </span>
          <CopyRaw text={detail.raw} />
        </div>
      </div>
      {mode === 'raw' || !scenario ? (
        <section className="fragment">
          <header className="muted">{path}</header>
          <pre className="body-text" style={{ maxHeight: 'none' }}>
            {detail.raw.split('\n').map((line, i) => (
              <div key={i} className={`frag-line${i + 1 === detail.summary.error?.line ? ' bad-line' : ''}`}>
                <span className="frag-num">{i + 1}</span>
                {line || ' '}
              </div>
            ))}
          </pre>
        </section>
      ) : (
        <>
          {detail.vars.length > 0 && <ScenarioVars key={path} project={project} path={path} vars={detail.vars} />}
          <section className="scn-section" style={stepCols(scenario.steps, checksLabel)}>
            <header>{t('stepsCol')}</header>
            {scenario.steps.map((step, i) => (
              <div key={step.id} className="scn-step">
                <span className="step-num">{i + 1}</span>
                <span className="scn-step-id">{step.id}</span>
                <span className="scn-step-name">{step.name ?? ''}</span>
                {isRequestStep(step) ? (
                  <>
                    <span className="step-method">{step.request.method}</span>
                    <ClipValue className="step-path" text={step.request.path ?? step.request.url ?? ''} />
                    <span className="scn-step-expect">
                      {Array.isArray(step.expect.status) ? step.expect.status.join('|') : step.expect.status}
                      {' · '}
                      {t(
                        'checksCount',
                        1 + Object.keys(step.expect.headers ?? {}).length + (step.expect.body?.length ?? 0),
                      )}
                      {step.retry && <span className="warn"> · ×{step.retry.attempts}</span>}
                    </span>
                    <span className="scn-step-captures">
                      {step.capture && (
                        <ClipValue className="sub-badge" text={`→ ${Object.keys(step.capture).join(', ')}`} />
                      )}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="step-method">—</span>
                    <span className="step-path">
                      {t('pause')} {parseDurationLabel(step.sleep)}
                    </span>
                    <span />
                    <span />
                  </>
                )}
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  )
}
