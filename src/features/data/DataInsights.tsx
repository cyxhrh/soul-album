import { useState } from 'react'
import { behaviorSamples, careBandForValue, sampleDays, type BehaviorSample, type BehaviorSource } from '../../data/behaviorSamples'
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

// 柱子上的短标签：不带千位分隔符，省横向空间；精确值仍由无障碍表格给出
function barLabel(value: number, sample: BehaviorSample) {
  if (sample.id === 'spending') return value % 1 === 0 ? String(value) : value.toFixed(1)
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0, useGrouping: false }).format(value)
}

function SourceChart({ sample }: { sample: BehaviorSample }) {
  const maximum = Math.max(...sample.values)

  return <div className="data-visualization">
    <div className="data-chart" role="img" aria-label={`${sample.label}七日图表，2026年9月22日至9月28日，单位${sample.unit}。每日具体数值见同组的数值表格。`}>
      {sample.values.map((value, index) => <div className="data-chart-day" key={sampleDays[index].date} aria-hidden="true">
        <span className="data-chart-value">{barLabel(value, sample)}</span>
        <div className="data-chart-track">
          <div className="data-chart-bar" style={{ height: `${maximum === 0 ? 0 : value / maximum * 100}%` }} />
        </div>
        <span className="data-chart-day-label">{sampleDays[index].short}</span>
      </div>)}
    </div>
    {/* The table keeps every exact value accessible alongside the chart. */}
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
  const [selectedDay, setSelectedDay] = useState(sampleDays.length - 1)
  const [historyOpen, setHistoryOpen] = useState(false)
  const enabledCount = behaviorSamples.filter((sample) => consents[sample.id]).length

  function toggleSource(source: BehaviorSource) {
    if (!consents[source]) setHistoryOpen(true)
    onToggle(source)
  }

  return <div className="data-insights">
    <header className="data-page-heading">
      <p className="data-eyebrow">由你决定看哪一种资料</p>
      <h1>生活数据</h1>
      <p className="data-simulation-note">固定合成样例 · 模拟授权，未连接真实设备，不读取手机或手表，也不上传数据。</p>
    </header>

    <nav className="data-day-nav" aria-label="报告日期">
      {sampleDays.map((day, index) => <button type="button" key={day.date}
        aria-current={index === selectedDay ? 'date' : undefined}
        onClick={() => setSelectedDay(index)}>{day.date}</button>).reverse()}
    </nav>

    <section className="data-daily-report" aria-labelledby="data-report-title">
      <h2 id="data-report-title" className="data-report-date">2026年{sampleDays[selectedDay].date}</h2>
      <div className="data-report-lines">
        {behaviorSamples.map((sample) => {
          const enabled = consents[sample.id]
          const value = sample.values[selectedDay]
          const band = enabled ? careBandForValue(sample, value) : null
          return <section className={`data-report-line data-source-${sample.id}`} key={sample.id}
            data-consent={enabled ? 'on' : 'off'}
            aria-label={sample.label}>
            <div className="data-report-metric">
              <span>{sample.label}</span>
              <strong>{enabled ? formatValue(value, sample) : '未显示'}</strong>
            </div>
            <p>{enabled ? band?.message : `${sample.description}开启本次页面的模拟授权后显示。`}</p>
            <button type="button" className="data-consent-button" aria-pressed={enabled}
              aria-label={`${enabled ? '撤回' : '开启'}${sample.label}模拟授权`}
              onClick={() => toggleSource(sample.id)}>{enabled ? '隐藏' : '显示'}</button>
          </section>
        })}
      </div>
    </section>

    {enabledCount > 0 && <details className="data-history" open={historyOpen}
      onToggle={(event) => setHistoryOpen(event.currentTarget.open)}>
      <summary>查看七日数据</summary>
      <div className="data-history-content">
        {behaviorSamples.filter((sample) => consents[sample.id]).map((sample) => <section
          className={`data-history-source data-source-${sample.id}`} key={sample.id} aria-label={`${sample.label}七日数据`}>
          <h3>{sample.label}</h3>
          <p className="data-source-meta">固定合成样例 · 来源：{sample.source} · 2026年9月22日—9月28日 · 单位：{sample.unit}</p>
          <SourceChart sample={sample} />
        </section>)}
      </div>
    </details>}

    <details className="data-page-details">
      <summary>详情</summary>
      <div className="data-page-details-content">
        <section><h3>关于这些数据</h3>
          <p>这里使用固定的合成演示数据，没有连接真实手机或手表，也不会上传数据。页面上的模拟授权开关只用于本次体验，不是设备权限或正式授权。</p></section>
        <section><h3>关怀文字如何变化</h3>
          <p>文字只按固定演示数值落入下面的示例区间切换；不能据此判断心情、健康、人格或消费习惯，区间也不是评判标准。</p>
          <ul>{behaviorSamples.map((sample) => <li key={sample.id}>
            <strong>{sample.label}</strong><span>来源：{sample.source}</span>
            <span>示例区间：{sample.careBands.map((band) => band.range).join(' / ')}</span>
          </li>)}</ul>
        </section>
        <section><h3>保存范围</h3>
          <p>报告不会自动进入画册。刷新页面会清除本次模拟授权与显示选择；未授权来源不会显示数值或图表。</p></section>
      </div>
    </details>
  </div>
}
