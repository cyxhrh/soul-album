import { useEffect, useRef, useState } from 'react'
import type { DailyAlbumResponse } from '../../../shared/dailyAlbum'
import { parseDailyRecord, serializeDailyRecord, type DailyRecord } from './dailyRecord'
import '../../styles/daily-album.css'

type Props = { record: DailyRecord; onSave: (record: DailyRecord) => void; modelReady: boolean; sample?: boolean; timezone?: string; onEditingChange?: (editing: boolean) => void }

function download(record: DailyRecord) {
  const url = URL.createObjectURL(new Blob([serializeDailyRecord(record)], { type: 'text/markdown;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `${record.date}.md`
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function DailyAlbum({ record, onSave, modelReady, sample = false, timezone = Intl.DateTimeFormat().resolvedOptions().timeZone, onEditingChange }: Props) {
  const [side, setSide] = useState<'front' | 'back'>('front')
  const [editing, setEditing] = useState<'front' | 'markdown' | null>(null)
  const [draft, setDraft] = useState('')
  const [title, setTitle] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [candidate, setCandidate] = useState<DailyRecord | null>(null)
  const [editPreview, setEditPreview] = useState<DailyRecord | null>(null)
  const generation = useRef(0)
  const controller = useRef<AbortController | null>(null)
  const version = `${record.date}:${record.revision}:${record.sourceFingerprint}`
  const latestVersion = useRef(version)
  const editingVersion = useRef(version)
  latestVersion.current = version
  useEffect(() => {
    onEditingChange?.(editing !== null)
    if (!editing) return
    const preventLoss = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', preventLoss)
    return () => { window.removeEventListener('beforeunload', preventLoss); onEditingChange?.(false) }
  }, [editing, onEditingChange])
  useEffect(() => {
    generation.current += 1
    controller.current?.abort()
    setPending(false)
    setCandidate(null)
    setEditPreview(null)
    if (editing && editingVersion.current !== version) setError('原记录有更新，编辑草稿已保留。请先复制草稿，再取消并重新打开编辑。')
    else setError('')
    return () => { generation.current += 1; controller.current?.abort() }
  }, [version])

  async function generate() {
    if (pending || sample || !modelReady) return
    const count = record.messages.reduce((sum, message) => sum + Array.from(message.text).length, 0)
    if (count > 30000 || record.messages.length > 200) {
      setError('本日记录超出单次整理范围（30,000 字或 200 条）。完整原文仍可查看和下载，没有截断发送。')
      return
    }
    const ticket = ++generation.current
    const sourceVersion = version
    const abort = new AbortController()
    controller.current = abort
    const timer = window.setTimeout(() => abort.abort(), 45000)
    setPending(true)
    setError('')
    try {
      const response = await fetch('/api/ai/daily-album', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: abort.signal,
        body: JSON.stringify({ date: record.date, messages: record.messages }),
      })
      if (!response.ok) throw new Error(response.status === 429 ? '调用次数已达上限，请稍后再试。' : '这次整理没有完成，原文已保留。请稍后重试。')
      const data: DailyAlbumResponse = await response.json()
      if (data.status !== 'generated' || typeof data.title !== 'string' || typeof data.diary !== 'string' ||
        typeof data.generatedAt !== 'string' || !Number.isFinite(Date.parse(data.generatedAt)) ||
        typeof data.model?.provider !== 'string' || typeof data.model?.id !== 'string') throw new Error('整理结果格式不完整，原文已保留。')
      if (abort.signal.aborted || ticket !== generation.current || latestVersion.current !== sourceVersion) return
      const next: DailyRecord = { ...record, title: data.title, diary: data.diary, portrait: data.portrait,
        revision: record.revision + 1, generatedAt: data.generatedAt, model: data.model, userEdited: false }
      // Validate all portrait fields and user-only references before accepting a network result.
      parseDailyRecord(serializeDailyRecord(next), next)
      if (record.diary || record.userEdited) setCandidate(next)
      else onSave(next)
    } catch (cause) {
      if (ticket === generation.current && latestVersion.current === sourceVersion) {
        setError(abort.signal.aborted ? '整理等待超时，原文已保留，可以稍后重试。' : cause instanceof Error ? cause.message : '暂时无法整理。')
      }
    } finally {
      window.clearTimeout(timer)
      if (ticket === generation.current) setPending(false)
    }
  }

  function startEditing(kind: 'front' | 'markdown') {
    if (pending || candidate) return
    editingVersion.current = version
    setEditing(kind)
    setDraft(kind === 'front' ? record.diary : serializeDailyRecord(record))
    setTitle(record.title)
    setError('')
    setEditPreview(null)
  }

  function saveFront() {
    if (editingVersion.current !== version) { setError('原记录有更新，请保留草稿后重新打开编辑。'); return }
    if (!title.trim()) { setError('给这一页留一个标题吧。'); return }
    onSave({ ...record, title: title.trim(), diary: draft.trim(), userEdited: true, revision: record.revision + 1 })
    setEditing(null)
  }

  function downloadDraft() {
    const text = editing === 'markdown' ? draft : `# ${title}\n\n${draft}\n`
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${record.date}-编辑草稿.md`
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const users = record.messages.filter((message) => message.role === 'user')
  const localTime = (iso: string) => new Intl.DateTimeFormat('zh-CN', { timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso))
  return <article className={`daily-album daily-album-${side}`} aria-label={`${record.date}每日画册`}>
    <div className="daily-toolbar screen-only">
      <div className="daily-face-switch" role="group" aria-label="画册正反面">
        <button type="button" aria-pressed={side === 'front'} disabled={editing !== null} onClick={() => setSide('front')}>日记正面</button>
        <button type="button" aria-pressed={side === 'back'} disabled={editing !== null} onClick={() => setSide('back')}>记录背面</button>
      </div>
      <span className="daily-status">{sample ? '合成示例' : record.userEdited ? '已手动修订' : record.generatedAt ? '已整理' : '原话已收录'}</span>
    </div>
    <div className="daily-paper" key={side}>
      <header className="daily-heading"><p>{record.date.replaceAll('-', ' / ')} <span>{side === 'front' ? '生活日记' : '每日档案 · Markdown'}</span></p>
        <h2>{side === 'front' ? record.title : '这一天的完整记录'}</h2>
        {sample && <p className="daily-sample-note">以下为合成示例，不是你的真实记录。</p>}
      </header>
      {editing === 'front' ? <div className="daily-editor">
        <label htmlFor="daily-title">日记标题</label><input id="daily-title" value={title} maxLength={80} onChange={(event) => setTitle(event.target.value)} />
        <label htmlFor="daily-body">日记正文</label><textarea id="daily-body" value={draft} maxLength={10000} rows={9} onChange={(event) => setDraft(event.target.value)} />
        <div className="daily-actions"><button type="button" onClick={saveFront}>保存日记</button><button type="button" onClick={() => setEditing(null)}>取消</button><button type="button" onClick={downloadDraft}>下载编辑草稿</button></div>
      </div> : editing === 'markdown' ? <div className="daily-editor">
        <p>可修改日记、消息正文与今日肖像。身份和顺序字段用于对应原记录，请保留。</p>
        <label htmlFor="daily-markdown">每日记录 Markdown</label>
        <textarea id="daily-markdown" className="daily-markdown-input" value={draft} rows={20} spellCheck={false} onChange={(event) => { setDraft(event.target.value); setEditPreview(null) }} />
        <div className="daily-actions"><button type="button" onClick={() => {
          if (editingVersion.current !== version) { setError('原记录有更新，请保留草稿后重新打开编辑。'); return }
          try { setEditPreview(parseDailyRecord(draft, record)); setError('') } catch (cause) { setError(cause instanceof Error ? cause.message : '记录格式不完整，请保留原有章节。') }
        }}>预览修改</button><button type="button" onClick={() => { setEditing(null); setEditPreview(null) }}>取消</button><button type="button" onClick={downloadDraft}>下载编辑草稿</button></div>
        {editPreview && <section className="daily-edit-preview" aria-label="修改预览">
          <h3>确认这次修改</h3><p>标题：{editPreview.title}</p><p>{editPreview.diary || '原文发生变化，旧日记与今日肖像已撤下，可重新整理。'}</p>
          {editPreview.messages.filter((m, i) => m.text !== record.messages[i]?.text).map((m) => <blockquote key={m.id}>{m.text}</blockquote>)}
          <p>档案修订不改写当时聊天；整理和导出使用当前修订版。</p>
          <button type="button" onClick={() => { onSave(editPreview); setEditing(null); setEditPreview(null) }}>保存 Markdown 修改</button>
        </section>}
      </div> : side === 'front' ? <>
        {record.diary ? <div className="daily-prose">{record.diary.split(/\n\s*\n/).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div> : <div className="daily-unsorted">
          <p className="daily-overline">已经留下了 {users.length} 段话</p>
          <p>把聊过的小事，整理成今天的一页。</p>
          {users[0] && <blockquote>{Array.from(users[0].text).slice(0, 180).join('')}{Array.from(users[0].text).length > 180 ? '…' : ''}</blockquote>}
          <small>原话摘录 · 完整内容在背面</small>
        </div>}
        <footer className="daily-colophon"><span>{sample ? '合成示例 · 可翻面体验' : record.userEdited ? '由你修订' : record.generatedAt ? '由当天对话整理，可修改' : '原话已保留，尚未生成日记'}</span><span>渐知</span></footer>
      </> : <div className="daily-archive">
        <section><h3>完整对话 <span>{record.messages.length} 条</span></h3>
          <p className="daily-help">原话、模型回应和系统问候分开保留。修订只影响此档案，不改写当时聊天。时间按 {timezone} 显示。</p>
          {record.messages.map((message) => <div className={`daily-message daily-message-${message.role}`} key={message.id} id={`archive-${message.id}`}>
            <div><strong>{message.role === 'user' ? '我' : message.role === 'assistant' ? '小册 · 模型回答' : '系统记录'}</strong><small>{localTime(message.recordedAt)}{message.revised ? ' · 用户修订' : ''}</small></div>
            <p>{message.text}</p><small className="daily-source-id">{message.id}</small>
          </div>)}
        </section>
        <section className="daily-portrait"><h3>今日肖像 <span>暂定理解 · 可纠正</span></h3>
          <p className="daily-help">以你当天分享的内容为依据，不代表固定性格。</p>
          {(['facts', 'feelings', 'uncertainties'] as const).map((field) => <div key={field}><h4>{{ facts: '明确提到的事情', feelings: '自述感受与需求', uncertainties: '仍不确定' }[field]}</h4>
            {record.portrait[field].length ? <ul>{record.portrait[field].map((item, i) => <li key={i}>{item}</li>)}</ul> : <p className="daily-help">{record.generatedAt ? '当天资料不足，暂不判断。' : '尚未整理，不自动推测。'}</p>}</div>)}
          <h4>模型的暂定观察</h4>{record.portrait.observations.map((observation, i) => <div className="daily-observation" key={i}><p>{observation.text}</p><details><summary>查看原话依据</summary>{observation.evidenceIds.map((id) => <blockquote key={id}>{record.messages.find((m) => m.id === id)?.text ?? '来源已失效'}</blockquote>)}</details></div>)}
        </section>
        <details className="daily-file-info"><summary>档案信息</summary><p>修订版本：{record.revision} · {record.generatedAt ? `整理时间：${record.generatedAt}` : '尚未由模型整理'}{record.model ? ` · 模型：${record.model.id}` : ''}</p><p>这是本机浏览器中的记录；下载 .md 可保存到电脑。普通聊天尚未读取跨日档案。</p></details>
      </div>}
    </div>
    {!editing && <div className="daily-bottom screen-only">
      <div className="daily-actions">
        {!sample && <button type="button" className="daily-primary" disabled={pending || !modelReady || !users.length} onClick={() => void generate()}>{pending ? '正在整理…' : '整理今天'}</button>}
        <button type="button" disabled={pending || candidate !== null} onClick={() => startEditing(side === 'front' ? 'front' : 'markdown')}>{side === 'front' ? '编辑日记' : '编辑 Markdown'}</button>
        <button type="button" onClick={() => download(record)}>下载 .md <span aria-hidden="true">↗</span></button>
      </div>
      {!sample && <p className="daily-help">{!modelReady ? '模型暂未连接，可先查看、编辑或下载原文。' : '点击整理，将本日完整对话及档案修订发送给当前模型。'} 翻面与编辑不会发送。</p>}
    </div>}
    {error && <p className="daily-error" role="alert">{error}</p>}
    {candidate && <section className="daily-candidate screen-only" aria-label="整理结果对照"><h3>新整理的一页</h3><p>当前版本保留，采用后才会替换日记与今日肖像。</p><div className="daily-compare"><div><h4>当前日记</h4><p>{record.diary || '尚未填写'}</p></div><div><h4>{candidate.title}</h4><p>{candidate.diary}</p></div></div><details><summary>查看新的今日肖像</summary><p>事实：{candidate.portrait.facts.join('；') || '资料不足'}</p><p>自述感受：{candidate.portrait.feelings.join('；') || '资料不足'}</p>{candidate.portrait.observations.map((observation, i) => <div key={i}><p>{observation.text}</p>{observation.evidenceIds.map(id => <blockquote key={id}>{candidate.messages.find(message => message.id === id)?.text}</blockquote>)}</div>)}<p>仍不确定：{candidate.portrait.uncertainties.join('；') || '未补充'}</p></details><div className="daily-actions"><button type="button" onClick={() => { onSave(candidate); setCandidate(null) }}>采用这次整理</button><button type="button" onClick={() => setCandidate(null)}>保留当前版本</button></div></section>}
  </article>
}
