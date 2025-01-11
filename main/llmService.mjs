import { getLlama, LlamaChatSession } from 'node-llama-cpp'

process.parentPort.on('message', (e) => {
  e.ports[0].addListener('message', function (e2) {
    console.log(e2)
    handleRequest(e2.data).then(res => e.ports[0].postMessage(res))
  })
  e.ports[0].start()
})

let model
let context
let session

async function ensureModelLoaded () {
  if (!model) {
    console.log('run')
    const llama = await getLlama()
    console.log('loaded')
    model = await llama.loadModel({
      // TODO update
      // modelPath: 'Llama-3.2-1B-Instruct-Q6_K_L.gguf'
      // modelPath: 'Llama-3.2-3B-Instruct-Q4_K_M.gguf'
    })
    context = await model.createContext()
    session = new LlamaChatSession({
      contextSequence: context.getSequence()
    })
  }
}

async function handleRequest (data) {
  console.log(data)

  await ensureModelLoaded()

  if (data.action === 'run') {
    console.log("input: " + decodeURIComponent(data.input))
    const result = await session.prompt(decodeURIComponent(data.input))

    console.log('result: ' + result)

    session.resetChatHistory()

    return {
      result,
      callbackId: data.callbackId
    }
  }
}
