import fs from 'node:fs'

const file = new URL('../api/agent-chat.js', import.meta.url)
let source = fs.readFileSync(file, 'utf8')

const providerConst = "  const provider = ['anthropic', 'openai'].includes(requestedProvider) ? requestedProvider : runtime.provider"
const modelConst = "  const model = String(agent.model || '').trim() || (provider === runtime.provider ? runtime.model : defaultModel)"
const conferenceMarker = "  const isConferenceCopilot = agent.id === CONFERENCE_COPILOT_AGENT_ID"

if (!source.includes(providerConst) || !source.includes(modelConst) || !source.includes(conferenceMarker)) {
  console.log('MediumIA conference copilot preview fallback: anchors not found, skipping')
  process.exit(0)
}

source = source.replace(providerConst, "  let provider = ['anthropic', 'openai'].includes(requestedProvider) ? requestedProvider : runtime.provider")
source = source.replace(modelConst, "  let model = String(agent.model || '').trim() || (provider === runtime.provider ? runtime.model : defaultModel)")

const fallbackBlock = `${conferenceMarker}\n\n  // Preview-only safety net: conference rehearsal must not fail just because\n  // the OpenAI secret is not attached to Vercel Preview. Production keeps the\n  // agent-selected provider unchanged.\n  if (isConferenceCopilot && provider === 'openai' && process.env.VERCEL_ENV === 'preview') {\n    const openAIKey = process.env.OPENAI_API_KEY || process.env.CLE_API_OPENAI\n    const anthropicKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || process.env.CLE_API_ANTHROPIC\n    if (!openAIKey && anthropicKey) {\n      provider = 'anthropic'\n      model = (process.env.ANTHROPIC_AGENT_MODEL || runtime.model || 'claude-sonnet-5').trim()\n      console.info('[agent-chat] conference_copilot_preview_fallback=anthropic')\n    }\n  }`

source = source.replace(conferenceMarker, fallbackBlock)
fs.writeFileSync(file, source)
console.log('MediumIA conference copilot: Preview provider fallback applied')
