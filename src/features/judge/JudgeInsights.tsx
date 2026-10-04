import { useEffect, useRef } from 'react'
import type { DailyRecord } from '../album/dailyRecord'
import { AHE_CONFIRMED_CONTEXT, AHE_SYNTHETIC_SNIPPETS } from '../../../shared/aheScenario'

export type SourceSelection = { record: DailyRecord; ids: string[] }
export type OpenSource = (record: DailyRecord, ids: string[]) => void

export function UnderstandingUpdate({ record, confirmed, onSource }: { record: DailyRecord; confirmed: boolean; onSource: OpenSource }) {
  return <section className="judge-understanding-update" aria-label="这次理解的变化">
    <p className="judge-insight-overline">听你补充后，重新理解</p>
    <dl>
      <div><dt><span className="judge-insight-status withdrawn">已撤回</span></dt><dd>聊天时一直提着劲，可能有些耗神。</dd></div>
      <div><dt><span className="judge-insight-status">你说的</span></dt><dd>和朋友待着很放松，回程等车、换车才比较折腾。<button type="button" className="judge-source-button" onClick={() => onSource(record, ['judge-user-3'])}>看你的补充 ↗</button></dd></div>
      <div><dt><span className="judge-insight-status tentative">仍待确认</span></dt><dd>疲惫可能与返程有关，具体原因还不能确定。</dd></div>
      {confirmed && <div><dt><span className="judge-insight-status">用户已确认</span></dt><dd>这次开心，也来自朋友认真听你讲还没做完的项目。<button type="button" className="judge-source-button" onClick={() => onSource(record, ['judge-user-2', 'judge-user-4'])}>看确认的原话 ↗</button></dd></div>}
    </dl>
  </section>
}

export function SourceDialog({ selection, onClose }: { selection: SourceSelection | null; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (selection && !dialog.current?.open) dialog.current?.showModal()
    if (!selection && dialog.current?.open) dialog.current.close()
  }, [selection])
  return <dialog ref={dialog} className="free-print-dialog judge-source-dialog" aria-labelledby="judge-source-title" onClose={onClose}>
    <p className="guided-section-index">原话保留 · 合成示例</p><h2 id="judge-source-title">这句话的来处</h2>
    {selection && <><p className="judge-source-date">{selection.record.date.replaceAll('-', '.')} · {selection.record.title}</p>
      {selection.ids.map(id => selection.record.messages.find(message => message.id === id)).filter(message => message !== undefined)
        .map(message => <blockquote key={message.id}><small>{message.role === 'user' ? '用户原话' : '知知 · 预设回复'}</small><p>{message.text}</p></blockquote>)}
      <p className="daily-help">这些话是理解的依据；有联系，并不等于已经确定原因。</p></>}
    <button type="button" className="product-details-close" onClick={() => dialog.current?.close()}>回到阅读</button>
  </dialog>
}

/** Historical response copied from the existing experiment record, never a live request. */
export function AIPractice() {
  return <details className="judge-ai-practice">
    <summary>AI 技术实践 · 查看一次真实千问实验</summary>
    <section aria-label="真实 AI 实践记录">
      <p className="judge-insight-overline">2026.09.29 · 历史实验记录</p><h3>从生活片段提出有依据的追问</h3>
      <p>本地服务通过阿里云百炼调用 qwen3.8-flash，一次请求返回 HTTP 200。使用虚构人物“阿禾”的固定资料；下面展示已保存的输入与实际输出，此处不会重新调用模型。</p>
      <h4>合成输入</h4><ul>{AHE_SYNTHETIC_SNIPPETS.map(item => <li key={item.id}>{item.quote}</li>)}</ul><p>{AHE_CONFIRMED_CONTEXT}</p>
      <h4>模型实际返回</h4><blockquote>阿禾，你提到和朋友相处很开心，但返程过零点后第二天起床很累，这两件事之间有什么联系吗？</blockquote>
      <h4>返回的原话引用</h4><ul><li>昨晚见了朋友，聊天很开心。</li><li>返程过零点，今天起床才觉得累。</li></ul>
      <p>服务端检查了回复结构、轻问格式和引文逐字匹配。这个问题仍是待用户确认的提议，不能直接当作因果结论。</p>
      <dl className="judge-practice-boundaries"><div><dt>当前演示</dt><dd>五轮对话、画册和下一次见面均为预设流程。</dd></div><div><dt>已验证</dt><dd>一次真实模型请求，返回提问与两条原话引用。</dd></div><div><dt>后续目标</dt><dd>持续记忆、跨天理解与后续交流的完整模型链路；目前不能用这次实验证明已完成。</dd></div></dl>
      <p className="daily-help">实验保留了文本记录，尚无原始请求与响应截图，不代表长期质量验证。</p>
      <a className="judge-source-button" href={`${import.meta.env.BASE_URL}evidence/qwen-synthetic-trial-2026-09-29.md`} download="渐知-千问真实实验记录.md">下载实验记录 .md ↗</a>
    </section>
  </details>
}
