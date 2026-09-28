import { useState } from 'react'
import {
  cadenceForDay, changeCadence, createInvitationState, isInvitationDue,
  markInvitationShown, pauseInvitations, resumeInvitations, settleInvitation,
  shareProactively, type Cadence, type InvitationState,
} from '../../domain/invitations'

const cadenceLabel: Record<Cadence, string> = {
  daily: '每日两问', weekly: '每周一问', manual: '仅我主动',
}

function nextDueDay(state: InvitationState, afterDay: number): number | null {
  for (let day = afterDay + 1; day <= afterDay + 28; day++) {
    if (isInvitationDue(state, day)) return day
  }
  return null
}

export default function RhythmDemo({ onBack }: { onBack: () => void }) {
  const [invitation, setInvitation] = useState(() => markInvitationShown(createInvitationState(), 1))
  const [day, setDay] = useState(1)
  const [questionIndex, setQuestionIndex] = useState(0)
  const [answeredInRound, setAnsweredInRound] = useState(false)
  const [choice, setChoice] = useState<Cadence>('daily')
  const [status, setStatus] = useState('')

  const cadence = cadenceForDay(invitation, day)
  const roundClosed = invitation.settledDays.includes(day)
  const due = isInvitationDue(invitation, day) && !roundClosed
  const questionCount = cadence === 'weekly' ? 1 : 2
  const nextDay = nextDueDay(invitation, day)

  function visitDay(next: number, state = invitation) {
    const advanced = next > day ? settleInvitation(state, day, answeredInRound) : state
    const nextCadence = cadenceForDay(advanced, day)
    setInvitation(isInvitationDue(advanced, next) ? markInvitationShown(advanced, next) : advanced)
    if (nextCadence !== cadence) setChoice(nextCadence)
    setStatus(nextCadence !== cadence
      ? `节奏已调为${nextCadence === 'weekly' ? '每周' : '仅我主动'}，你想聊随时来`
      : '')
    setDay(next)
    setQuestionIndex(0)
    setAnsweredInRound(false)
  }

  function finishRound(answered: boolean) {
    const next = settleInvitation(invitation, day, answered)
    const nextCadence = cadenceForDay(next, day)
    const lowered = nextCadence !== cadence
    if (day === 1) {
      visitDay(2, next)
      return
    }
    setInvitation(next)
    if (lowered) setChoice(nextCadence)
    setStatus(lowered
      ? `节奏已调为${nextCadence === 'weekly' ? '每周' : '仅我主动'}，你想聊随时来`
      : answered ? '这轮已记录一条合成回答。' : '这轮已跳过；你想聊随时来。')
  }

  function moveQuestion(answered: boolean) {
    const hasAnswer = answeredInRound || answered
    if (questionIndex + 1 < questionCount) {
      setAnsweredInRound(hasAnswer)
      setQuestionIndex((index) => index + 1)
    } else finishRound(hasAnswer)
  }

  function applyCadence() {
    setInvitation(changeCadence(invitation, choice, day))
    setStatus(`新节奏从第 ${day + 1} 天生效`)
  }

  function resume() {
    const next = resumeInvitations(invitation, day)
    const dueDay = nextDueDay(next, day)
    setInvitation(next)
    setStatus(dueDay === null ? '邀请已恢复；目前只在你主动分享时记录。' : `下次邀请在第 ${dueDay} 天`)
  }

  return (
    <main className="rhythm-shell" aria-label="独立节奏场景">
      <header className="rhythm-header">
        <div>
          <p className="guided-brand">心灵画册 <span>/</span> 独立节奏场景</p>
          <h1>模拟节奏变化</h1>
          <p>这里只演示邀请如何主动退让。日期和回答全是模拟，不进入阿禾画册。</p>
        </div>
        <button type="button" className="guided-back" onClick={onBack}>← 返回首页</button>
      </header>

      <div className="rhythm-layout">
        <section className="rhythm-page" aria-label="当前邀请">
          <p className="guided-section-index">邀请 · 第 {day} 天</p>
          <div className="rhythm-rule" aria-hidden="true" />
          <p className="rhythm-current">当前节奏：{cadenceLabel[cadence]}{invitation.paused && ' · 已暂停'}</p>
          {status && <p className="rhythm-status" role="status">{status}</p>}
          {due ? (
            <div className="rhythm-question">
              <span>第 {day} 天 · 第 {questionIndex + 1} 题</span>
              <h2>{questionIndex === 0 ? '今天有哪件事想记住？' : '还有哪一刻想补充？'}</h2>
              <p>一次只出现一题。跳过整轮才会结算这一个邀请日；回答任一题或主动分享会清零。</p>
              <div className="rhythm-actions">
                <button type="button" className="guided-primary" onClick={() => moveQuestion(true)}>模拟回答这一题 <span aria-hidden="true">→</span></button>
                <button type="button" onClick={() => moveQuestion(false)}>跳过这一题</button>
                <button type="button" onClick={() => finishRound(answeredInRound)}>今天不想答</button>
              </div>
            </div>
          ) : <div className="rhythm-rest" role="note">
            <h2>第 {day} 天不邀请</h2>
            <p>没有新的主动提问；随时可以自己开口。</p>
          </div>}

          {day === 2 && cadence === 'weekly' && <div className="rhythm-next-note">第 8 天不邀请 · 下次邀请在第 9 天</div>}
          {day === 2 && cadence === 'manual' && <div className="rhythm-next-note">仅我主动时不会安排新的邀请。</div>}
          <div className="rhythm-date-actions">
            {day < 8 && <button type="button" onClick={() => visitDay(8)}>模拟来到第 8 天</button>}
            {nextDay !== null && nextDay > day && <button type="button" onClick={() => visitDay(nextDay)}>
              查看第 {nextDay} 天
            </button>}
          </div>
        </section>

        <aside className="rhythm-settings" aria-label="节奏设置">
          <p className="guided-section-index">可由你随时调整</p>
          <h2>节奏由你定</h2>
          <p>自动规则只会放慢邀请，不会替你加快。没有补发、欠账或连续打卡。</p>
          <label htmlFor="cadence-choice">手动调整节奏</label>
          <select id="cadence-choice" value={choice} onChange={(event) => setChoice(event.target.value as Cadence)}>
            <option value="daily">每日两问</option>
            <option value="weekly">每周一问</option>
            <option value="manual">仅我主动</option>
          </select>
          <button type="button" onClick={applyCadence}>应用节奏</button>
          <button type="button" onClick={() => {
            if (invitation.paused) resume()
            else { setInvitation(pauseInvitations(invitation)); setStatus('邀请已暂停') }
          }}>{invitation.paused ? '恢复邀请' : '暂停邀请'}</button>
          <button type="button" onClick={() => {
            setInvitation(shareProactively(invitation))
            setStatus('你已主动分享；之后仍按当前节奏邀请。')
          }}>主动分享一句</button>
          <p className="rhythm-disclaimer">仅调度演示；没有系统通知、真实用户画像或设备连接。</p>
        </aside>
      </div>
    </main>
  )
}
