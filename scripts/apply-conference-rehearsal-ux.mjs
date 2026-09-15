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
  source = source.replace(winnerState, `${winnerState}\n  const [lastAnalyzedAt, setLastAnalyzedAt] = useState('')\n  const [analysisMode, setAnalysisMode] = useState('')\n  const [lastAnalyzedCount, setLastAnalyzedCount] = useState(0)`)
}

const successLine = "      setPlan(parsePlan(payload.reply, active)); setAiState('success')"
if (source.includes(successLine)) {
  source = source.replace(successLine, "      setPlan(parsePlan(payload.reply, active)); setLastAnalyzedAt(new Date().toISOString()); setAnalysisMode(payload.rehearsalFallback ? 'local' : 'ai'); setLastAnalyzedCount(active.length); setAiState('success')")
}

const resetLine = "  const reset = () => { setRunning(false); setQuestions([]); setCursor(0); setPlan(null); setAiState('idle'); setWinner(''); setError('') }"
if (source.includes(resetLine)) {
  source = source.replace(resetLine, "  const reset = () => { setRunning(false); setQuestions([]); setCursor(0); setPlan(null); setAiState('idle'); setWinner(''); setLastAnalyzedAt(''); setAnalysisMode(''); setLastAnalyzedCount(0); setError('') }")
}

const injectBlock = "  const inject = () => {\n    if (cursor >= SCRIPT.length) return\n    const next = SCRIPT[cursor]\n    setQuestions((q) => [...q, { ...next, status: 'pending', created_at: new Date().toISOString() }])\n    setCursor((c) => c + 1)\n  }"
if (source.includes(injectBlock) && !source.includes('const toggleRoom = () =>')) {
  const toggleBlock = `${injectBlock}\n\n  const toggleRoom = () => {\n    if (cursor >= SCRIPT.length) {\n      setQuestions([])\n      setCursor(0)\n      setPlan(null)\n      setAiState('idle')\n      setWinner('')\n      setLastAnalyzedAt('')\n      setAnalysisMode('')\n      setLastAnalyzedCount(0)\n      setError('')\n      setRunning(true)\n      return\n    }\n    setRunning((value) => !value)\n  }`
  source = source.replace(injectBlock, toggleBlock)
}

source = source.replace("L’IA est réelle. Les participants et le tirage sont fictifs.", "Copilote test : IA si disponible, secours local sinon. Les participants et le tirage sont fictifs.")

source = source.replace("<button onClick={() => setRunning((v) => !v)} className=\"rounded-xl bg-purple-200 px-4 py-3 font-georgia text-xs font-bold text-[#0f0d21]\">{running ? '⏸ Pause' : '▶ Lancer la salle'}</button>", "<button onClick={toggleRoom} className=\"rounded-xl bg-purple-200 px-4 py-3 font-georgia text-xs font-bold text-[#0f0d21]\">{cursor>=SCRIPT.length?'↻ Relancer la salle':running?'⏸ Pause':'▶ Lancer la salle'}</button>")

const buttonPlanJoin = "</button>{plan&&<div className=\"mt-5 space-y-4\">"
if (source.includes(buttonPlanJoin) && !source.includes('Actualisé à {clock(lastAnalyzedAt)}')) {
  source = source.replace(buttonPlanJoin, "</button>{lastAnalyzedAt&&<p className=\"mt-3 font-georgia text-[11px] text-cream/40\">Actualisé à {clock(lastAnalyzedAt)} · {analysisMode==='local'?'mode secours de répétition':'IA connectée'} · {Math.max(0,questions.filter((q)=>!['answered','dismissed'].includes(q.status)).length-lastAnalyzedCount)} nouvelle(s) question(s) depuis</p>}{plan&&<div className=\"mt-5 space-y-4\">")
}

fs.writeFileSync(file, source)
console.log('MediumIA conference rehearsal: compact room payload, dynamic reanalysis and restart applied')
