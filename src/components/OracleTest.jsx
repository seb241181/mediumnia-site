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
        body: JSON.stringify({ cardIds: ids }),
      })
      if (!apiRes.ok) {
        const errData = await apiRes.json().catch(() => ({}))
        throw new Error(errData.detail || errData.error || 'Erreur API')
      }
      const { interpretation } = await apiRes.json()
      try {
        await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID,
          { to_email: trimmedEmail, card1_name: drawnCards[0].name, card2_name: drawnCards[1].name, card3_name: drawnCards[2].name, interpretation },
          EMAILJS_PUBLIC_KEY)
      } catch (emailErr) { console.error('EmailJS error:', emailErr) }
      localStorage.setItem(storageKey(trimmedEmail), new Date().toISOString())
      setResult({ cards: drawnCards, interpretation })
      setMessage("Tirage effectué — votre interprétation est ci-dessous.")
    } catch (err) {
      console.error(err)
      setIsError(true)
      setMessage("Une erreur est survenue. Veuillez réessayer plus tard.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="border-2 border-gold/30 rounded-2xl p-8 bg-white/70">
      <p className="font-georgia text-lg font-medium text-deep mb-1">Tirage test offert ✦</p>
      <p className="font-georgia text-sm text-mist italic mb-6 leading-relaxed">
        Choisissez trois numéros entre 0 et 44. Lumïa vous offrira une interprétation unique et personnelle — envoyée aussi à votre email. Un seul tirage par adresse.
      </p>
      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label htmlFor="oracle-email" className="font-georgia text-xs text-mist tracking-[0.15em] uppercase block mb-1.5">Votre email</label>
          <input id="oracle-email" type="email" value={email} onChange={e => setEmail(e.target.value)} required
            placeholder="votre@email.com"
            className="w-full font-georgia text-sm text-deep bg-white/80 border-2 border-gold/25 rounded-lg px-4 py-3 focus:outline-none focus:border-gold/60 transition-colors" />
        </div>
        <div className="grid grid-cols-3 gap-4">
          {[0, 1, 2].map(idx => (
            <div key={idx}>
              <label htmlFor={`oracle-num-${idx}`} className="font-georgia text-xs text-mist tracking-[0.15em] uppercase block mb-1.5">
                {['Ombre', 'Passage', 'Guérison'][idx]}
              </label>
              <input id={`oracle-num-${idx}`} type="number" min="0" max="44" value={numbers[idx]}
                onChange={e => handleNumberChange(idx, e.target.value)} required placeholder="0–44"
                className="w-full font-georgia text-sm text-deep bg-white/80 border-2 border-gold/25 rounded-lg px-4 py-3 focus:outline-none focus:border-gold/60 transition-colors text-center" />
            </div>
          ))}
        </div>
        <button type="submit" disabled={loading}
          className="w-full font-georgia text-base px-6 py-4 rounded-lg transition-all hover:opacity-90 disabled:opacity-50 font-bold"
          style={{ backgroundColor: '#C9A84C', color: '#1A1535' }}>
          {loading ? 'Lumïa consulte les cartes…' : 'Recevoir mon tirage →'}
        </button>
        {message && (
          <p className={`font-georgia text-sm text-center ${isError ? 'text-red-500' : 'text-deep'}`}>{message}</p>
        )}
      </form>
      {result && (
        <div className="mt-10 border-t border-gold/20 pt-8">
          <div className="grid grid-cols-3 gap-4 mb-8">
            {result.cards.map((card, idx) => (
              <div key={idx} className="text-center">
                <img src={`/images/oracle/${card.id}.png`} alt={card.name}
                  className="w-full rounded-xl border-2 border-gold/30 shadow-sm mb-2"
                  onError={e => { e.target.src = '/images/oracle/verso.png' }} />
                <p className="font-georgia text-xs text-mist">{card.name}</p>
              </div>
            ))}
          </div>
          <p className="font-georgia text-base md:text-lg text-deep italic leading-relaxed whitespace-pre-line">{result.interpretation}</p>
        </div>
      )}
    </div>
  )
}
