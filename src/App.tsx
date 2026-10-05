import GuidedStory from './features/story/GuidedStory'
import FreeTrial from './features/free/FreeTrial'
import RhythmDemo from './features/rhythm/RhythmDemo'
import AiLab from './features/ai/AiLab'
import JudgeDemo from './features/judge/JudgeDemo'

// Kept for the archived showcase page, which is no longer the default route.
export type Entrance = '看引导演示' | '自由试用' | '节奏如何变化'

function App() {
  const demo = new URLSearchParams(window.location.search).get('demo')
  if (demo === 'judge' || import.meta.env.VITE_JUDGE_DEMO === 'true') return <JudgeDemo />
  const openProduct = () => { window.location.href = import.meta.env.BASE_URL }
  if (demo === 'story') return <GuidedStory onBack={openProduct} onEnterFreeTrial={openProduct} />
  if (demo === 'rhythm') return <RhythmDemo onBack={openProduct} />
  if (demo === 'ai') return <AiLab />
  return <FreeTrial />
}

export default App
