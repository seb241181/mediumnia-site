import { useState } from 'react'
import oracleCards from '../data/oracleCards.json'
import {
  DEFAULT_ORACLE_SPREAD_ID,
  getOracleSpread,
  ORACLE_SPREADS,
} from '../data/oracleSpreads.js'

export default function OracleTest() {
  const [email, setEmail]       = useState('')
  const [numbers, setNumbers]   = useState(['', '', ''])
  const [spreadId, setSpreadId] = useState(DEFAULT_ORACLE_SPREAD_ID)
  const [loading, setLoading]   = useState(false)
  const [message, setMessage]   = useState('')
  const [isError, setIsError]   = useState(false)
  const [result, setResult]     = useState(null)

  const spread = getOracleSpread(spreadId)

  function handleNumberChange(index, raw) {
    const copy = [...numbers]
    const n = parseInt(raw, 10)
    if (raw === '' || isNaN(n)) { copy[index] = ''; setNumbers(copy); return }
    copy[index] = String(Math.max(0, Math.min(44, n)))
    setNumbers(copy)
  }

  function handleSpreadChange(nextSpreadId) {
    setSpreadId(nextSpreadId)
    setMessage('')
    setIsError(false)
    setResult(null)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setMessage('')
    setIsError(false)
    setResult(null)
    const trimmedEmail = email.toLowerCase().trim()
    const ids = numbers.map(n => parseInt(n, 10))
    if (ids.some(isNaN) || ids.some(n => n < 0 || n > 44)) {
      setIsError(true)
      setMessage('Veuillez choisir trois nombres entre 0 et 44.')
      return
    }
    if (new Set(ids).size !== ids.length) {
      setIsError(true)
      setMessage('Choisissez trois cartes différentes.')
      return
    }
    const drawnCards = ids.map(id => oracleCards.find(c => c.id === id))
    setLoading(true)
    try {
      const apiRes = await fetch('/api/oracle-interpret', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmedEmail, cardIds: ids, spreadId }),
      })
      if (apiRes.status === 409) {
        setIsError(true)
        setMessage('Un tirage gratuit a déjà été réalisé avec cette adresse e-mail.')
        return
      }
      if (apiRes.status === 429) {
        const body = await apiRes.json().catch(() => ({}))
        setIsError(true)
        setMessage(body.message || 'Trop de tentatives. Merci de réessayer plus tard.')
        return
      }
      if (!apiRes.ok) {
        const errData = await apiRes.json().catch(() => ({}))
        throw new Error(errData.detail || errData.error || 'Erreur API')
      }
      const { interpretation, emailStatus, spread: responseSpread } = await apiRes.json()
      setResult({
        cards: drawnCards,
        interpretation,
        spread: responseSpread || {
          id: spread.id,
          name: spread.name,
          positions: spread.positions.map(({ label }) => ({ label })),
        },
      })
      if (emailStatus === 'sent') {
        setMessage("Tirage effectué — votre interprétation est ci-dessous et a été envoyée par e-mail.")
      } else {
        setIsError(true)
        setMessage("Tirage effectué, mais l'e-mail n'a pas pu être envoyé. Votre interprétation reste disponible ci-dessous.")
      }
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
        Choisissez votre structure, puis trois numéros entre 0 et 44. Lumïa interprète les vraies cartes de l'Oracle Au-delà de l'Âme selon la place qu'elles occupent dans votre tirage. Un seul tirage offert par adresse e-mail.
      </p>

      <div className="mb-6">
        <p className="font-georgia text-xs text-mist tracking-[0.15em] uppercase block mb-3">Votre tirage</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {ORACLE_SPREADS.map((option) => {
            const active = option.id === spreadId
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => handleSpreadChange(option.id)}
                aria-pressed={active}
                className={`text-left rounded-xl border-2 px-4 py-3 transition-all ${active
                  ? 'border-gold bg-gold/10 shadow-sm'
                  : 'border-gold/20 bg-white/60 hover:border-gold/45'
                }`}
              >
                <span className="block font-georgia text-sm font-semibold text-deep">{option.name}</span>
                <span className="block font-georgia text-xs text-mist mt-1 leading-relaxed">{option.shortDescription}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="rounded-xl border border-gold/20 bg-deep/[0.025] px-4 py-3 mb-6">
        <p className="font-georgia text-sm font-medium text-deep mb-2">{spread.name}</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {spread.positions.map((position, index) => (
            <div key={position.label} className="font-georgia text-xs text-mist leading-relaxed">
              <span className="text-gold font-semibold">{index + 1}. {position.label}</span>
              <span className="block mt-0.5">{position.meaning}</span>
            </div>
          ))}
        </div>
      </div>

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
                {spread.positions[idx].label}
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
          <div className="text-center mb-6">
            <p className="font-georgia text-xs uppercase tracking-[0.16em] text-gold">Votre structure</p>
            <p className="font-georgia text-base text-deep mt-1">{result.spread?.name || spread.name}</p>
          </div>
          <div className="grid grid-cols-3 gap-4 mb-8">
            {result.cards.map((card, idx) => (
              <div key={idx} className="text-center">
                <img src={`/images/oracle/${card.id}.png`} alt={card.name}
                  className="w-full rounded-xl border-2 border-gold/30 shadow-sm mb-2"
                  onError={e => { e.target.src = '/images/oracle/verso.png' }} />
                <p className="font-georgia text-[11px] uppercase tracking-wide text-gold mb-1">
                  {result.spread?.positions?.[idx]?.label || spread.positions[idx].label}
                </p>
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
