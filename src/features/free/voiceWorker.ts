import { env, pipeline } from '@huggingface/transformers'

// Never fetch a model or runtime from a third-party host while transcribing.
env.allowLocalModels = true
env.allowRemoteModels = false
env.localModelPath = `${import.meta.env.BASE_URL}models/`
const wasm = env.backends.onnx.wasm
if (!wasm) throw new Error('This browser does not support the local WASM speech runtime')
wasm.wasmPaths = {
  mjs: `${import.meta.env.BASE_URL}wasm/ort-wasm-simd-threaded.asyncify.mjs`,
  wasm: `${import.meta.env.BASE_URL}wasm/ort-wasm-simd-threaded.asyncify.wasm`,
}
wasm.numThreads = 1

let recognizer: Awaited<ReturnType<typeof pipeline<'automatic-speech-recognition'>>> | null = null

self.onmessage = async (event: MessageEvent<{ samples: Float32Array }>) => {
  try {
    self.postMessage({ type: 'loading' })
    recognizer ??= await pipeline('automatic-speech-recognition', 'onnx-community/whisper-tiny', {
      device: 'wasm', dtype: 'q8', local_files_only: true,
    })
    self.postMessage({ type: 'transcribing' })
    const result = await recognizer(event.data.samples, { language: 'chinese', task: 'transcribe' })
    self.postMessage({ type: 'result', text: result.text.trim() })
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}
