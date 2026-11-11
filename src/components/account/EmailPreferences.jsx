import { useEffect, useState } from 'react'
import { MARKETING_CONSENT_HINT, MARKETING_CONSENT_TEXT, MARKETING_STATUS_LABELS } from '../../../lib/marketingConsentText.js'

// Mes préférences : actualités MediumIA par e-mail (compte connecté).
// Les e-mails de rendez-vous ne dépendent pas de ce réglage.

const DETAILS = {
  subscribed: 'Vous recevez les actualités, conseils et offres de MediumIA.',
  none: 'Vous ne recevez pas les actualités de MediumIA.',
  unsubscribed: 'Vous vous êtes désinscrit(e). Vous ne recevez plus les actualités de MediumIA.',
  pending: 'Votre demande attend une confirmation. Vous pouvez la confirmer ici, votre adresse étant déjà vérifiée.',
}

async function call(token, action, method = 'GET') {
  try {
    const response = await fetch(`/api/rdv-config?marketingAction=${action}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
      ...(method === 'POST' ? { body: '{}' } : {}),
    })
    if (!response.ok) return { error: true }
    return await response.json()
  } catch {
    return { error: true }
  }
}

export default function EmailPreferences({ token, email }) {
  const [state, setState] = useState({ status: null, error: false })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    call(token, 'preferences').then((data) => { if (active) setState({ status: data.status || null, error: Boolean(data.error) }) })
    return () => { active = false }
  }, [token])

  async function change(action) {
    setBusy(true)
    const data = await call(token, action, 'POST')
    setBusy(false)
    setState((previous) => (data.error ? { ...previous, error: true } : { status: data.status, error: false }))
  }

  const { status, error } = state
  const subscribed = status === 'subscribed'

  return (
    <section aria-labelledby="preferences-title">
      <h2 id="preferences-title" className="font-georgia text-xl font-medium">Actualités MediumIA par e-mail</h2>
      {!status && !error && <p className="mt-4 font-georgia text-sm text-mist" role="status">Chargement…</p>}
      {status && (
        <div className="mt-4 rounded-2xl border border-gold/30 bg-white/70 p-5">
          <p className="font-georgia text-[11px] uppercase tracking-[0.16em] text-gold">Votre statut</p>
          <p className="mt-1 font-georgia text-lg font-bold text-deep">{MARKETING_STATUS_LABELS[status] || MARKETING_STATUS_LABELS.none}</p>
          <p className="mt-1 font-georgia text-sm leading-relaxed text-mist">{DETAILS[status] || DETAILS.none}</p>
          <p className="mt-1 break-all font-georgia text-xs text-mist/80">Adresse concernée : {email}</p>

          {subscribed ? (
            <button type="button" disabled={busy} onClick={() => change('withdraw')}
              className="mt-4 w-full rounded-xl border-2 border-gold/45 px-6 py-3.5 font-georgia text-sm font-bold text-deep transition-colors hover:bg-gold/10 disabled:opacity-50">
              {busy ? 'Un instant…' : 'Me désinscrire'}
            </button>
          ) : (
            <>
              <p className="mt-4 font-georgia text-sm leading-relaxed text-deep">{MARKETING_CONSENT_TEXT}</p>
              <button type="button" disabled={busy} onClick={() => change('subscribe')}
                className="mt-3 w-full rounded-xl bg-deep px-6 py-4 font-georgia text-base font-bold text-gold transition-colors hover:bg-deep/90 disabled:opacity-50">
                {busy ? 'Un instant…' : (status === 'pending' ? 'Confirmer mon inscription' : 'Recevoir les actualités')}
              </button>
              {status === 'pending' && (
                <button type="button" disabled={busy} onClick={() => change('withdraw')} className="mt-2 w-full py-2 font-georgia text-xs text-mist underline hover:text-deep">
                  Finalement, je ne souhaite pas m’inscrire
                </button>
              )}
            </>
          )}
        </div>
      )}
      {error && <p role="alert" className="mt-3 font-georgia text-sm text-red-700">Vos préférences n’ont pas pu être {status ? 'enregistrées' : 'chargées'}. Réessayez dans un instant.</p>}
      <p className="mt-4 font-georgia text-xs leading-relaxed text-mist">{MARKETING_CONSENT_HINT}</p>
    </section>
  )
}
