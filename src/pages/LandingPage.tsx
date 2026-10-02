import type { Entrance } from '../App'

type LandingPageProps = {
  onNavigate: (entrance: Entrance) => void
}

function AlbumPreview() {
  return (
    <div className="preview-wrap">
      <div className="preview-caption">
        <span>一页画册会是什么样</span>
        <span>静态样页</span>
      </div>
      <article className="album-page" aria-label="合成画册预览">
        <div className="album-spine" aria-hidden="true" />
        <header className="album-header">
          <div className="album-date">
            <span className="album-month">2026 / SEPTEMBER</span>
            <div><strong>23</strong><span>星期三</span></div>
          </div>
          <span className="album-privacy">仅自己可见 · 合成演示资料</span>
        </header>

        <div className="album-body">
          <span className="timeline-node" aria-hidden="true" />
          <p className="album-kicker">今天的一句话</p>
          <h3>见了朋友，<br />回来得晚了一点。</h3>
          <p className="album-summary">开心和疲惫可以同时存在。这里先记下发生的事，原因留给自己慢慢确认。</p>
          <div className="quote-block">
            <span className="quote-mark" aria-hidden="true">“</span>
            <blockquote>见朋友很开心，返程过零点，今天起床有点累。</blockquote>
            <p>来源：当天回答 · 20:14</p>
          </div>
          <div className="correction-note">
            <span className="correction-symbol" aria-hidden="true">↳</span>
            <div>
              <strong>修正后保留</strong>
              <p>晚归和次日疲惫曾一起出现，原因仍未确定。</p>
            </div>
          </div>
        </div>
        <footer className="album-footer">
          <span>合成样页 · 来源与修正示意</span>
          <span>PAGE 023</span>
        </footer>
      </article>
      <p className="preview-footnote">这是一张静态合成预览页，不代表真实用户资料或已完成的 AI 分析。</p>
    </div>
  )
}

export default function LandingPage({ onNavigate }: LandingPageProps) {
  return (
    <div className="site-shell">
      <header className="site-header">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <div>
            <h1>渐知</h1>
            <span>AI 生活伙伴</span>
          </div>
        </div>
        <span className="header-aside">把日子留在自己手里</span>
      </header>

      <main>
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow"><span className="eyebrow-line" aria-hidden="true" /> 合成引导剧情现可体验</p>
            <h2 id="hero-title">每天聊几句，<br /><em>慢慢看见自己。</em></h2>
            <p className="tagline">慢慢认识你，陪你看见自己</p>
            <p className="hero-description">不用写长篇日记。走进阿禾的合成故事，依次收录两句预设回答，看原话变成日页；翻看来源，觉得不对就纠正暂定观察。右侧是静态合成预览。</p>
            <div className="hero-actions">
              <button className="primary-button" type="button" onClick={() => onNavigate('看引导演示')}>
                看引导演示 <span aria-hidden="true">↗</span>
              </button>
              <button className="secondary-button" type="button" onClick={() => onNavigate('自由试用')}>
                自由试用 <span aria-hidden="true">→</span>
              </button>
            </div>
            <button className="rhythm-link" type="button" onClick={() => onNavigate('节奏如何变化')}>
              <span className="rhythm-icon" aria-hidden="true">↘</span> 节奏如何变化 <span aria-hidden="true">→</span>
            </button>
            <p className="hero-disclaimer">当前为前端展示阶段。合成引导、模拟来源与独立节奏变化已可操作；自由试用现可操作，采用规则模式，输入只保留在本次页面。真实 AI 和设备接入属于下一阶段。</p>
          </div>
          <AlbumPreview />
        </section>

        <section className="mechanism" aria-label="画册如何形成">
          <div className="mechanism-heading">
            <h2>从一段对话开始</h2>
            <p>阿禾的合成剧情可回看、追溯和纠正；自由试用可以写下自己的两天原话，查看画册与对照。</p>
          </div>
          <ol>
            <li><span>01 / 轻问</span><strong>一次只问一个问题</strong><p>阿禾的合成剧情用两句回答形成当天日页。</p></li>
            <li><span>02 / 回看</span><strong>让每页有出处</strong><p>日期、原话和回答时间留在页边，也能展开过去的引用。</p></li>
            <li><span>03 / 修正</span><strong>让修正留在页上</strong><p>点击“不是这样”，旧解释撤下，次日问题跟着改变。</p></li>
          </ol>
        </section>
      </main>
      <footer className="site-footer"><span>渐知</span><span>慢慢认识你，陪你看见自己。</span></footer>
    </div>
  )
}
