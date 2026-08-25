import { useEffect, useState } from 'react'
import { isRequestStep } from '@pulse/shared'
import { fetchScenarioDetail, type ScenarioDetail } from './api'
import { copyWithBadge } from './copy'
import { Copy } from './icons'
import { t } from './i18n'
import { parseDurationLabel } from './runState'

function CopyRaw({ text }: { text: string }) {
  return (
    <button className="icon-btn" title={t('copyHint')} onClick={(e) => copyWithBadge(text, e)}>
      <Copy size={13} />
    </button>
  )
}

// Вкладка Scenario: читаемый вид YAML-файла и сырой текст (read-only).
export function ScenarioScreen({ project, path }: { project: string; path: string }) {
  const [detail, setDetail] = useState<ScenarioDetail | null>(null)
  const [mode, setMode] = useState<'rendered' | 'raw'>('rendered')

  useEffect(() => {
    setDetail(null)
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
      <div className="run-status muted">
        {detail.description ?? ''}
        {detail.description ? ' · ' : ''}
        <span className="muted">{t('editHint')}</span>
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
          {detail.vars.length > 0 && (
            <section className="scn-section">
              <header>{t('variables')}</header>
              {detail.vars.map((v) => (
                <div key={v.name} className="scn-var">
                  <span className="kv-origin">var</span>
                  <span className="kv-key">{v.name}</span>
                  <span className="mono clip">{v.secret ? '•••' : v.default}</span>
                  <span className="muted scn-var-source">
                    {v.secret ? <span className="warn">{t('secret')}</span> : t('defaultLabel')}
                  </span>
                </div>
              ))}
            </section>
          )}
          <section className="scn-section">
            <header>{t('stepsCol')}</header>
            {scenario.steps.map((step, i) => (
              <div key={step.id} className="scn-step">
                <span className="step-num">{i + 1}</span>
                <span className="scn-step-id" title={step.id}>
                  {step.id}
                </span>
                <span className="muted clip" title={step.name ?? undefined}>
                  {step.name ?? ''}
                </span>
                {isRequestStep(step) ? (
                  <>
                    <span className="step-method">{step.request.method}</span>
                    <span className="step-path" title={step.request.path ?? step.request.url}>
                      {step.request.path ?? step.request.url}
                    </span>
                    <span className="scn-step-expect">
                      {Array.isArray(step.expect.status) ? step.expect.status.join('|') : step.expect.status}
                      {' · '}
                      {t('checksCount', 1 + Object.keys(step.expect.headers ?? {}).length + (step.expect.body?.length ?? 0))}
                      {step.retry && <span className="warn"> · ×{step.retry.attempts}</span>}
                    </span>
                    <span className="scn-step-captures">
                      {step.capture && (
                        <span className="sub-badge" title={Object.keys(step.capture).join(', ')}>
                          → {Object.keys(step.capture).join(', ')}
                        </span>
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
