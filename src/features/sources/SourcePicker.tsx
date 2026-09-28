import type { JournalState } from '../../domain/journal'

type SourcePickerProps = {
  journal: JournalState
  onSetConsent: (sourceId: 'photo' | 'steps', granted: boolean) => void
}

const sources = [
  { id: 'photo', name: '合成照片', description: '一张属于 9 月 23 日的虚构街景示例。' },
  { id: 'steps', name: '模拟步数', description: '只展示一条模拟手表观测，不推断心情或健康。' },
] as const

export default function SourcePicker({ journal, onSetConsent }: SourcePickerProps) {
  return (
    <section className="source-picker screen-only" aria-label="补充资料授权">
      <p className="guided-section-index">03 / 补充资料可单独选择</p>
      <h2>由你决定收录什么</h2>
      <p>这里全是合成示例；未读取真实相册或手表。两条资料只进入 9 月 23 日的合成日页，可翻回该日查看。每项默认关闭，撤回后该日页与打印引用会一同消失。</p>
      <div className="source-picker-list">
        {sources.map((source) => {
          const granted = journal.sourceConsents[source.id]?.granted ?? false
          return <div className="source-picker-item" key={source.id}>
            <div>
              <strong>{source.name}</strong>
              <span>{granted ? '已授权使用 · 模拟资料' : '默认关闭'}</span>
              <p>{source.description}</p>
            </div>
            <button type="button" onClick={() => onSetConsent(source.id, !granted)}>
              {granted ? `撤回${source.name}` : `使用${source.name}`}
            </button>
          </div>
        })}
      </div>
    </section>
  )
}
