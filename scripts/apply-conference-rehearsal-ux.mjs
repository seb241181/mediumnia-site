import fs from 'node:fs'

const file = new URL('../src/components/ConferenceRehearsalTokenPage.jsx', import.meta.url)
let source = fs.readFileSync(file, 'utf8')

const oldLine = "  const lines = active.map((q, i) => `${i + 1}. heure=${clock(q.created_at)} | id=${q.id} | prénom=${q.firstName} | question=${q.question}`)"
const newLine = "  const lines = active.map((q) => `${q.id}\\t${String(q.question || '').replace(/\\s+/g, ' ').trim().slice(0, 90)}`)"
if (source.includes(oldLine)) source = source.replace(oldLine, newLine)

source = source.replace("${lines.join('\\n').slice(0, 3150)}`,", "${lines.join('\\n').slice(0, 3950)}`,")
source = source.replace("${lines.join('\\n').slice(0, 3150)}`", "${lines.join('\\n').slice(0, 3950)}`")

const winnerState = "  const [winner, setWinner] = useState('')"
if (source.includes(winnerState) && !source.includes("const [lastAnalyzedAt")) {
  source = source.replace(winnerState, `${winnerState}\n  const [lastAnalyzedAt, setLastAnalyzedAt] = useState('')\n  const [analysisMode, setAnalysisMode] = useState('')`)
}

const successLine = "      setPlan(parsePlan(payload.reply, active)); setAiState('success')"
if (source.includes(successLine)) {
  source = source.replace(successLine, "      setPlan(parsePlan(payload.reply, active)); setLastAnalyzedAt(new Date().toISOString()); setAnalysisMode(payload.rehearsalFallback ? 'local' : 'ai'); setAiState('success')")
}

const resetLine = "  const reset = () => { setRunning(false); setQuestions([]); setCursor(0); setPlan(null); setAiState('idle'); setWinner(''); setError('') }"
if (source.includes(resetLine)) {
  source = source.replace(resetLine, "  const reset = () => { setRunning(false); setQuestions([]); setCursor(0); setPlan(null); setAiState('idle'); setWinner(''); setLastAnalyzedAt(''); setAnalysisMode(''); setError('') }")
}

source = source.replace("L’IA est réelle. Les participants et le tirage sont fictifs.", "Copilote test : IA si disponible, secours local sinon. Les participants et le tirage sont fictifs.")

const buttonPlanJoin = "</button>{plan&&<div className=\"mt-5 space-y-4\">"
if (source.includes(buttonPlanJoin) && !source.includes('Actualisé à {clock(lastAnalyzedAt)}')) {
  source = source.replace(buttonPlanJoin, "</button>{lastAnalyzedAt&&<p className=\"mt-3 font-georgia text-[11px] text-cream/40\">Actualisé à {clock(lastAnalyzedAt)} · {analysisMode==='local'?'mode secours de répétition':'IA connectée'}</p>}{plan&&<div className=\"mt-5 space-y-4\">")
}

fs.writeFileSync(file, source)
console.log('MediumIA conference rehearsal: compact room payload and visible reanalysis state applied')
