import { useEffect, useRef, useState } from 'react'
import { COMPANIONS, companionImage, MicrophoneIcon } from '../free/ChatIdentity'

export function JudgeCompanionPicker({ id, onSelect }: { id: string; onSelect: (id: string) => void }) {
  const picker = useRef<HTMLDetailsElement>(null)
  const summary = useRef<HTMLElement>(null)
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (picker.current && !picker.current.contains(event.target as Node)) picker.current.open = false
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [])
  function close() {
    if (picker.current) picker.current.open = false
    summary.current?.focus()
  }
  return <details className="messenger-companion-picker" ref={picker} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); close() }
  }}>
    <summary ref={summary} aria-label="选择伙伴" title="换个伙伴"><img src={companionImage(id)} alt="" />
      <span>换个伙伴</span><span aria-hidden="true">⌄</span></summary>
    <div className="messenger-companion-options" role="group" aria-label="渐知伙伴">
      {COMPANIONS.map(item => <button type="button" key={item.id} aria-pressed={id === item.id}
        aria-label={`${item.name}，${item.label}形象`} onClick={() => { onSelect(item.id); close() }}>
        <img src={companionImage(item.id)} alt="" /><strong>{item.name}</strong>
      </button>)}
    </div>
  </details>
}

export function PresetVoiceWave() {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (!window.CanvasRenderingContext2D) return
    const element = canvas.current
    const painter = element?.getContext('2d')
    if (!element || !painter) return
    const color = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#c03d2a'
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    let frame = 0
    function draw(now: number) {
      if (!element || !painter) return
      const scale = window.devicePixelRatio || 1
      const width = element.clientWidth
      const height = element.clientHeight
      element.width = Math.round(width * scale)
      element.height = Math.round(height * scale)
      painter.setTransform(scale, 0, 0, scale, 0, 0)
      const gap = width / 36
      painter.fillStyle = color
      for (let index = 0; index < 36; index++) {
        const level = reduced ? 0.1 : Math.abs(Math.sin(index * 0.54 + now / 260)) * 0.65
        const barHeight = 2 + level * (height - 8)
        painter.globalAlpha = 0.45 + index / (36 * 1.8)
        painter.fillRect(index * gap + gap * 0.27, (height - barHeight) / 2, Math.max(1.5, gap * 0.45), barHeight)
      }
      painter.globalAlpha = 1
      if (!reduced) frame = window.requestAnimationFrame(draw)
    }
    draw(0)
    return () => window.cancelAnimationFrame(frame)
  }, [])
  return <div className="product-wave" aria-hidden="true"><canvas ref={canvas} /><span className="product-wave-still" /></div>
}

function PresetTranscript({ text, onComplete }: { text: string; onComplete: () => void }) {
  const [shown, setShown] = useState(0)
  const characters = Array.from(text)
  const complete = useRef(onComplete)
  complete.current = onComplete
  useEffect(() => {
    let count = 0
    const timer = window.setInterval(() => {
      count = Math.min(count + 3, Array.from(text).length)
      setShown(count)
      if (count >= Array.from(text).length) { window.clearInterval(timer); complete.current() }
    }, 24)
    return () => window.clearInterval(timer)
  }, [text])
  return <p>{characters.slice(0, shown).join('')}<span className="product-transcript-caret" aria-hidden="true" /></p>
}

/** Uses the teammate's original call layout and CSS, driven only by preset messages. */
export function JudgeCall({ name, src, label, nextText, lastReply, lastUser, pending, onSend, onClose }: {
  name: string; src: string; label: string; nextText?: string; lastReply: string; lastUser?: string; pending: boolean
  onSend: () => void; onClose: () => void
}) {
  const [seconds, setSeconds] = useState(0)
  const [phase, setPhase] = useState<'idle' | 'recording' | 'transcribing'>('idle')
  const action = useRef<HTMLButtonElement>(null)
  const exit = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    action.current?.focus()
    const interval = window.setInterval(() => setSeconds(value => value + 1), 1000)
    return () => window.clearInterval(interval)
  }, [])
  function finish() { setPhase('idle'); onSend(); exit.current?.focus() }
  return <section className="product-call-screen screen-only" aria-label="渐知语音通话" onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); onClose() }
  }}>
    <div className="product-call-stage">
      <div className={`product-call-portrait${phase === 'recording' ? ' is-listening' : ''}`}><img src={src} alt={`${name}，渐知的${label}伙伴`} /></div>
      <h1>{phase === 'recording' ? '聆听中' : phase === 'transcribing' ? '正在写下你的话' : pending ? `${name}正在回应` : '准备听你说'}</h1>
      <div className="product-call-dialogue" aria-live="polite">
        {lastUser && phase !== 'transcribing' && <p className="product-call-said">{lastUser}</p>}
        <p className="product-call-reply">{pending ? `稍等，${name}正在输入…` : phase === 'transcribing' ? ' ' : lastReply}</p>
        <p className="product-call-feedback">{nextText ? '预设语音流程 · 无需录音，不播放声音' : '这一段示例已聊完，可以返回对话翻开画册。'}</p>
      </div>
    </div>
    <div className="product-call-controls">
      <div className="product-call-transcript" aria-label="本次语音文字" aria-busy={phase === 'transcribing'}>
        {phase === 'transcribing' && nextText ? <PresetTranscript text={nextText} onComplete={finish} /> : phase === 'recording' ? <PresetVoiceWave /> : null}
      </div>
      <div className="product-call-actions">
        <button type="button" className="product-call-mic" ref={action} disabled={pending || phase === 'transcribing' || !nextText}
          aria-label={phase === 'recording' ? '说完了，转写并发送' : '开始语音对话聆听'} aria-pressed={phase === 'recording'}
          onClick={() => setPhase(value => value === 'recording' ? 'transcribing' : 'recording')}>
          {phase === 'recording' ? <span className="product-voice-stop" aria-hidden="true" /> : <MicrophoneIcon size={28} />}
        </button>
        <button type="button" className="product-call-exit" ref={exit} aria-label="退出语音通话" title="退出语音通话" onClick={onClose}>
          <svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
      <time className="product-call-time" aria-label={`体验已进行 ${seconds} 秒`}>{String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')}</time>
    </div>
  </section>
}
