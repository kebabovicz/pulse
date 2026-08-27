import { Spinner } from '../icons'

/**
 * Fills a panel while its content is on the way. The spinner itself fades in
 * with a delay (see .empty.loading), so a load that resolves at once shows
 * nothing at all instead of a flash.
 */
export function Loading() {
  return (
    <div className="empty loading">
      <Spinner size={16} />
    </div>
  )
}
