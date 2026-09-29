import { useState } from 'react'
import type { JournalState } from '../../domain/journal'
import type { AlbumView } from '../../domain/selectors'

type AlbumPageProps = {
  mode: 'synthetic' | 'private'
  album: AlbumView
  journal: JournalState
  dateForDay: (day: number) => string
  entryLabels?: Readonly<Record<string, readonly string[]>>
  derivedObservation?: string | null
  onCorrect?: () => void
}

function dateTime(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split('-')
  return `${year}年${Number(month)}月${Number(day)}日 ${iso.slice(11, 16)}`
}

function SourcePhoto({ src, title }: { src: string; title: string }) {
  const [failed, setFailed] = useState(false)
  return failed
    ? <div className="story-source-image-fallback" role="status">合成照片暂时无法显示，资料说明仍可查看</div>
    : <img src={src} alt={`合成照片：${title}`} onError={() => setFailed(true)} />
}

export default function AlbumPage({ mode, album, journal, dateForDay, entryLabels, derivedObservation, onCorrect }: AlbumPageProps) {
  const [evidenceOpenId, setEvidenceOpenId] = useState<string | null>(null)

  return (
    <article className="story-album-page print-page" aria-label={`${dateForDay(album.day)}画册页`}>
      <div className="story-page-spine" aria-hidden="true" />
      <header className="story-page-header">
        <p className="story-page-overline">SOUL ALBUM <span>·</span> {mode === 'private' ? '本次页面记录' : '合成演示'}</p>
        <div className="story-page-date-row">
          <div>
            <p className="story-page-date">{dateForDay(album.day)}</p>
            {mode === 'private' && album.entries.length > 0 &&
              <p className="story-page-overline">演示日期：{album.entries[0].occurredAt.slice(0, 10)}</p>}
            <h2>{album.titleRevision > 0 ? album.title : mode === 'private'
              ? album.entries.length > 0 ? '今天留下的原话' : '今天补充的准确背景'
              : '那天记下的事'}</h2>
          </div>
          <span className="story-page-private">{mode === 'private' ? '本次页面记录' : '合成资料'}</span>
        </div>
        {mode === 'private' && <p className="story-page-revision">若曾单次授权发送片段，百炼可能留存该片段。</p>}
        {album.titleRevision > 0 && <p className="story-page-revision">标题修订第 {album.titleRevision} 版</p>}
      </header>

      <div className="story-page-content">
        {album.entries.length > 0 && <><p className="story-page-section-label">今天的生活 · 来自原话</p>
          <div className="story-entry-list">
          {album.entries.map((entry) => (
            <section className="story-entry" key={entry.id}>
              <p className="story-entry-kind">{(entryLabels?.[entry.id] ?? ['记录片段']).map((label) => <span key={label}>{label}</span>)}</p>
              <blockquote>“{entry.text}”</blockquote>
              <p className="story-entry-source">
                来源：{entry.source} · {mode === 'private' ? '演示日期时间' : '发生'} {dateTime(entry.occurredAt)} · {mode === 'private' ? '本次录入时间' : '记录'} {dateTime(entry.recordedAt)}
                {entry.revision > 1 && ` · 原话修订第 ${entry.revision} 版`}
              </p>
            </section>
          ))}
          </div></>}

        {album.sources.length > 0 && (
          <section className="story-sources" aria-label="已授权补充资料">
            <p className="story-page-section-label">可选资料 · 已授权</p>
            <div className="story-source-list">
              {album.sources.map((fact) => <figure className="story-source-card" key={fact.id}>
                {fact.kind === 'photo' && fact.imageSrc && <SourcePhoto src={fact.imageSrc} title={fact.title} />}
                <figcaption>
                  <strong>{fact.title} <span>· {fact.simulated ? '模拟' : ''}</span></strong>
                  <p>{fact.detail}</p>
                  <small>来源：{fact.source} · 设备：{fact.device}<br />
                    发生 {dateTime(fact.occurredAt)} · 收录 {dateTime(fact.recordedAt)}<br />
                    授权状态：已授权 · 更新 {dateTime(fact.consentUpdatedAt)}</small>
                </figcaption>
              </figure>)}
            </div>
          </section>
        )}

        {album.observations.map((observation) => {
          const evidence = observation.entryIds.flatMap((id) => {
            const entry = journal.entries.find((item) => item.id === id)
            return entry ? [entry] : []
          })
          const pastCount = evidence.filter((entry) => entry.day !== album.day).length
          const evidenceOpen = evidenceOpenId === observation.id
          return <section className="story-observation" aria-label="观察与修正" key={observation.id}>
            <div className="story-observation-heading">
              <span>{observation.status === 'corrected' ? '理解已修正' : 'Agent 暂定解释 · 可纠正'}</span>
              {observation.status === 'corrected' && <span>修正第 {observation.revision} 版</span>}
            </div>
            {observation.status === 'corrected' ? (
              <>
                <div className="story-user-correction" role="group" aria-label={mode === 'private' ? '你的原话修正' : '阿禾原话修正'}>
                  <strong>{mode === 'private' ? '你的原话修正' : '阿禾原话修正'}</strong>
                  <p>“{observation.text}”</p>
                  <small>来源：{mode === 'private' ? '本次页面修正' : '合成剧情中的阿禾修正'}</small>
                </div>
                {derivedObservation && observation.id === album.observation?.id && (
                  <div className="story-agent-reading" role="group" aria-label="Agent 新的暂定观察">
                    <strong>Agent 新的暂定观察</strong>
                    <p>{derivedObservation}</p>
                  </div>
                )}
              </>
            ) : <p className="story-observation-text">{observation.text}</p>}
            <p className="story-observation-basis">{mode === 'private'
              ? album.entries.length > 0
                ? `依据：本页原话与 ${pastCount} 条此前回答。`
                : `依据：${pastCount} 条此前回答，以及你今天的纠正。`
              : `依据：本页原话与 ${pastCount} 条合成历史回答；均为阿禾自述。`}</p>
            <p className="story-observation-uncertain">
              仍不确定：{mode === 'private'
                ? '这些记录不足以判断原因。'
                : observation.status === 'corrected'
                  ? '晚归与次日疲惫曾一起出现，原因仍需更多记录。'
                  : '时间先后不能证明原因，这些自述不足以判断聚会是否造成疲惫。'}
            </p>
            <div className="story-observation-actions screen-only">
              <button type="button" onClick={() => setEvidenceOpenId(evidenceOpen ? null : observation.id)}>
                {evidenceOpen ? '收起观察依据' : '查看观察依据'}
              </button>
              {observation.status !== 'corrected' && onCorrect &&
                <button type="button" className="story-correct" onClick={onCorrect}>不是这样</button>}
            </div>
            {evidenceOpen && (
              <div className="story-evidence screen-only" role="region" aria-label="观察依据">
                <p>下面是这条线索引用的{mode === 'private' ? '当前有效原话' : '合成原话'}；发生时间与归档日分开标明。</p>
                <ul>
                  {evidence.map((entry) => (
                    <li key={entry.id}>
                      <strong>发生：{dateTime(entry.occurredAt)} · 归档页：{dateForDay(entry.day)}</strong>
                      <blockquote>“{entry.text}”</blockquote>
                      <span>来源：{entry.source} · 记录 {dateTime(entry.recordedAt)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        })}
      </div>
      <footer className="story-page-footer">
        <span>{mode === 'private' && album.entries.length === 0
          ? '此页由你的纠正与有效原话整理 · 本次页面记录'
          : `此页由当前有效回答整理 · ${mode === 'private' ? '本次页面记录' : '合成演示'}`}</span>
        <span>{mode === 'private' ? `第 ${album.day} 天` : `${String(album.day).padStart(2, '0')} / 09`}</span>
      </footer>
    </article>
  )
}
