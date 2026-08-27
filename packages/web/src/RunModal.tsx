import { useEffect, useState } from 'react'
import { fetchScenarioDetail, type ScenarioVar } from './api'
import { Cross, Eye, EyeOff } from './icons'
import { t } from './i18n'

/** One masking character, repeated: a secret must not leak through a placeholder. */
const MASK = '•'

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

  const launch = (overrides: Record<string, string>) => {
    localStorage.setItem(varsKey(project, path), JSON.stringify(overrides))
    onLaunch(overrides)
  }

  const launchEntered = () => launch(Object.fromEntries(Object.entries(values).filter(([, v]) => v !== '')))

  // nothing to ask about without variables: run straight away, from an effect
  useEffect(() => {
    if (vars?.length === 0) launch({})
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires once the details arrive
  }, [vars])

  if (vars === null || vars.length === 0) return null

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
        {/* the row is a div: a button inside a label gets the label's click as well,
            which cancelled the eye out. The name still focuses the field, through htmlFor. */}
        {vars.map((v) => (
          <div key={v.name} className={`var-row${v.secret && !(values[v.name] ?? v.default) ? ' missing-secret' : ''}`}>
            <label className="mono" htmlFor={`var-${v.name}`}>
              {v.name}
            </label>
            <input
              id={`var-${v.name}`}
              type={v.secret && !shown.has(v.name) ? 'password' : 'text'}
              value={values[v.name] ?? ''}
              // the value from the file shows as a placeholder, so a secret has to
              // be masked there as well — the eye reveals both halves at once
              placeholder={v.secret && !shown.has(v.name) ? MASK.repeat(Math.min(v.default.length, 16)) : v.default}
              onChange={(e) => setValues({ ...values, [v.name]: e.target.value })}
            />
            {v.secret ? (
              <span className="secret-controls">
                <button
                  type="button"
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
          </div>
        ))}
        {vars.some((v) => v.secret && !(values[v.name] ?? v.default)) && (
          <div className="warn modal-warn">{t('emptySecretWarn')}</div>
        )}
        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            {t('cancel')}
          </button>
          <button className="btn primary" onClick={launchEntered}>
            {t('run')}
          </button>
        </div>
      </div>
    </div>
  )
}
