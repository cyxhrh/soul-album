import { behaviorSamples, sampleDays, type BehaviorSample, type BehaviorSource } from '../../data/behaviorSamples'
import './data.css'

export type { BehaviorSource } from '../../data/behaviorSamples'
export type BehaviorConsents = Record<BehaviorSource, boolean>

type DataInsightsProps = {
  consents: BehaviorConsents
  onToggle: (source: BehaviorSource) => void
}

function formatValue(value: number, sample: BehaviorSample) {
  const formatted = new Intl.NumberFormat('zh-CN', sample.id === 'spending'
    ? { minimumFractionDigits: 2, maximumFractionDigits: 2 }
    : { maximumFractionDigits: 0 }).format(value)
  return `${formatted} ${sample.unit}`
}

function SourceChart({ sample }: { sample: BehaviorSample }) {
  const maximum = Math.max(...sample.values)

  return <div className="data-visualization">
    <div className="data-chart" role="img" aria-label={`${sample.label}七日图表，2026年9月22日至9月28日，单位${sample.unit}。每日具体数值见数值表格。`}>
      {sample.values.map((value, index) => <div className="data-chart-day" key={sampleDays[index].date} aria-hidden="true">
        <div className="data-chart-track">
          <div className="data-chart-bar" style={{ height: `${maximum === 0 ? 0 : value / maximum * 100}%` }} />
        </div>
        <span>{sampleDays[index].short}</span>
      </div>)}
    </div>
    <p className="data-chart-axis" aria-hidden="true">9 月 · 2026</p>
    <table className="data-values">
      <caption>{sample.label}每日数值</caption>
      <thead><tr><th scope="col">日期</th><th scope="col">数值</th></tr></thead>
      <tbody>{sample.values.map((value, index) => <tr key={sampleDays[index].date}>
        <th scope="row">{sampleDays[index].date}</th><td>{formatValue(value, sample)}</td>
      </tr>)}</tbody>
    </table>
  </div>
}

export default function DataInsights({ consents, onToggle }: DataInsightsProps) {
  const enabledCount = behaviorSamples.filter((sample) => consents[sample.id]).length

  return <div className="data-insights">
    <header className="data-page-header">
      <div>
        <p className="data-eyebrow">只看你选择的资料</p>
        <h1>生活数据</h1>
        <p>按来源单独开启模拟授权，看看日常数字可以怎样被整理。图表仅展示数值，不评价你的状态。</p>
      </div>
      <span className="data-consent-count" aria-label={`已开启 ${enabledCount} 项，共 3 项`}>{enabledCount} <small>/ 3 已开启</small></span>
    </header>

    <p className="data-simulation-note">模拟授权／演示数据，未连接真实设备。此页不读取手机或手表，也不上传数据。</p>

    <div className="data-source-list">
      {behaviorSamples.map((sample) => {
        const enabled = consents[sample.id]
        return <section className={`data-source-card data-source-${sample.id}`} key={sample.id} aria-labelledby={`data-source-title-${sample.id}`}>
          <div className="data-source-head">
            <div>
              <p className="data-source-kicker">模拟资料 / {sample.source}</p>
              <h2 id={`data-source-title-${sample.id}`}>{sample.label}</h2>
              <p>{sample.description}</p>
            </div>
            <button type="button" className="data-consent-button" aria-pressed={enabled} onClick={() => onToggle(sample.id)}>
              {enabled ? `撤回${sample.label}模拟授权` : `开启${sample.label}模拟授权`}
            </button>
          </div>
          {enabled ? <div className="data-source-details">
            <p className="data-source-meta"><span>固定合成样例</span><span>来源：<strong>{sample.source}</strong></span><span>2026年9月22日—9月28日</span><span>单位：{sample.unit}</span></p>
            <SourceChart sample={sample} />
          </div> : <p className="data-source-closed">默认关闭。开启后才显示这项来源的七日合成图表。</p>}
        </section>
      })}
    </div>

    <p className="data-footer-note">这些数字不会自动进入画册，也不会用来推断情绪、健康、人格或消费习惯。刷新页面会清除本次模拟授权。</p>
  </div>
}
