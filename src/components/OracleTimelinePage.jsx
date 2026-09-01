import { useState } from 'react'

const THEMES = [
  { value: 'amour', label: 'Amour & relation' },
  { value: 'travail', label: 'Travail & activité' },
  { value: 'finances', label: 'Finances & abondance' },
  { value: 'energie', label: 'Énergie du moment' },
  { value: 'direction de vie', label: 'Direction de vie' },
  { value: 'projet', label: 'Projet & décision' },
  { value: 'autre', label: 'Autre thème' },
]

function DensityBadge({ density }) {
  const label = density === 'HAUTE' ? 'Transformation profonde' : density === 'MOYENNE' ? 'Transition' : 'Flux favorable'
  return (
    <span className="inline-flex rounded-full border border-gold/30 px-3 py-1 text-[10px] uppercase tracking-[0.13em] text-mist">
      {label}
    </span>
  )
}

export default function OracleTimelinePage({ onBack }) {
  const [theme, setTheme] = useState('amour')
  const [customTheme, setCustomTheme] = useState('')
  const [numbers, setNumbers] = useState(['', '', ''])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  function updateNumber(index, raw) {
    const next = [...numbers]
    if (raw === '') {
      next[index] = ''
    } else {
      const parsed = Number.parseInt(raw, 10)
      next[index] = Number.isNaN(parsed) ? '' : String(Math.min(58, Math.max(1, parsed)))
    }
    setNumbers(next)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    setResult(null)

    const ids = numbers.map((value) => Number.parseInt(value, 10))
    if (ids.some(Number.isNaN) || ids.some((n) => n < 1 || n > 58) || new Set(ids).size !== 3) {
      setError('Choisissez trois nombres différents entre 1 et 58.')
      return
    }

    const finalTheme = theme === 'autre' ? customTheme.trim() : theme
    if (!finalTheme) {
      setError('Indiquez le thème de votre tirage.')
      return
    }

    setLoading(true)
    try {
      const response = await fetch('/api/oracle-interpret', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: finalTheme, numbers: ids }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.message || data.error || 'Le moteur est indisponible.')
      }
      setResult(data)
    } catch (err) {
      setError(err?.message || 'Une erreur est survenue.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-cream text-deep">
      <header className="border-b border-gold/20 bg-cream/95 px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <button onClick={onBack} className="font-georgia text-sm text-mist hover:text-deep">← MediumIA</button>
          <span className="hidden font-georgia text-xs uppercase tracking-[0.2em] text-gold md:block">CHRONOSPHERE 999 · Preview privée</span>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-4xl px-6 pb-10 pt-14 text-center md:pt-20">
          <p className="mb-4 font-georgia text-xs uppercase tracking-[0.28em] text-gold">Oracle des Lignes de Temps</p>
          <h1 className="mb-5 font-georgia text-4xl font-medium leading-tight md:text-6xl">CHRONOSPHERE 999</h1>
          <p className="mx-auto max-w-2xl font-bodoni text-xl italic leading-relaxed text-deep/85 md:text-2xl">
            « Où en suis-je dans mon retour ? »
          </p>
          <p className="mx-auto mt-5 max-w-2xl font-georgia text-sm leading-relaxed text-mist md:text-base">
            Ce prototype lit une dynamique présente à partir d’une carte principale et de deux résonances. Il ne fige pas l’avenir : il met en lumière une trajectoire et son point de bifurcation.
          </p>
          <div className="mx-auto mt-6 inline-flex rounded-full border border-gold/30 bg-white/50 px-4 py-2 font-georgia text-xs text-mist">
            Prototype moteur · aucun paiement sur cette Preview
          </div>
        </section>

        <section className="mx-auto max-w-3xl px-6 pb-20">
          <form onSubmit={handleSubmit} className="rounded-3xl border-2 border-gold/25 bg-white/60 p-6 shadow-sm md:p-9">
            <div className="mb-7">
              <label className="mb-2 block font-georgia text-xs uppercase tracking-[0.16em] text-mist">Thème de votre ligne de temps</label>
              <select
                value={theme}
                onChange={(e) => setTheme(e.target.value)}
                className="w-full rounded-xl border-2 border-gold/20 bg-white px-4 py-3 font-georgia text-sm text-deep outline-none focus:border-gold/60"
              >
                {THEMES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
              {theme === 'autre' && (
                <input
                  value={customTheme}
                  onChange={(e) => setCustomTheme(e.target.value)}
                  placeholder="Ex. déménagement, relation familiale, choix personnel…"
                  maxLength={120}
                  className="mt-3 w-full rounded-xl border-2 border-gold/20 bg-white px-4 py-3 font-georgia text-sm text-deep outline-none focus:border-gold/60"
                />
              )}
            </div>

            <div className="mb-3">
              <p className="font-georgia text-sm font-medium text-deep">Choisissez trois nombres entre 1 et 58</p>
              <p className="mt-1 font-georgia text-xs leading-relaxed text-mist">Le premier est la fréquence principale. Les deux suivants viennent la préciser et la mettre en mouvement.</p>
            </div>

            <div className="mb-7 grid grid-cols-3 gap-3 md:gap-5">
              {['Principale', 'Résonance I', 'Résonance II'].map((label, index) => (
                <label key={label} className="block">
                  <span className="mb-2 block text-center font-georgia text-[10px] uppercase tracking-[0.12em] text-mist">{label}</span>
                  <input
                    type="number"
                    min="1"
                    max="58"
                    value={numbers[index]}
                    onChange={(e) => updateNumber(index, e.target.value)}
                    placeholder="1–58"
                    required
                    className="w-full rounded-xl border-2 border-gold/25 bg-white px-3 py-4 text-center font-georgia text-xl text-deep outline-none focus:border-gold/70"
                  />
                </label>
              ))}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-gold px-6 py-4 font-georgia text-base font-bold text-deep transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {loading ? 'Lecture de la ligne de temps…' : 'Ouvrir ma ligne de temps →'}
            </button>

            {error && <p className="mt-4 text-center font-georgia text-sm text-red-600">{error}</p>}
          </form>

          {result && (
            <div className="mt-10 space-y-7">
              <div className="grid gap-4 md:grid-cols-3">
                {result.cards.map((card, index) => (
                  <article key={card.number} className={`rounded-2xl border-2 p-5 ${index === 0 ? 'border-gold/60 bg-gold/10' : 'border-gold/20 bg-white/60'}`}>
                    <p className="mb-2 font-georgia text-[10px] uppercase tracking-[0.16em] text-gold">{index === 0 ? 'Fréquence principale' : `Résonance ${index}`}</p>
                    <p className="mb-1 font-georgia text-xs text-mist">N° {String(card.number).padStart(2, '0')}</p>
                    <h2 className="mb-3 font-georgia text-xl font-medium leading-tight text-deep">{card.name}</h2>
                    {card.astre && <p className="mb-3 font-georgia text-xs italic text-mist">Balise : {card.astre}</p>}
                    <DensityBadge density={card.density} />
                  </article>
                ))}
              </div>

              <article className="rounded-3xl border-2 border-gold/25 bg-white/75 p-7 md:p-10">
                <p className="mb-5 font-georgia text-xs uppercase tracking-[0.2em] text-gold">Lecture CHRONOSPHERE 999</p>
                <div className="whitespace-pre-line font-georgia text-[15px] leading-8 text-deep/90 md:text-base">
                  {result.interpretation}
                </div>
              </article>

              <article className="rounded-2xl border border-gold/25 bg-deep p-6 text-cream">
                <p className="mb-2 font-georgia text-xs uppercase tracking-[0.16em] text-gold">Acte de réalignement</p>
                <p className="font-georgia text-sm leading-relaxed text-cream/80"><strong className="text-cream">Geste :</strong> {result.cards[0].gesture}</p>
                <p className="mt-3 font-bodoni text-lg italic leading-relaxed text-gold">{result.cards[0].decree}</p>
              </article>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
