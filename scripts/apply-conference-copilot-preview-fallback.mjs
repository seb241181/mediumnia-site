import fs from 'node:fs'

const file = new URL('../api/agent-chat.js', import.meta.url)
let source = fs.readFileSync(file, 'utf8')

const providerConst = "  const provider = ['anthropic', 'openai'].includes(requestedProvider) ? requestedProvider : runtime.provider"
const modelConst = "  const model = String(agent.model || '').trim() || (provider === runtime.provider ? runtime.model : defaultModel)"
const conferenceMarker = "  const isConferenceCopilot = agent.id === CONFERENCE_COPILOT_AGENT_ID"
const resultMarker = '  let result\n  try {'
const catchMarker = "  } catch (error) {\n    const errorCode = error?.message === 'provider_not_configured'"
const catchEndMarker = "    return res.status(502).json({ error: 'Le copilote est momentanément indisponible.', requestId, messageSaved: true, conversationId })\n  }\n\n  if (result.error) {"
const returnMarker = "    requestId,\n  })"

if (!source.includes(providerConst) || !source.includes(modelConst) || !source.includes(conferenceMarker) || !source.includes(resultMarker) || !source.includes(catchMarker) || !source.includes(catchEndMarker)) {
  console.log('MediumIA conference copilot preview fallback: anchors not found, skipping')
  process.exit(0)
}

source = source.replace(providerConst, "  let provider = ['anthropic', 'openai'].includes(requestedProvider) ? requestedProvider : runtime.provider")
source = source.replace(modelConst, "  let model = String(agent.model || '').trim() || (provider === runtime.provider ? runtime.model : defaultModel)")

const fallbackBlock = `${conferenceMarker}\n\n  // Preview-only safety net: conference rehearsal must not fail just because\n  // an external AI secret is not attached to Vercel Preview. Production keeps\n  // the agent-selected provider unchanged.\n  if (isConferenceCopilot && provider === 'openai' && process.env.VERCEL_ENV === 'preview') {\n    const openAIKey = process.env.OPENAI_API_KEY || process.env.CLE_API_OPENAI\n    const anthropicKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY || process.env.CLE_API_ANTHROPIC\n    if (!openAIKey && anthropicKey) {\n      provider = 'anthropic'\n      model = (process.env.ANTHROPIC_AGENT_MODEL || runtime.model || 'claude-sonnet-5').trim()\n      console.info('[agent-chat] conference_copilot_preview_fallback=anthropic')\n    }\n  }`

source = source.replace(conferenceMarker, fallbackBlock)

const localFallbackHelper = `\nfunction buildRehearsalLocalFallback(message) {\n  const questions = []\n  const pattern = /id=([^|\\n]+)\\s*\\|\\s*prénom=([^|\\n]+)\\s*\\|\\s*question=([^\\n]+)/g\n  let match\n  while ((match = pattern.exec(String(message || ''))) !== null) {\n    questions.push({\n      id: match[1].trim(),\n      firstName: match[2].trim(),\n      question: match[3].trim(),\n    })\n  }\n\n  const classify = (question) => {\n    const text = String(question || '').toLowerCase()\n    if (/(intuition|mental|imagin|envie|première impression|premiere impression)/.test(text)) return 'Intuition, mental et imagination'\n    if (/(développ|developp|apprendre|don|méthode|methode|entraîner|entrainer|exercice)/.test(text)) return 'Développer ses perceptions'\n    if (/(peur|tromp|bloqu|protéger|proteger|couper|obsédé|obsede)/.test(text)) return 'Confiance et gestion des perceptions'\n    if (/(signe|décéd|deced|défunt|defunt|rêve|reve)/.test(text)) return 'Signes, défunts et canaux'\n    if (/(empath|hypersens|ambiance|lieu|animal)/.test(text)) return 'Sensibilité et perception'\n    return 'Perceptions médiumniques'\n  }\n\n  if (!questions.length) {\n    return JSON.stringify({\n      theme: { label: 'Aucune question active', count: 0 },\n      recommendations: [],\n      watch: \"Rien pour l'instant\",\n    })\n  }\n\n  const groups = new Map()\n  for (const question of questions) {\n    const label = classify(question.question)\n    if (!groups.has(label)) groups.set(label, [])\n    groups.get(label).push(question)\n  }\n\n  const ranked = [...groups.entries()].sort((a, b) => b[1].length - a[1].length)\n  const [themeLabel, themeQuestions] = ranked[0]\n  const recommendations = []\n\n  const addQuestion = (question, groupLabel, groupQuestions, reason) => {\n    if (!question || recommendations.some((item) => item.id === question.id)) return\n    recommendations.push({\n      id: question.id,\n      similarCount: groupQuestions.length,\n      reason,\n    })\n  }\n\n  addQuestion(themeQuestions[0], themeLabel, themeQuestions, 'Thème le plus représenté')\n  for (const [label, groupQuestions] of ranked.slice(1)) {\n    if (recommendations.length >= 3) break\n    addQuestion(groupQuestions[0], label, groupQuestions, 'Angle complémentaire utile')\n  }\n  for (const question of questions) {\n    if (recommendations.length >= 3) break\n    const label = classify(question.question)\n    addQuestion(question, label, groups.get(label) || [question], 'Question claire à traiter')\n  }\n\n  const recent = questions.slice(-Math.min(5, questions.length))\n  const recentCounts = new Map()\n  for (const question of recent) {\n    const label = classify(question.question)\n    recentCounts.set(label, (recentCounts.get(label) || 0) + 1)\n  }\n  const recentTop = [...recentCounts.entries()].sort((a, b) => b[1] - a[1])[0]\n  const watch = recentTop\n    ? (recentTop[0] === themeLabel ? \\`Le thème « \\${themeLabel} » continue de monter.\\` : \\`« \\${recentTop[0]} » apparaît dans les questions récentes.\\`)\n    : \"Rien pour l'instant\"\n\n  return JSON.stringify({\n    theme: { label: themeLabel, count: themeQuestions.length },\n    recommendations,\n    watch,\n  })\n}\n`

source = source.replace('export default async function handler(req, res) {', `${localFallbackHelper}\nexport default async function handler(req, res) {`)
source = source.replace(resultMarker, "  let result\n  let rehearsalFallbackUsed = false\n  try {")
source = source.replace(catchMarker, "  } catch (error) {\n    if (auth.rehearsal && error?.message === 'provider_not_configured') {\n      result = { reply: buildRehearsalLocalFallback(cleanMessage) }\n      rehearsalFallbackUsed = true\n      console.info('[agent-chat] conference_rehearsal_local_fallback=active')\n    } else {\n    const errorCode = error?.message === 'provider_not_configured'")
source = source.replace(catchEndMarker, "    return res.status(502).json({ error: 'Le copilote est momentanément indisponible.', requestId, messageSaved: true, conversationId })\n    }\n  }\n\n  if (result.error) {")
source = source.replace(returnMarker, "    requestId,\n    rehearsalFallback: rehearsalFallbackUsed,\n  })")

fs.writeFileSync(file, source)
console.log('MediumIA conference copilot: Preview provider fallback applied')
