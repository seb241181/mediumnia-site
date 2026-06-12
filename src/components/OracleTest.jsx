import { useState } from 'react'
import emailjs from '@emailjs/browser'
import oracleCards from '../data/oracleCards.json'

const EMAILJS_SERVICE_ID  = 'service_dvs3erx'
const EMAILJS_TEMPLATE_ID = 'template_u8geta8'
const EMAILJS_PUBLIC_KEY  = 'Eqe7ZBJqfb5joJvY-gp70'

function storageKey(email) {
  return `oracle_test_${email.toLowerCase().trim()}`
}

export default function OracleTest() {
  const [email, setEmail]     = useState('')
  const [numbers, setNumbers] = useState(['', '', ''])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [isError, setIsError] = useState(false)
  const [result, setResult]   = useState(null)

  function handleNumberChange(index, raw) {
    const copy = [...numbers]
    const n = parseInt(raw, 10)
    if (raw === '' || isNaN(n)) { copy[index] = ''; setNumbers(copy); return }
    copy[index] = String(Math.max(0, Math.min(44, n)))
    setNumbers(copy)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setMessage('')
    setIsError(false)
    setResult(null)

    const trimmedEmail = email.toLowerCase().trim()

    if (localStorage.getItem(storageKey(trimmedEmail))) {
      setIsError(true)
      setMessage('Cet email a déjà utilisé le tirage test. Un seul tirage par email est offert.')
      return
    }

    const ids = numbers.map(n => parseInt(n, 10))
    if (ids.some(isNaN) || ids.some(n => n < 0 || n > 44)) {
      setIsError(true)
      setMessage('Veuillez choisir trois nombres entre 0 et 44.')
      return
    }

    const drawnCards = ids.map(id => oracleCards.find(c => c.id === id))

    setLoading(true)
    try {
      const apiRes = await fetch('/api/oracle-interpret', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cards: drawnCards }),
      })
      if (!apiRes.ok) {
        const errData = await apiRes.json().catch(() => ({}))
        throw new Error(errData.detail || errData.error || 'Erreur API')
      }
      const { interpretation } = await apiRes.json()

      try {
        await emailjs.send(
          EMAILJS_SERVICE_ID,
          EMAILJS_TEMPLATE_ID,
          {
            to_email:      trimmedEmail,
            card1_name:    drawnCards[0].name,
            card2_name:    drawnCards[1].name,
            card3_name:    drawnCards[2].name,
            interpretation,
          },
          EMAILJS_PUBLIC_KEY
        )
      } catch (emailErr) {
        console.error('EmailJS error:', emailErr)
      }

      localStorage.setItem(storageKey(trimmedEmail), new Date().toISOString())
      setResult({ cards: drawnCards, interpretation })
      setMessage('Tirage effectué ! Voici votre interprétation.')
    } catch (err) {
      console.error(err)
      setIsError(true)
      setMessage('Une erreur est survenue. Veuillez réessayer plus tard.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section id="oracle" className="px-6 py-20 md:py-28 max-w-3xl mx-auto w-full">
      <p className="text-gold/40 text-sm tracking-widest text-center my-10">◆ ─────── ◆</p>

      <div className="flex flex-col md:flex-row gap-8 items-start mb-10">
        <div className="flex-1">
          <h2 className="font-georgia text-2xl md:text-3xl text-deep font-medium leading-tight mb-4">
            Oracle Au-delà de l'Âme ✦
          </h2>
          <p className="font-georgia text-mist text-base md:text-lg italic mb-6">
            Choisissez trois numéros entre 0 et 44. Lumïa vous offrira une interprétation unique et personnelle. Un seul tirage offert par adresse.
          </p>
          <a
            href="https://www.paypal.com/ncp/payment/7B25CPZQBT9SJ"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block font-georgia text-sm tracking-wide px-6 py-3 rounded-lg transition-all hover:opacity-90"
            style={{ backgroundColor: '#C9A84C', color: '#1A1535', fontWeight: 600 }}
          >
            Commander l'Oracle →
          </a>
        </div>
        <div className="flex-shrink-0 flex justify-center md:justify-end">
          <img
            src="/images/oracle/cover.jpg"
            alt="Oracle Au-delà de l'Âme — Sébastien Seguin"
            className="w-40 md:w-48 rounded-xl border border-gold/30 shadow-md"
            onError={e => { e.target.style.display = 'none' }}
          />
        </div>
      </div>

      <div className="border border-gold/20 rounded-2xl p-8 bg-white/60">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="oracle-email" className="font-georgia text-xs text-mist tracking-wide uppercase block mb-1.5">
              Votre email
            </label>
            <input
              id="oracle-email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              placeholder="votre@email.com"
              className="w-full font-georgia text-sm text-deep bg-white/70 border border-gold/30 rounded-lg px-4 py-3 focus:outline-none focus:border-gold/70 transition-colors"
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            {[0, 1, 2].map(idx => (
              <div key={idx}>
                <label htmlFor={`oracle-num-${idx}`} className="font-georgia text-xs text-mist tracking-wide uppercase block mb-1.5">
                  Carte {idx + 1}
                </label>
                <input
                  id={`oracle-num-${idx}`}
                  type="number"
                  min="0"
                  max="44"
                  value={numbers[idx]}
                  onChange={e => handleNumberChange(idx, e.target.value)}
                  required
                  placeholder="0–44"
                  className="w-full font-georgia text-sm text-deep bg-white/70 border border-gold/30 rounded-lg px-4 py-3 focus:outline-none focus:border-gold/70 transition-colors"
                />
              </div>
            ))}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full font-georgia text-base tracking-wide px-6 py-4 rounded-lg transition-all hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: '#C9A84C', color: '#1A1535', fontWeight: 600 }}
          >
            {loading ? 'Lumïa consulte les cartes…' : 'Recevoir mon tirage'}
          </button>

          {message && (
            <p className={`font-georgia text-sm text-center ${isError ? 'text-red-500' : 'text-deep'}`}>
              {message}
            </p>
          )}
        </form>

        {result && (
          <div className="mt-10 border-t border-gold/20 pt-8">
            <div className="grid grid-cols-3 gap-4 mb-8">
              {result.cards.map((card, idx) => (
                <div key={idx} className="text-center">
                  <img
                    src={`/images/oracle/${card.id}.png`}
                    alt={card.name}
                    className="w-full rounded-xl border border-gold/30 shadow-sm mb-2"
                    onError={e => { e.target.src = '/images/oracle/verso.png' }}
                  />
                  <p className="font-georgia text-xs text-mist">{card.name}</p>
                </div>
              ))}
            </div>
            <p className="font-georgia text-base md:text-lg text-deep italic leading-relaxed whitespace-pre-line">
              {result.interpretation}
            </p>
          </div>
        )}
      </div>
    </section>
  )
}
