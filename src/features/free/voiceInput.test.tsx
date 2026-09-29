import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import App from '../../App'

const mediaDevicesDescriptor = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices')
const blobArrayBufferDescriptor = Object.getOwnPropertyDescriptor(Blob.prototype, 'arrayBuffer')

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  if (mediaDevicesDescriptor) Object.defineProperty(navigator, 'mediaDevices', mediaDevicesDescriptor)
  else Reflect.deleteProperty(navigator, 'mediaDevices')
  if (blobArrayBufferDescriptor) Object.defineProperty(Blob.prototype, 'arrayBuffer', blobArrayBufferDescriptor)
  else Reflect.deleteProperty(Blob.prototype, 'arrayBuffer')
})

describe('optional local voice input', () => {
  it('can discard a recording, then transcribe a new one into an unsent draft', async () => {
    const stopTrack = vi.fn()
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] }))
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
    Object.defineProperty(Blob.prototype, 'arrayBuffer', {
      configurable: true, value: async () => new ArrayBuffer(8),
    })
    vi.stubGlobal('matchMedia', () => ({ matches: true }))

    class Recorder {
      state: 'inactive' | 'recording' = 'inactive'
      mimeType = 'audio/webm'
      ondataavailable: ((event: { data: Blob }) => void) | null = null
      onstop: (() => void) | null = null
      onerror: (() => void) | null = null
      start() { this.state = 'recording' }
      stop() {
        this.state = 'inactive'
        this.ondataavailable?.({ data: new Blob(['synthetic audio']) })
        this.onstop?.()
      }
    }
    class AudioDecoder {
      async decodeAudioData() { return { duration: 0.1 } }
      async close() { return undefined }
    }
    class OfflineDecoder {
      destination = {}
      createBufferSource() { return { buffer: null, connect() {}, start() {} } }
      async startRendering() { return { getChannelData: () => new Float32Array(1600).fill(0.1) } }
    }
    const workerCreated = vi.fn()
    class RecognitionWorker {
      onmessage: ((event: MessageEvent<{ type: string; text: string }>) => void) | null = null
      onerror: (() => void) | null = null
      constructor() { workerCreated() }
      postMessage() {
        queueMicrotask(() => this.onmessage?.({ data: { type: 'result', text: '刚才说的一句话' } } as MessageEvent))
      }
      terminate() {}
    }
    vi.stubGlobal('MediaRecorder', Recorder)
    vi.stubGlobal('AudioContext', AudioDecoder)
    vi.stubGlobal('OfflineAudioContext', OfflineDecoder)
    vi.stubGlobal('Worker', RecognitionWorker)

    render(<App />)
    fireEvent.change(screen.getByRole('textbox', { name: '发送消息' }), { target: { value: '原有草稿' } })
    fireEvent.click(screen.getByRole('button', { name: '开始语音输入' }))
    expect(await screen.findByRole('button', { name: '停止聆听并放弃本次语音' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '停止聆听并放弃本次语音' }))
    expect(screen.getByRole('textbox', { name: '发送消息' })).toHaveValue('原有草稿')
    expect(workerCreated).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '开始语音输入' }))
    fireEvent.click(await screen.findByRole('button', { name: '结束聆听并转成文字' }))
    expect(await screen.findByRole('textbox', { name: '发送消息' })).toHaveValue('原有草稿\n刚才说的一句话')
    expect(within(screen.getByRole('region', { name: '对话记录' })).queryByText('刚才说的一句话')).not.toBeInTheDocument()
    expect(workerCreated).toHaveBeenCalledOnce()
    expect(stopTrack).toHaveBeenCalled()
  })
})
