import { useEffect, useState } from 'react'
import type { FixtureItem } from '@pulse/shared'
import { deleteScenario, fixtureUrl } from './api'
import { t } from './i18n'
import { fileLabel } from './runState'
import { notify } from './ui/toast'

const IMAGE = /\.(png|jpe?g|gif|webp|svg)$/i
const TEXT = /\.(txt|json|csv|xml|md|ya?ml|log)$/i
/** Enough of a text fixture to see what it is; the rest is a download, not a preview. */
const TEXT_CUT = 20_000

const fmtBytes = (n: number): string =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`

/**
 * A fixture is not a scenario: it cannot be run or edited here. The screen
 * answers the two questions that matter — what is in the file, and who uploads
 * it — so it is clear whether the file can go.
 */
export function FixtureScreen({
  project,
  fixture,
  onOpenScenario,
  onDeleted,
}: {
  project: string
  fixture: FixtureItem
  onOpenScenario: (path: string) => void
  onDeleted: () => void
}) {
  const [text, setText] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const isImage = IMAGE.test(fixture.path)
  const isText = TEXT.test(fixture.path)

  // drop the previous file's text before the new one arrives, the same way the
  // scenario screen does — without touching state from inside the effect
  const [loadedPath, setLoadedPath] = useState(fixture.path)
  if (loadedPath !== fixture.path) {
    setLoadedPath(fixture.path)
    setText(null)
  }
  useEffect(() => {
    if (!isText) return
    void fetch(fixtureUrl(project, fixture.path))
      .then((r) => r.text())
      .then((body) => setText(body.slice(0, TEXT_CUT)))
      .catch(() => setText(null))
  }, [project, fixture.path, isText])

  return (
    <div className="run-screen">
      <div className="run-header">
        <h1>{fileLabel(fixture.path)}</h1>
        <span className="run-number">{fixture.path}</span>
        <div className="run-actions">
          <button
            className={`btn${confirming ? ' danger' : ''}`}
            onClick={() => {
              if (!confirming) return setConfirming(true)
              void deleteScenario(project, fixture.path)
                .catch((e: Error) => notify(e.message))
                .then(onDeleted)
            }}
          >
            {confirming ? t('sure') : t('deleteBtn')}
          </button>
        </div>
      </div>
      <div className="run-meta">
        {fmtBytes(fixture.sizeBytes)}
        {' · '}
        {new Date(fixture.modifiedAt).toLocaleString()}
      </div>

      <section className="scn-section">
        <header>{t('fixtureUsedIn')}</header>
        {fixture.usedBy.length === 0 ? (
          <div className="kv-row muted">{t('fixtureUnusedHint')}</div>
        ) : (
          fixture.usedBy.map((path) => (
            <div key={path} className="kv-row">
              <span className="kv-origin">yaml</span>
              <button className="link" onClick={() => onOpenScenario(path)}>
                {path}
              </button>
            </div>
          ))
        )}
      </section>

      <section className="scn-section">
        <header>{t('fixturePreview')}</header>
        {isImage ? (
          <div className="fixture-preview">
            <img src={fixtureUrl(project, fixture.path)} alt={fixture.path} />
          </div>
        ) : isText ? (
          <pre className="body-text">{text ?? ''}</pre>
        ) : (
          <div className="kv-row muted">{t('fixtureNoPreview')}</div>
        )}
      </section>
    </div>
  )
}
