import type { ReactNode } from 'react'
import { describeEvent } from '../../domain/commands'
import { readableTextOn } from '../../domain/config'
import type { Match, MatchEvent } from '../../domain/types'
import { eventTag, formatTime } from '../format'

export function EventRow({ e, match, extra }: { e: MatchEvent; match: Match; extra?: ReactNode }) {
  const tag = eventTag(e)
  const tagStyle = tag.color ? { background: tag.color, color: readableTextOn(tag.color) } : undefined
  const scoreShown = e.type === 'score' ? e.after : e.score
  return (
    <div className={`ev ${e.voided ? 'voided' : ''}`}>
      <span className="tag" style={tagStyle}>
        {tag.text}
      </span>
      <span>
        <span className="what">{describeEvent(e, match)}</span>
        <span className="meta">
          {formatTime(e.timestamp)} · Set {e.setNumber}
          {'position' in e ? ` · P${e.position}` : ''}
          {e.voided ? ' · anulado' : ''}
        </span>
      </span>
      <span className="row" style={{ gap: 6 }}>
        <span className="score">
          {scoreShown.us}–{scoreShown.them}
        </span>
        {extra}
      </span>
    </div>
  )
}
