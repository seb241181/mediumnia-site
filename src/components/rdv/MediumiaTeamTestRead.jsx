import { useEffect, useState } from 'react'
import { mediumiaTeamTestClient, readMediumiaTeamTest } from './mediumiaTeamTestClient.js'

const euro = cents => new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR'}).format((cents||0)/100)
const local = date => new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',dateStyle:'short',timeStyle:'short'}).format(new Date(date))

export default function MediumiaTeamTestRead() {
  const [session, setSession] = useState(null)
  const [ready, setReady] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!mediumiaTeamTestClient) { setReady(true); return }
    let active = true
    mediumiaTeamTestClient.auth.getSession().then(({data}) => {
      if (active) { setSession(data.session || null); setReady(true) }
    }).catch(() => { if(active) setReady(true) })
    const {data:{subscription}} = mediumiaTeamTestClient.auth.onAuthStateChange((_event,current) => {
      if(active) { setSession(current); if(!current) setReport(null) }
    })
    return () => { active = false; subscription.unsubscribe() }
  }, [])

  async function logIn(event) {
    event.preventDefault()
    if (!mediumiaTeamTestClient || busy) return
    setBusy(true)
    setError('')
    try {
      const {error:loginError} = await mediumiaTeamTestClient.auth.signInWithPassword({email:email.trim(),password})
      setPassword('')
      if(loginError) throw new Error('login_failed')
    } catch {
      setError('Connexion TEST refusée. Utilise les identifiants de ton compte MediumIA TEST.')
      setPassword('')
    } finally { setBusy(false) }
  }

  async function read() {
    if(busy || !session) return
    setBusy(true)
    setError('')
    try { setReport(await readMediumiaTeamTest()) }
    catch {
      setReport(null)
      setError('Impossible de lire le compte propriétaire TEST. Aucune donnée n’a été modifiée.')
    } finally { setBusy(false) }
  }

  if (!mediumiaTeamTestClient) return null
  return (
    <section aria-labelledby="team-real-test" className="rounded-2xl border border-gold/30 bg-white/80 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-georgia text-xs uppercase tracking-widest text-gold">Lecture des données TEST</p>
          <h3 id="team-real-test" className="mt-1 font-georgia text-xl text-deep">Lumia ouvre les yeux</h3>
        </div>
        <span className="rounded-full border border-gold/40 bg-cream px-3 py-1 font-georgia text-xs text-deep">
          Lecture seule
        </span>
      </div>
      <p className="mt-3 font-georgia text-sm leading-7 text-mist">
        Ce tableau lit les vraies réservations et les états de paiement de la base TEST.
        Il ne montre aucun nom de client et ne contacte pas PayPal.
      </p>

      {!ready && <p className="mt-4 font-georgia text-sm text-mist">Vérification de la session TEST…</p>}
      {ready && !session && (
        <form onSubmit={logIn} className="mt-4 space-y-3">
          <p className="font-georgia text-sm text-deep">Connecte-toi une fois au compte propriétaire MediumIA TEST.</p>
          <label className="block font-georgia text-xs text-mist">E-mail TEST
            <input required type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)}
              className="mt-1 block w-full max-w-md rounded-lg border border-gold/30 bg-cream px-3 py-2 text-deep"/>
          </label>
          <label className="block font-georgia text-xs text-mist">Mot de passe TEST
            <input required type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)}
              className="mt-1 block w-full max-w-md rounded-lg border border-gold/30 bg-cream px-3 py-2 text-deep"/>
          </label>
          <button disabled={busy} type="submit" className="rounded-xl bg-deep px-5 py-3 font-georgia text-sm font-semibold text-gold disabled:opacity-50">
            {busy?'Connexion…':'Me connecter à TEST'}
          </button>
        </form>
      )}

      {ready && session && (
        <div className="mt-4">
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={read} disabled={busy}
              className="rounded-xl bg-deep px-5 py-3 font-georgia text-sm font-semibold text-gold disabled:opacity-50">
              {busy?'Lecture en cours…': report?'Actualiser TEST':'Lire mes données TEST'}
            </button>
            <button type="button" onClick={()=>mediumiaTeamTestClient.auth.signOut()}
              className="rounded-xl border border-gold/40 bg-white px-4 py-2 font-georgia text-sm text-deep">
              Déconnexion TEST
            </button>
          </div>
          {report && (
            <div aria-live="polite" className="mt-5 space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  [String(report.bookings?.confirmed||0),'Rendez-vous confirmés dans TEST'],
                  [String(report.bookings?.future_confirmed||0),'Rendez-vous à venir dans TEST'],
                  [String(report.payments?.captured||0),'Paiements marqués capturés dans TEST'],
                ].map(([v,label])=>(
                  <div key={label} className="rounded-xl border border-gold/20 bg-cream/80 p-4">
                    <p className="font-georgia text-2xl text-deep">{v}</p>
                    <p className="font-georgia text-xs text-mist">{label}</p>
                  </div>
                ))}
              </div>
              <p className="font-georgia text-sm text-deep">
                Remboursements marqués terminés : <strong>{report.refunds?.completed||0}</strong>.
                Montant enregistré comme capturé dans la base TEST : <strong>{euro(report.payments?.captured_total_cents)}</strong>.
              </p>
              {report.upcoming_slots?.length>0 && (
                <div>
                  <h4 className="font-georgia text-sm font-semibold text-deep">Prochains créneaux confirmés dans TEST</h4>
                  <ul className="mt-2 space-y-1">
                    {report.upcoming_slots.map((s,i)=>(
                      <li key={i} className="rounded-lg bg-cream/80 px-3 py-2 font-georgia text-sm text-deep">
                        {local(s.starts_at)} — {s.service}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="font-georgia text-xs text-mist">
                Source : Supabase TEST · lecture vérifiée par le compte propriétaire.
                Les montants sont ceux enregistrés en TEST, pas une confirmation bancaire.
              </p>
            </div>
          )}
        </div>
      )}
      {error && <p role="alert" className="mt-4 font-georgia text-sm text-red-800">{error}</p>}
    </section>
  )
}
