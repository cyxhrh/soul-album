import { useReducer, useRef, useState } from 'react'
import {
  AHE_CORRECTION, AHE_DAYS, AHE_ENTRY_LABELS, AHE_OBSERVATION_ENTRY_IDS, AHE_OBSERVATION_ID,
  AHE_TENTATIVE_READING, AHE_TODAY, AHE_TOMORROW, aheDate,
  aheTodayAnswers, aheTomorrowAnswer, createAheJournal,
  selectAheDerivedReading, selectAheTomorrowQuestion,
} from '../../data/ahe'
import { journalReducer } from '../../domain/journal'
import { selectAlbum, selectComparison } from '../../domain/selectors'
import AlbumPage from '../album/AlbumPage'
import SourcePicker from '../sources/SourcePicker'

type GuidedStoryProps = { onBack: () => void; onEnterFreeTrial: () => void }

export default function GuidedStory({ onBack, onEnterFreeTrial }: GuidedStoryProps) {
  const [journal, dispatch] = useReducer(journalReducer, undefined, createAheJournal)
  const [todayStep, setTodayStep] = useState(0)
  const [storyDay, setStoryDay] = useState<number>(AHE_TODAY)
  const [viewedDay, setViewedDay] = useState<number>(AHE_TODAY)
  const consentTick = useRef(0)

  const album = selectAlbum(journal, viewedDay)
  const tomorrowQuestion = selectAheTomorrowQuestion(journal)
  const tomorrowAnswered = journal.entries.some((entry) => entry.id === aheTomorrowAnswer.id)
  const comparison = selectComparison(journal, AHE_TODAY, AHE_TOMORROW)

  function recordToday() {
    if (todayStep >= aheTodayAnswers.length) return
    const answer = aheTodayAnswers[todayStep]
    dispatch({ type: 'answer', entry: answer.entry, fixedPrompt: answer.prompt })
    if (todayStep === aheTodayAnswers.length - 1) {
      dispatch({
        type: 'addObservation', observation: {
          id: AHE_OBSERVATION_ID, day: AHE_TODAY, text: AHE_TENTATIVE_READING,
          entryIds: AHE_OBSERVATION_ENTRY_IDS, status: 'tentative',
        },
      })
    }
    setTodayStep((step) => step + 1)
    setViewedDay(AHE_TODAY)
  }

  function recordTomorrow() {
    if (tomorrowAnswered) return
    dispatch({ type: 'answer', entry: aheTomorrowAnswer, fixedPrompt: tomorrowQuestion })
    setViewedDay(AHE_TOMORROW)
  }

  function correctObservation() {
    dispatch({ type: 'correctObservation', id: AHE_OBSERVATION_ID, text: AHE_CORRECTION })
  }

  return (
    <main className="guided-shell" aria-label="阿禾引导剧情">
      <header className="guided-header screen-only">
        <div>
          <p className="guided-brand">心灵画册 <span>/</span> 剧情引导</p>
          <h1>阿禾的两天</h1>
          <p>跟着一位合成人物，看两句回答如何变成日页，以及一次纠正怎样改变明天的问题。</p>
        </div>
        <div className="guided-header-actions">
          <span className="guided-synthetic">合成演示</span>
          <button type="button" className="guided-back" onClick={onBack}>← 返回首页</button>
        </div>
      </header>

      <div className="guided-grid">
        <section className="guided-conversation screen-only" aria-label="今日轻问">
          <p className="guided-section-index">01 / 每天只问一点</p>
          {storyDay === AHE_TODAY && todayStep < aheTodayAnswers.length && (
            <div className="guided-question">
              <span className="guided-question-progress">{todayStep + 1} / 2 · 阿禾的合成回答</span>
              <h2>{aheTodayAnswers[todayStep].prompt}</h2>
              <p>这是一段预设剧情。点击后会把下面这句阿禾的合成回答记入画册。</p>
              <blockquote>“{aheTodayAnswers[todayStep].entry.text}”</blockquote>
              <button type="button" className="guided-primary" onClick={recordToday}>记录这句合成回答 <span aria-hidden="true">→</span></button>
            </div>
          )}
          {storyDay === AHE_TODAY && todayStep === aheTodayAnswers.length && (
            <div className="guided-question guided-question-complete">
              <span className="guided-question-progress">2 / 2 · 今日结束</span>
              <h2>今天的两问已结束</h2>
              <p>这页由两句原话整理。先看观察的出处；如果理解不对，阿禾可以马上纠正。</p>
              {tomorrowAnswered ? <p className="guided-recorded-note">次日已记录</p> : <>
                <div className="guided-tomorrow-preview">
                  <span>次日问题预览 · 会随纠正改变</span>
                  <p data-testid="tomorrow-question">{tomorrowQuestion}</p>
                </div>
                <button type="button" className="guided-primary" onClick={() => { setStoryDay(AHE_TOMORROW); setViewedDay(AHE_TOMORROW) }}>
                  模拟第二天 <span aria-hidden="true">→</span>
                </button>
              </>}
            </div>
          )}
          {storyDay === AHE_TOMORROW && !tomorrowAnswered && (
            <div className="guided-question">
              <span className="guided-question-progress">次日 · 根据当前有效记录提问</span>
              <h2>{tomorrowQuestion}</h2>
              <p>还没有回答，所以这一天没有画册页。</p>
              <blockquote>“{aheTomorrowAnswer.text}”</blockquote>
              <button type="button" className="guided-primary" onClick={recordTomorrow}>记录次日合成回答 <span aria-hidden="true">→</span></button>
            </div>
          )}
          {storyDay === AHE_TOMORROW && tomorrowAnswered && (
            <div className="guided-question guided-question-complete">
              <span className="guided-question-progress">次日 · 已回答</span>
              <h2>两天都留在画册里</h2>
              <p>下面的对照只使用两天同一主题的原话。你仍能翻回任一天，打印眼前这一页。</p>
              <button type="button" className="guided-secondary" onClick={() => { setStoryDay(AHE_TODAY); setViewedDay(AHE_TODAY) }}>回到第一天</button>
            </div>
          )}
          {tomorrowAnswered && (
            <section className="guided-question guided-free-handoff" aria-label="剧情结束后继续体验">
              <span className="guided-question-progress">剧情结束 · 轮到你</span>
              <h2>从自己的第一天开始</h2>
              <p>自由区从空白开始，采用规则提问；阿禾的合成记录不会带入。</p>
              <button type="button" className="guided-primary" onClick={onEnterFreeTrial}>
                进入自由每日问答 <span aria-hidden="true">→</span>
              </button>
            </section>
          )}
          <SourcePicker journal={journal} onSetConsent={(sourceId, granted) => {
            // Deterministic synthetic clock; each interaction moves forward one minute.
            const wallTime = new Date(Date.UTC(2026, 8, 23, 20, 25 + consentTick.current++))
            dispatch({ type: 'setSourceConsent', sourceId, granted,
              updatedAt: `${wallTime.toISOString().slice(0, 19)}+08:00` })
          }} />
        </section>

        <div className="guided-album-column">
          <div className="guided-album-tools screen-only">
            <div>
              <p className="guided-section-index">02 / 按天翻阅</p>
              <nav className="guided-day-nav" aria-label="日期目录">
                {AHE_DAYS.map((day) => (
                  <button key={day} type="button" aria-current={viewedDay === day ? 'date' : undefined}
                    onClick={() => setViewedDay(day)}>{`9月${day}日`}{!selectAlbum(journal, day) && ' · 无记录'}</button>
                ))}
              </nav>
            </div>
            {album && <button type="button" className="guided-print" onClick={() => window.print()}>打印当前页 ↗</button>}
          </div>

          {album ? (
            <AlbumPage mode="synthetic" key={viewedDay} album={album} journal={journal} dateForDay={aheDate}
              entryLabels={AHE_ENTRY_LABELS} derivedObservation={selectAheDerivedReading(journal)}
              onCorrect={viewedDay === AHE_TODAY ? correctObservation : undefined} />
          ) : (
            <div className="guided-empty screen-only" role="status">
              <span>空白日</span>
              <h2>这一天还没有回答</h2>
              <p>没有原话，就不会生成一页日记；未回答也不会变成对阿禾的判断。</p>
            </div>
          )}
        </div>
      </div>

      {comparison && (
        <section className="guided-comparison screen-only" role="region" aria-label="两日对照">
          <div className="guided-comparison-heading">
            <span className="guided-section-index">03 / 与过去相比</span>
            <h2>两日对照</h2>
            <p>仅对照同一主题“晚归后的状态”的两句合成原话，不据此判断原因。</p>
          </div>
          <div className="guided-comparison-pages">
            {comparison.entries.map((entry) => (
              <div key={entry.id}>
                <span>{aheDate(entry.day)}</span>
                <blockquote>“{entry.text}”</blockquote>
                <small>来源：{entry.source}</small>
              </div>
            ))}
          </div>
        </section>
      )}
      <p className="guided-footnote screen-only">本页仅使用合成记录和浏览器内存中的交互状态；真实 AI 与设备接入属于下一阶段。</p>
    </main>
  )
}
