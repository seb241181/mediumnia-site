import fs from 'node:fs'

function addMergeHelper(source, exportMarker) {
  if (source.includes('function mergeCopilotShortlist(')) return source
  const helper = `
function mergeCopilotShortlist(previousPlan, nextPlan, questions = [], answeredId = '') {
  const activeIds = new Set(
    questions
      .filter((q) => !['answered', 'dismissed'].includes(q.status))
      .map((q) => q.id),
  )
  const freshById = new Map((nextPlan?.recommendations || []).map((item) => [item.id, item]))
  const kept = (previousPlan?.recommendations || [])
    .filter((item) => item?.id && item.id !== answeredId && activeIds.has(item.id))
    .slice(0, 2)
    .map((item) => freshById.get(item.id) || item)
  const seen = new Set(kept.map((item) => item.id))
  const refill = (nextPlan?.recommendations || [])
    .filter((item) => item?.id && activeIds.has(item.id) && !seen.has(item.id) && seen.add(item.id))
  return {
    ...nextPlan,
    recommendations: [...kept, ...refill].slice(0, 3),
  }
}
`
  return source.replace(exportMarker, `${helper}\n${exportMarker}`)
}

const rehearsalFile = new URL('../src/components/ConferenceRehearsalTokenPage.jsx', import.meta.url)
let rehearsal = fs.readFileSync(rehearsalFile, 'utf8')
rehearsal = addMergeHelper(rehearsal, 'export default function ConferenceRehearsalTokenPage() {')
rehearsal = rehearsal.replace(
  '  const analyze = async (source = questions) => {',
  "  const analyze = async (source = questions, preserveShortlist = false, answeredId = '') => {",
)
const rehearsalActive = "    const active = source.filter((q) => !['answered', 'dismissed'].includes(q.status))"
if (rehearsal.includes(rehearsalActive) && !rehearsal.includes('const previousPlan = preserveShortlist ? plan : null')) {
  rehearsal = rehearsal.replace(rehearsalActive, `${rehearsalActive}\n    const previousPlan = preserveShortlist ? plan : null`)
}
rehearsal = rehearsal.replace(
  'setPlan(parsePlan(payload.reply, active));',
  'const nextPlan = parsePlan(payload.reply, active); setPlan(preserveShortlist ? mergeCopilotShortlist(previousPlan, nextPlan, active, answeredId) : nextPlan);',
)
rehearsal = rehearsal.replace(
  "if (status === 'answered' && plan) await analyze(fresh)",
  "if (status === 'answered' && plan) await analyze(fresh, true, id)",
)
fs.writeFileSync(rehearsalFile, rehearsal)

const cockpitFile = new URL('../src/components/ConferenceCockpitPage.jsx', import.meta.url)
let cockpit = fs.readFileSync(cockpitFile, 'utf8')
cockpit = addMergeHelper(cockpit, 'export default function ConferenceCockpitPage() {')
cockpit = cockpit.replace(
  '  const runCopilot = async (questionsOverride = null) => {',
  "  const runCopilot = async (questionsOverride = null, preserveShortlist = false, answeredId = '') => {",
)
const loadingMarker = "    setAiState('loading')"
if (cockpit.includes(loadingMarker) && !cockpit.includes('const previousPlan = preserveShortlist ? aiPlan : null')) {
  cockpit = cockpit.replace(loadingMarker, `    const previousPlan = preserveShortlist ? aiPlan : null\n\n${loadingMarker}`)
}
cockpit = cockpit.replace(
  '        setAiPlan(parseCopilotPlan(reply, activeQuestions))',
  '        const nextPlan = parseCopilotPlan(reply, activeQuestions)\n        setAiPlan(preserveShortlist ? mergeCopilotShortlist(previousPlan, nextPlan, activeQuestions, answeredId) : nextPlan)',
)
cockpit = cockpit.replace(
  '        await runCopilot(fresh.questions)',
  '        await runCopilot(fresh.questions, true, questionId)',
)
fs.writeFileSync(cockpitFile, cockpit)

console.log('MediumIA conference cockpit: keep two shortlist questions and refill one after each answer')
