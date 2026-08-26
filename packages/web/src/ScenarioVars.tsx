import { useState } from 'react'
import { saveVarDefaults, type ScenarioVar } from './api'
import { Check, Eye, EyeOff } from './icons'
import { t } from './i18n'

/**
 * Default values of scenario variables, editable in place. This is where a
 * stand keeps its secrets: CI runs read the same file, so updating a password
 * here is all it takes to keep the deploy suite green.
 */
export function ScenarioVars({ project, path, vars }: { project: string; path: string; vars: ScenarioVar[] }) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(vars.map((v) => [v.name, v.default])),
  )
  const [shown, setShown] = useState<Set<string>>(new Set())
  const [saved, setSaved] = useState(false)

  const dirty = vars.some((v) => values[v.name] !== v.default)

  const save = async () => {
    const changed = Object.fromEntries(
      vars.filter((v) => values[v.name] !== v.default).map((v) => [v.name, values[v.name]]),
    )
    try {
      await saveVarDefaults(project, path, changed)
    } catch (e) {
      return alert((e as Error).message)
    }
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  const toggleShown = (name: string) =>
    setShown((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })

  return (
    <section className="scn-section">
      <header>
        {t('variables')}
        <span className="muted vars-hint">{t('defaultsHint')}</span>
        {saved && (
          <span className="ok vars-saved">
            <Check size={12} /> {t('saved')}
          </span>
        )}
        <button className="btn primary vars-save" disabled={!dirty} onClick={() => void save()}>
          {t('save')}
        </button>
      </header>
      {vars.map((v) => (
        <div key={v.name} className="scn-var editable">
          <span className="kv-origin">var</span>
          <span className="kv-key">{v.name}</span>
          <input
            className="filter-input var-input"
            type={v.secret && !shown.has(v.name) ? 'password' : 'text'}
            autoComplete="off"
            spellCheck={false}
            data-bwignore="true"
            data-1p-ignore="true"
            data-lpignore="true"
            value={values[v.name] ?? ''}
            onChange={(e) => setValues({ ...values, [v.name]: e.target.value })}
          />
          <span className="scn-var-source">
            {v.secret && (
              <button
                className="icon-btn"
                title={shown.has(v.name) ? t('hideValue') : t('showValue')}
                onClick={() => toggleShown(v.name)}
              >
                {shown.has(v.name) ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            )}
          </span>
          <span className="muted scn-var-source">
            {v.secret ? <span className="warn">{t('secret')}</span> : t('defaultLabel')}
          </span>
        </div>
      ))}
    </section>
  )
}
