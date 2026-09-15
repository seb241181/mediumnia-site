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

// Rehearsal raffle: keep an explicit participant number so duplicate first names are never ambiguous.
const oldFakeDraw = "onClick={()=>setWinner(SCRIPT[Math.max(0,Math.floor(Math.random()*Math.max(1,Math.min(cursor,SCRIPT.length))))].firstName)}"
const newFakeDraw = "onClick={()=>{const winnerIndex=Math.max(0,Math.floor(Math.random()*Math.max(1,Math.min(cursor,SCRIPT.length))));const person=SCRIPT[winnerIndex];setWinner(person.firstName + ' · participant #' + String(winnerIndex + 1).padStart(3, '0'))}}"
if (source.includes(oldFakeDraw)) source = source.replace(oldFakeDraw, newFakeDraw)

function ivoryTheme(text) {
  return text
    .replaceAll('bg-[#0f0d21]/95', 'bg-[#f7f1e3]/95')
    .replaceAll('bg-[#0f0d21]', 'bg-[#f7f1e3]')
    .replaceAll('bg-[#1b1738]', 'bg-[#fffaf0]')
    .replaceAll('text-cream', 'text-deep')
    .replaceAll('bg-white/5', 'bg-white/75')
    .replaceAll('bg-white/10', 'bg-white/85')
    .replaceAll('bg-black/10', 'bg-white/70')
    .replaceAll('bg-black/15', 'bg-white/75')
    .replaceAll('border-white/10', 'border-gold/20')
    .replaceAll('border-white/15', 'border-gold/25')
    .replaceAll('border-purple-300/20', 'border-gold/25')
    .replaceAll('border-purple-300/25', 'border-gold/30')
    .replaceAll('border-purple-200/30', 'border-gold/30')
    .replaceAll('border-purple-200/40', 'border-gold/40')
    .replaceAll('bg-purple-300/5', 'bg-[#fffaf0]')
    .replaceAll('bg-purple-200', 'bg-gold')
    .replaceAll('text-purple-200', 'text-[#8a6b20]')
    .replaceAll('text-purple-100', 'text-[#8a6b20]')
    .replaceAll('border-cyan-200/20', 'border-gold/25')
    .replaceAll('bg-cyan-200/5', 'bg-[#fffaf0]')
    .replaceAll('text-cyan-100', 'text-[#8a6b20]')
    .replaceAll('text-emerald-200', 'text-emerald-800')
    .replaceAll('text-emerald-100', 'text-emerald-800')
    .replaceAll('text-red-100', 'text-red-800')
    .replaceAll('text-red-200', 'text-red-700')
}

source = ivoryTheme(source)
fs.writeFileSync(file, source)

// Real admin cockpit: expose a privacy-safe short winner code derived from the unique registration UUID.
const cockpitFile = new URL('../src/components/ConferenceCockpitPage.jsx', import.meta.url)
let cockpit = fs.readFileSync(cockpitFile, 'utf8')
const raffleLine = '  const raffle = data?.raffle'
if (cockpit.includes(raffleLine) && !cockpit.includes('const winnerCode =')) {
  cockpit = cockpit.replace(raffleLine, `${raffleLine}\n  const winnerCode = raffle?.winner_registration_id ? String(raffle.winner_registration_id).replaceAll('-', '').slice(0, 6).toUpperCase() : ''`)
}
const winnerDisplay = '<p className="mt-2 font-georgia text-3xl font-semibold">{winner}</p>'
if (cockpit.includes(winnerDisplay) && !cockpit.includes('PARTICIPANT #{winnerCode}')) {
  cockpit = cockpit.replace(winnerDisplay, `${winnerDisplay}{winnerCode && <p className="mt-2 font-georgia text-xs font-semibold tracking-[.16em] text-gold">PARTICIPANT #{winnerCode}</p>}`)
}
cockpit = ivoryTheme(cockpit)
fs.writeFileSync(cockpitFile, cockpit)

console.log('MediumIA conference rehearsal/cockpit: ivory theme and unique winner identity applied')
