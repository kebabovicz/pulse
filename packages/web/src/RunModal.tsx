import { useEffect, useState } from 'react'
import { fetchScenarioDetail, type ScenarioVar } from './api'
import { Cross, Eye, EyeOff } from './icons'
import { t } from './i18n'

// Overrides are remembered per project + scenario pair (DESIGN.md req 13).
const varsKey = (project: string, path: string) => `pulse.vars.${project}.${path}`

export function loadRemembered(project: string, path: string): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(varsKey(project, path)) ?? '{}') as Record<string, string>
  } catch {
    return {}
  }
}

export function RunModal({
  project,
  path,
  onLaunch,
  onClose,
}: {
  project: string
  path: string
  onLaunch: (vars: Record<string, string>) => void
  onClose: () => void
}) {
  const [vars, setVars] = useState<ScenarioVar[] | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [shown, setShown] = useState<Set<string>>(new Set())

  useEffect(() => {
    void fetchScenarioDetail(project, path).then(({ vars }) => {
      setVars(vars)
      setValues(loadRemembered(project, path))
    })
  }, [project, path])

  if (vars === null) return null
  const launch = () => {
    const overrides = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== ''))
    localStorage.setItem(varsKey(project, path), JSON.stringify(overrides))
    onLaunch(overrides)
  }
  if (vars.length === 0) {
    // nothing to ask about without variables: run straight away
    launch()
    return null
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">
          {t('runOf', path)}
          <button className="icon-btn modal-close" onClick={onClose}>
            <Cross size={16} />
          </button>
        </div>
        <div className="modal-section">{t('scenarioVars')}</div>
        {vars.map((v) => (
          <label
            key={v.name}
            className={`var-row${v.secret && !(values[v.name] ?? v.default) ? ' missing-secret' : ''}`}
          >
            <span className="mono">{v.name}</span>
            <input
              type={v.secret && !shown.has(v.name) ? 'password' : 'text'}
              value={values[v.name] ?? ''}
              placeholder={v.default}
              onChange={(e) => setValues({ ...values, [v.name]: e.target.value })}
            />
            {v.secret ? (
              <span className="secret-controls">
                <button
                  className="icon-btn"
                  title={shown.has(v.name) ? t('hideValue') : t('showValue')}
                  onClick={() =>
                    setShown((s) => new Set(s.has(v.name) ? [...s].filter((x) => x !== v.name) : [...s, v.name]))
                  }
                >
                  {shown.has(v.name) ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
                <span className="warn">{t('secret')}</span>
              </span>
            ) : (
              <span className="muted">{values[v.name] ? t('lastUsed') : t('fromFile')}</span>
            )}
          </label>
        ))}
        {vars.some((v) => v.secret && !(values[v.name] ?? v.default)) && (
          <div className="warn modal-warn">{t('emptySecretWarn')}</div>
        )}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            {t('cancel')}
          </button>
          <button className="btn primary" onClick={launch}>
            {t('run')}
          </button>
        </div>
      </div>
    </div>
  )
}
