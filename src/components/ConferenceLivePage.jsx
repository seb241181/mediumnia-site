import { useCallback, useEffect, useMemo, useState } from 'react'
import { CONFERENCE_LIVE_API } from '../lib/conferenceApi.js'

const LIVE_API = CONFERENCE_LIVE_API

function getAccessToken() {
  const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash
  return new URLSearchParams(hash).get('access') || ''
}

function getSlug() {
  const parts = window.location.pathname.split('/').filter(Boolean)
  return parts[1] || 'premiere-conference-mediumia'
}

function formatTime(value) {
  if (!value) return ''
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }).format(new Date(value))
}

export default function ConferenceLivePage() {
  const slug = useMemo(getSlug, [])
  const access = useMemo(getAccessToken, [])
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [question, setQuestion] = useState('')
  const [questionState, setQuestionState] = useState('idle')
  const [raffleState, setRaffleState] = useState('idle')
  const [notice, setNotice] = useState('')

  const call = useCallback(async (method = 'GET', body) => {
    const response = await fetch(`${LIVE_API}?slug=${encodeURIComponent(slug)}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-conference-access': access,
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(payload.error || 'Le LIVE MediumIA est indisponible.')
    return payload
  }, [access, slug])

  const refresh = useCallback(async () => {
    if (!access) {
      setError('Ce lien LIVE est incomplet. Utilisez le lien personnel reçu par e-mail.')
      setLoading(false)
      return
    }
    try {
      const payload = await call('GET')
      setData(payload)
      setError('')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [access, call])

  useEffect(() => {
    let active = true
    const heartbeat = async () => {
      if (!access || !active) return
      try { await call('POST', { action: 'heartbeat' }) } catch {}
      if (active) await refresh()
    }
    heartbeat()
    const timer = window.setInterval(heartbeat, 60_000)
    return () => { active = false; window.clearInterval(timer) }
  }, [access, call, refresh])

  const submitQuestion = async (event) => {
    event.preventDefault()
    setNotice('')
    setQuestionState('loading')
    try {
      await call('POST', { action: 'question', question })
      setQuestion('')
      setQuestionState('success')
      setNotice('Question envoyée à Sébastien ✨')
      window.setTimeout(() => setQuestionState('idle'), 1800)
    } catch (err) {
      setQuestionState('error')
      setNotice(err.message)
    }
  }

  const enterRaffle = async () => {
    setNotice('')
    setRaffleState('loading')
    try {
      await call('POST', { action: 'raffle_enter' })
      setRaffleState('success')
      setNotice('Participation au tirage enregistrée 🎁')
      await refresh()
    } catch (err) {
      setRaffleState('error')
      setNotice(err.message)
    }
  }

  if (loading) return <div className="min-h-screen bg-deep text-cream grid place-items-center font-georgia">Ouverture du LIVE MediumIA…</div>

  if (error) {
    return <div className="min-h-screen bg-deep text-cream px-6 grid place-items-center"><div className="max-w-lg rounded-3xl border border-gold/30 bg-white/5 p-8 text-center"><p className="font-georgia text-xs uppercase tracking-[.2em] text-gold">LIVE MEDIUMIA</p><h1 className="mt-4 font-georgia text-3xl">Accès impossible</h1><p className="mt-4 font-georgia leading-relaxed text-cream/65">{error}</p><a href="/conferences" className="mt-7 inline-block rounded-lg border border-gold/50 px-5 py-3 font-georgia text-sm text-gold">Retour à la conférence</a></div></div>
  }

  const raffle = data?.raffle
  const now = Date.now()
  const raffleOpen = raffle?.opensAt && raffle?.closesAt && now >= new Date(raffle.opensAt).getTime() && now <= new Date(raffle.closesAt).getTime()

  return (
    <div className="min-h-screen bg-cream text-deep">
      <header className="border-b border-gold/20 bg-deep text-cream"><div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-5"><div><p className="font-georgia text-[10px] uppercase tracking-[.24em] text-gold">MEDIUMIA · LIVE</p><p className="mt-1 font-georgia text-sm text-cream/65">22 octobre · 19 h → 20 h</p></div><img src="/images/brand/MEDIUMIA_symbol_header.png" alt="MediumIA" className="h-10 w-auto" /></div></header>

      <main className="mx-auto max-w-6xl px-5 py-9 md:py-12">
        <section className="rounded-3xl bg-deep p-7 text-cream shadow-xl md:p-10"><p className="font-georgia text-xs uppercase tracking-[.22em] text-gold">Bonsoir {data?.participant?.firstName}</p><h1 className="mt-4 max-w-3xl font-georgia text-3xl font-medium leading-tight md:text-5xl">{data?.event?.title}</h1><div className="mt-6 flex flex-wrap gap-3"><span className={`rounded-full px-4 py-2 font-georgia text-xs ${data?.liveOpen ? 'bg-gold text-deep' : 'border border-gold/35 text-gold'}`}>{data?.liveOpen ? '● LIVE ouvert' : 'LIVE le 22 octobre à 19 h'}</span>{data?.event?.zoomJoinUrl && <a href={data.event.zoomJoinUrl} target="_blank" rel="noreferrer" className="rounded-full border border-cream/20 px-4 py-2 font-georgia text-xs text-cream">Ouvrir Zoom ↗</a>}</div></section>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1.15fr_.85fr]">
          <section className="rounded-3xl border border-gold/20 bg-white/80 p-6 md:p-8"><p className="font-georgia text-[10px] uppercase tracking-[.2em] text-gold">POSEZ VOTRE QUESTION À SÉBASTIEN</p><h2 className="mt-3 font-georgia text-2xl font-medium">Une question vous vient pendant le direct ?</h2><p className="mt-3 font-georgia text-sm leading-relaxed text-mist">Écrivez-la ici. Le cockpit MediumIA aide Sébastien à faire remonter les questions du public sans qu’elles se perdent dans le chat Zoom.</p><form onSubmit={submitQuestion} className="mt-6"><textarea value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={600} rows={6} disabled={!data?.questionsOpen || questionState === 'loading'} placeholder={data?.questionsOpen ? 'Votre question…' : 'Les questions s’ouvriront autour du direct.'} className="w-full resize-none rounded-2xl border border-gold/25 bg-cream/60 p-4 font-georgia text-sm outline-none focus:border-gold disabled:opacity-60" /><div className="mt-3 flex items-center justify-between gap-4"><span className="font-georgia text-[11px] text-mist">{question.length}/600</span><button disabled={!data?.questionsOpen || question.trim().length < 3 || questionState === 'loading'} className="rounded-xl bg-deep px-5 py-3 font-georgia text-sm font-bold text-gold disabled:opacity-40">{questionState === 'loading' ? 'Envoi…' : 'Envoyer ma question'}</button></div></form></section>

          <section className="rounded-3xl border border-gold/35 bg-[#fbf7ea] p-6 md:p-8"><p className="font-georgia text-[10px] uppercase tracking-[.2em] text-gold">🎁 TIRAGE AU SORT EN DIRECT</p><h2 className="mt-3 font-georgia text-2xl font-medium">{raffle?.prizeTitle || '1 formation MediumIA complète'}</h2><p className="mt-2 font-georgia text-lg font-semibold text-gold">Valeur 597 €</p><p className="mt-4 font-georgia text-sm leading-relaxed text-mist">Participation gratuite, sans obligation d’achat. Le bouton s’ouvre uniquement pendant le direct pour confirmer que vous êtes bien présent.</p>{raffle?.opensAt && <div className="mt-5 rounded-2xl border border-gold/20 bg-white/60 p-4 font-georgia text-sm"><strong>Fenêtre du tirage :</strong><br />{formatTime(raffle.opensAt)} → {formatTime(raffle.closesAt)}</div>}<button onClick={enterRaffle} disabled={!raffleOpen || raffle?.hasEntered || raffleState === 'loading'} className="mt-5 w-full rounded-xl bg-gold px-5 py-4 font-georgia text-sm font-bold text-deep disabled:opacity-45">{raffle?.hasEntered ? '✓ Je participe au tirage' : raffleState === 'loading' ? 'Validation…' : raffleOpen ? '🎁 Je participe au tirage' : 'Participation disponible pendant le direct'}</button><a href="/reglement-tirage-conference-mediumia-22-10-2026.html" target="_blank" rel="noreferrer" className="mt-4 block text-center font-georgia text-[11px] text-mist underline">Voir les modalités du tirage</a></section>
        </div>

        {notice && <div role="status" className="mt-6 rounded-2xl border border-gold/25 bg-white p-4 text-center font-georgia text-sm text-deep">{notice}</div>}
      </main>
    </div>
  )
}
