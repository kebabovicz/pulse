import type { ScenarioListItem } from '@pulse/shared'
import type { FileFragment } from './api'
import { t } from './i18n'

/** "Scenario is invalid" screen: parser message plus the offending file fragment. */
export function InvalidScenario({ scenario, fragment }: { scenario: ScenarioListItem; fragment: FileFragment | null }) {
  return (
    <div className="run-screen">
      <div className="run-header">
        <h1 className="mono">{scenario.path}</h1>
        <span className="warn">{t('scenarioInvalid')}</span>
      </div>
      <div className="fail-banner">
        <div>
          <b className="mono">{scenario.error?.message}</b>
          {scenario.error?.line != null && (
            <div className="fail-detail">
              {t('line')} {scenario.error.line}
              {scenario.error.column != null && `, ${t('column')} ${scenario.error.column}`} · {t('parserStopped')}
            </div>
          )}
        </div>
      </div>
      {fragment && (
        <section className="fragment">
          <header className="muted">{t('fileFragment')}</header>
          <pre className="body-text">
            {fragment.lines.map((line, i) => {
              const number = fragment.startLine + i
              return (
                <div key={number} className={`frag-line${number === scenario.error?.line ? ' bad-line' : ''}`}>
                  <span className="frag-num">{number}</span>
                  {line || ' '}
                </div>
              )
            })}
          </pre>
        </section>
      )}
    </div>
  )
}
