import { useEffect, useRef, useState } from 'react'
import { AHE_SCENARIO_VERSION, AHE_SYNTHETIC_SNIPPETS } from '../../../shared/aheScenario'
import './ai.css'

const RULE_QUESTION = '返程过零点后，今天有什么想记下的？'
const SYNTHETIC_ENTRIES = new Map<string, string>(AHE_SYNTHETIC_SNIPPETS.map(({ id, quote }) => [id, quote]))

type GeneratedResult = {
  status: 'generated'
  scenario: 'ahe'
  scenarioVersion: typeof AHE_SCENARIO_VERSION
  question: string
  citations: Array<{ id: string; quote: string }>
  model: { provider: string; id: string }
  generatedAt: string
}

type LabState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'generated'; result: GeneratedResult }
  | { kind: 'fallback'; reason: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function verifiedResult(value: unknown): GeneratedResult | null {
  if (!isRecord(value) || value.status !== 'generated' || value.scenario !== 'ahe' ||
    value.scenarioVersion !== AHE_SCENARIO_VERSION || typeof value.question !== 'string' ||
    value.question.length < 2 || value.question.length > 100 ||
    !/[？?]$/.test(value.question.trim()) || !Array.isArray(value.citations) ||
    value.citations.length === 0 || value.citations.length > SYNTHETIC_ENTRIES.size ||
    !isRecord(value.model) || typeof value.model.provider !== 'string' ||
    !value.model.provider || typeof value.model.id !== 'string' || !value.model.id ||
    typeof value.generatedAt !== 'string' || Number.isNaN(Date.parse(value.generatedAt))) return null

  const citedIds = new Set<string>()
  for (const citation of value.citations) {
    if (!isRecord(citation) || typeof citation.id !== 'string' ||
      typeof citation.quote !== 'string' || citedIds.has(citation.id) ||
      SYNTHETIC_ENTRIES.get(citation.id) !== citation.quote) return null
    citedIds.add(citation.id)
  }
  return value as GeneratedResult
}

function fallbackReason(responseCode: unknown): string {
  switch (responseCode) {
    case 'model_not_configured': return '服务端尚未配置模型密钥，本次没有调用模型。'
    case 'model_timeout': return '模型等待超时，本次没有生成结果。'
    case 'rate_limited': return '合成实验调用次数已达上限，本次没有生成结果。'
    case 'no_reliable_citation': return '模型没有给出可核对的原话引用，本次结果未采用。'
    case 'invalid_model_output': return '模型结果未通过格式与引用检查，本次结果未采用。'
    default: return '模型服务暂时不可用，本次没有生成结果。'
  }
}

export default function AiLab() {
  const [state, setState] = useState<LabState>({ kind: 'idle' })
  const attempt = useRef(0)
  const controller = useRef<AbortController | null>(null)

  useEffect(() => () => {
    attempt.current += 1
    controller.current?.abort()
  }, [])

  function reset() {
    attempt.current += 1
    controller.current?.abort()
    controller.current = null
    setState({ kind: 'idle' })
  }

  async function generate() {
    if (state.kind === 'loading') return
    controller.current?.abort()
    const currentAttempt = ++attempt.current
    const requestController = new AbortController()
    controller.current = requestController
    setState({ kind: 'loading' })

    const timeout = window.setTimeout(() => requestController.abort(), 30_000)
    try {
      const response = await fetch('/api/ai/synthetic-question', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario: 'ahe' }),
        signal: requestController.signal,
        cache: 'no-store',
      })
      const payload: unknown = await response.json()
      if (currentAttempt !== attempt.current || requestController.signal.aborted) return

      if (!response.ok) {
        setState({ kind: 'fallback', reason: fallbackReason(isRecord(payload) ? payload.code : null) })
        return
      }
      const result = verifiedResult(payload)
      setState(result
        ? { kind: 'generated', result }
        : { kind: 'fallback', reason: '返回内容与当前阿禾合成语料不符，结果未采用。' })
    } catch {
      if (currentAttempt !== attempt.current) return
      setState({ kind: 'fallback', reason: requestController.signal.aborted
        ? '模型等待超时，本次没有生成结果。'
        : '网络中断或服务不可用，本次没有生成结果。' })
    } finally {
      window.clearTimeout(timeout)
      if (currentAttempt === attempt.current) controller.current = null
    }
  }

  return (
    <main className="ai-lab" aria-label="阿禾合成 AI 实验">
      <header className="ai-lab-header">
        <div>
          <p className="ai-lab-overline">心灵画册 / 合成 AI 实验</p>
          <h1>让模型问一个有出处的问题</h1>
          <span className="ai-lab-badge">合成数据 · 与自由记录隔离</span>
          <p>以阿禾的虚构记录试验：模型能否提出一条轻问，并引用一整句真实存在于合成语料中的原话。</p>
        </div>
        <nav aria-label="实验导航" className="ai-lab-nav">
          <a href={`${import.meta.env.BASE_URL}?demo=story`}>返回阿禾剧情</a>
          <a href={import.meta.env.BASE_URL}>进入自由每日问答</a>
        </nav>
      </header>

      <div className="ai-lab-grid">
        <section className="ai-lab-card" aria-labelledby="ai-lab-input">
          <span className="ai-lab-index">01 / 固定合成场景</span>
          <h2 id="ai-lab-input">本次会发送什么？</h2>
          <p>浏览器只发送场景代号 <code>ahe</code>。服务端按固定版本选择阿禾的合成片段；不会读取或发送自由聊天中的原话、照片、步数或其他资料。</p>
          <div className="ai-lab-source">
            <span>阿禾的合成原话 · 页面示例</span>
            <blockquote>“返程过零点，今天起床才觉得累。”</blockquote>
            <small>场景版本：{AHE_SCENARIO_VERSION} · 这是虚构测试材料</small>
          </div>
          <button type="button" className="ai-lab-primary" onClick={generate} disabled={state.kind === 'loading'}>
            {state.kind === 'loading' ? '正在等待模型…' : '生成合成提问'}
          </button>
          <p className="ai-lab-note">这次实验结果只显示在本页，不会写入任何日记。没有模型密钥时可查看规则回退。</p>
        </section>

        <section className="ai-lab-card ai-lab-output" aria-labelledby="ai-lab-result">
          <span className="ai-lab-index">02 / 提问与证据</span>
          <h2 id="ai-lab-result">本次结果</h2>
          {state.kind === 'idle' && <p role="status" className="ai-lab-status">尚未调用模型。下方是预设规则示例。</p>}
          {state.kind === 'loading' && <p role="status" className="ai-lab-status">正在请求合成数据模型实验；不会发送你的自由记录。</p>}
          {state.kind === 'generated' && <>
            <p role="status" className="ai-lab-status ai-lab-status-success">模型已生成 · 合成数据 · 引文字面匹配已校验</p>
            <div className="ai-lab-question"><span>模型提议 · 相关性待人工判断</span><p>{state.result.question}</p></div>
            <div className="ai-lab-citations">
              <h3>模型所引原话</h3>
              {state.result.citations.map((citation) => (
                <blockquote key={citation.id}>“{citation.quote}”<small>{citation.id}</small></blockquote>
              ))}
            </div>
            <p className="ai-lab-note">仅核对引用 ID、语料版本与原话逐字匹配；问题与引用是否相关，仍需人工判断。</p>
            <p className="ai-lab-meta">{state.result.model.provider} / {state.result.model.id} · {state.result.generatedAt}</p>
          </>}
          {(state.kind === 'idle' || state.kind === 'fallback') && <>
            {state.kind === 'fallback' && <p role="status" className="ai-lab-status ai-lab-status-fallback">模型未生成 · 规则模式。{state.reason}</p>}
            <div className="ai-lab-question ai-lab-rule"><span>预设规则示例 · 不是模型输出</span><p>{RULE_QUESTION}</p></div>
            <p className="ai-lab-note">规则只引用固定的阿禾场景，不说明模型是否可用；真实 AI 佐证需有实际成功调用及逐字引文核验，问题质量另需人工评估。</p>
          </>}
          {state.kind !== 'idle' && <button type="button" className="ai-lab-reset" onClick={reset}>重置实验</button>}
        </section>
      </div>
    </main>
  )
}
