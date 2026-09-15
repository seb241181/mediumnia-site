import fs from 'node:fs'

function patchRehearsal() {
  const file = new URL('../src/components/ConferenceRehearsalTokenPage.jsx', import.meta.url)
  let source = fs.readFileSync(file, 'utf8')

  const oldTake = "  const take = (id) => setQuestions((all) => all.map((q) => q.id === id ? { ...q, status: 'selected' } : q.status === 'selected' ? { ...q, status: 'pending' } : q))"
  const newTake = `  const take = (id) => {\n    setQuestions((all) => all.map((q) => q.id === id ? { ...q, status: 'selected' } : q.status === 'selected' ? { ...q, status: 'pending' } : q))\n    window.setTimeout(() => document.getElementById('rehearsal-active-question')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0)\n  }`
  if (source.includes(oldTake)) source = source.replace(oldTake, newTake)

  source = source.replace(
    '{selected && <div className="mt-5 rounded-3xl',
    '{selected && <div id="rehearsal-active-question" className="mt-5 rounded-3xl',
  )

  const oldButton = '<button onClick={()=>take(r.id)} className="mt-3 rounded-lg bg-gold px-3 py-2 font-georgia text-xs font-bold text-deep">🔥 Prendre celle-ci</button>'
  const newButton = '<button onClick={()=>take(r.id)} className={`mt-3 rounded-lg bg-gold px-3 py-2 font-georgia text-xs font-bold text-deep ${selected?.id===r.id?\'ring-2 ring-gold/50\':\'\'}`}>{selected?.id===r.id?\'✓ Question active\':\'🔥 Prendre celle-ci\'}</button>'
  if (source.includes(oldButton)) source = source.replace(oldButton, newButton)

  fs.writeFileSync(file, source)
}

function patchCockpit() {
  const file = new URL('../src/components/ConferenceCockpitPage.jsx', import.meta.url)
  let source = fs.readFileSync(file, 'utf8')

  const oldRefresh = "      await call('POST', { action: 'question_status', questionId, status: 'selected' })\n      await refresh()"
  const newRefresh = "      await call('POST', { action: 'question_status', questionId, status: 'selected' })\n      await refresh()\n      window.setTimeout(() => document.getElementById('conference-active-question')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0)"
  if (source.includes(oldRefresh)) source = source.replace(oldRefresh, newRefresh)

  source = source.replace(
    '<div className="mt-5 rounded-3xl border-2 border-gold/70 bg-gold/10 p-6 shadow-[0_0_40px_rgba(201,168,76,.08)]">',
    '<div id="conference-active-question" className="mt-5 rounded-3xl border-2 border-gold/70 bg-gold/10 p-6 shadow-[0_0_40px_rgba(201,168,76,.08)]">',
  )

  fs.writeFileSync(file, source)
}

patchRehearsal()
patchCockpit()
console.log('MediumIA conference cockpit: visible question selection feedback applied')
