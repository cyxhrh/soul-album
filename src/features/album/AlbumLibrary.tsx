import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { DailyRecord } from './dailyRecord'
import './album-library.css'

export const ALBUM_PAGE_SIZE = 12
const monthNames = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月']
function monthLabel(month: string) { return `${month.slice(0, 4)}年${Number(month.slice(5))}月` }
function dateLabel(date: string) { return `${date.slice(0, 4)}年${Number(date.slice(5, 7))}月${Number(date.slice(8))}日` }

export function matchesAlbum(record: DailyRecord, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase()
  return !needle || [record.title, record.diary, ...record.messages.filter(message => message.role === 'user').map(message => message.text)]
    .some(text => text.toLocaleLowerCase().includes(needle))
}

export function albumExcerpt(record: DailyRecord, query: string): string {
  const needle = query.trim().toLocaleLowerCase()
  const source = needle ? [record.diary, ...record.messages.filter(message => message.role === 'user').map(message => message.text)]
    .find(text => text.toLocaleLowerCase().includes(needle)) ?? record.diary : record.diary
  const plain = source.replace(/\s+/g, ' ').trim() || '今天这一页，等你留下一句话。'
  const found = needle ? plain.toLocaleLowerCase().indexOf(needle) : 0
  const start = Math.max(0, found - 28)
  return `${start ? '…' : ''}${plain.slice(start, start + Math.max(110, needle.length + 40))}${plain.length > start + Math.max(110, needle.length + 40) ? '…' : ''}`
}

function Highlight({ text, query }: { text: string; query: string }) {
  const needle = query.trim()
  const index = needle ? text.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase()) : -1
  if (index === -1) return <>{text}</>
  return <>{text.slice(0, index)}<mark>{text.slice(index, index + needle.length)}</mark>{text.slice(index + needle.length)}</>
}

/** Read-only navigation over supplied records. No storage, model or account dependencies. */
export default function AlbumLibrary({ records, todayDate, selectedDate, active, onSelect, renderRecord }: {
  records: DailyRecord[]
  todayDate: string
  selectedDate: string | null
  active: boolean
  onSelect: (date: string | null) => void
  renderRecord: (record: DailyRecord) => ReactNode
}) {
  const sorted = useMemo(() => [...records].sort((a, b) => b.date.localeCompare(a.date)), [records])
  const months = useMemo(() => [...new Set(sorted.map(record => record.date.slice(0, 7)))], [sorted])
  const years = [...new Set(months.map(month => month.slice(0, 4)))]
  const [month, setMonth] = useState(months[0] ?? todayDate.slice(0, 7))
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(ALBUM_PAGE_SIZE)
  const search = query.trim()
  const matching = sorted.filter(record => search ? matchesAlbum(record, search) : record.date.startsWith(month))
  const visible = matching.slice(0, limit)
  const selected = sorted.find(record => record.date === selectedDate)
  const index = selected ? sorted.indexOf(selected) : -1
  const listScroll = useRef(0)
  const originDate = useRef<string | null>(null)
  const returnButton = useRef<HTMLButtonElement>(null)
  const chooser = useRef<HTMLDetailsElement>(null)

  useLayoutEffect(() => {
    if (!active) return
    window.scrollTo({ top: selectedDate ? 0 : listScroll.current, behavior: 'instant' })
    if (selectedDate) returnButton.current?.focus({ preventScroll: true })
    else if (originDate.current) document.getElementById(`album-card-${originDate.current}`)?.focus({ preventScroll: true })
  }, [selectedDate, active])

  function open(date: string) {
    if (!selectedDate) { listScroll.current = window.scrollY; originDate.current = date }
    onSelect(date)
  }
  function selectMonth(value: string) {
    setMonth(value)
    setQuery('')
    setLimit(ALBUM_PAGE_SIZE)
    listScroll.current = 0
    originDate.current = null
    onSelect(null)
    if (chooser.current) chooser.current.open = false
    window.scrollTo({ top: 0, behavior: 'instant' })
  }
  function monthTree() {
    return years.map(year => <details className="album-year" key={year} open={year === years[0] ? true : undefined}>
      <summary>{year}<span>{months.filter(value => value.startsWith(year)).length} 个月</span></summary>
      <div>{months.filter(value => value.startsWith(year)).map(value => <button type="button" key={value}
        aria-label={monthLabel(value)} aria-current={!search && month === value ? 'date' : undefined} onClick={() => selectMonth(value)}>
        <span>{monthNames[Number(value.slice(5)) - 1]}</span><small>{sorted.filter(record => record.date.startsWith(value)).length} 页</small>
      </button>)}</div>
    </details>)
  }

  return <div className="album-library">
    <aside className="album-library-sidebar" aria-label="画册月份目录"><p className="album-library-overline">生活的章节</p>{monthTree()}<p className="album-library-note">想说的时候，<br />再添一页。</p></aside>
    <div className="album-library-main">
      {selected ? <div className="album-reader">
        <div className="album-reader-bar"><button type="button" className="album-quiet-button" ref={returnButton} onClick={() => onSelect(null)}>← {search ? '返回搜索结果' : `返回${monthNames[Number(month.slice(5)) - 1]}目录`}</button><span>{dateLabel(selected.date)}</span></div>
        {renderRecord(selected)}
        <nav className="album-reader-nav" aria-label="相邻记录">
          <button type="button" disabled={index >= sorted.length - 1} onClick={() => open(sorted[index + 1].date)}>← 上一条记录</button>
          <span>慢慢翻，慢慢看</span>
          <button type="button" disabled={index <= 0} onClick={() => open(sorted[index - 1].date)}>下一条记录 →</button>
        </nav>
      </div> : <>
        <div className="album-library-tools">
          <details className="album-month-chooser" ref={chooser} onKeyDown={event => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus() } }}><summary aria-label="选择月份">{monthLabel(month)} <span aria-hidden="true">⌄</span></summary><div>{monthTree()}</div></details>
          <div className="album-search"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="10" cy="10" r="6" /><path d="m15 15 5 5" /></svg><input type="search" aria-label="搜索全部记录" placeholder="找找那天说过的话…" value={query} onChange={event => { setQuery(event.target.value); setLimit(ALBUM_PAGE_SIZE) }} />{query && <button type="button" aria-label="清除搜索" onClick={() => { setQuery(''); setLimit(ALBUM_PAGE_SIZE) }}>×</button>}</div>
          <button type="button" className="album-today-button" onClick={() => open(todayDate)}>回到今天 ↗</button>
        </div>
        <header className="album-chapter-heading"><p className="album-library-overline">{search ? '在生活片刻里寻找' : `${month.slice(0, 4)} · 生活画册`}</p><h2>{search ? `关于「${search}」` : monthNames[Number(month.slice(5)) - 1]}</h2><p role="status">{search ? `找到 ${matching.length} 页记录 · 搜索日记与用户原话` : `${matching.length} 页生活片刻，想起来时就翻一翻。`}</p></header>
        {search && <p className="album-search-context">搜索范围：全部月份</p>}
        {matching.length ? <div className="album-record-grid" aria-label={search ? '搜索结果' : '本月记录'}>
          {visible.map((record, position) => <div className="album-record-slot" key={record.date}>
            {search && (position === 0 || visible[position - 1].date.slice(0, 7) !== record.date.slice(0, 7)) && <p className="album-result-month">{monthLabel(record.date.slice(0, 7))}</p>}
            <button type="button" className="album-record-card" id={`album-card-${record.date}`} aria-label={`阅读 ${dateLabel(record.date)}的记录`} onClick={() => open(record.date)}>
              <div className="album-card-date"><span>{Number(record.date.slice(5, 7))}月{Number(record.date.slice(8))}日</span><small>{record.date === todayDate ? '今天' : new Intl.DateTimeFormat('zh-CN', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${record.date}T12:00:00Z`))}</small></div>
              <h3><Highlight text={record.title} query={search} /></h3><p><Highlight text={albumExcerpt(record, search)} query={search} /></p><span className="album-card-open">翻开这一页 <span aria-hidden="true">↗</span></span>
            </button>
          </div>)}
        </div> : <div className="album-search-empty"><h3>还没找到这个片刻</h3><p>换一个词试试，比如「朋友」「陶艺」或「台灯」。</p><button type="button" className="album-quiet-button" onClick={() => { setQuery(''); setLimit(ALBUM_PAGE_SIZE) }}>返回月份目录</button></div>}
        {matching.length > visible.length && <div className="album-load-more"><button type="button" onClick={() => setLimit(previous => previous + ALBUM_PAGE_SIZE)}>再翻 {Math.min(ALBUM_PAGE_SIZE, matching.length - visible.length)} 页</button><span>已展开 {visible.length} / {matching.length} 页</span></div>}
        <p className="album-library-footnote">共 {records.length} 页跨月合成示例，用来体验画册逐渐变厚后的样子。</p>
      </>}
    </div>
  </div>
}
