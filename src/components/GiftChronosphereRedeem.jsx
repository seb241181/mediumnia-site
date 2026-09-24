import { useState } from 'react'

// « J'ai une carte cadeau » sur les pages ChronoSphère : le code active un pack
// (ou un suivi MAX) déjà réglé, sans passer par PayPal.

const ERRORS = {
  gift_code_invalid: 'Ce code n’est pas reconnu. Vérifiez-le (format MDIA-XXXX-XXXX).',
  gift_code_expired: 'Cette carte cadeau a expiré.',
  gift_no_chronosphere: 'Cette carte cadeau est réservée aux consultations : elle s’utilise au moment de réserver votre rendez-vous.',
  gift_chronosphere_redeemed: 'Les tirages ChronoSphère de cette carte ont déjà été activés. Retrouvez-les grâce au lien reçu par e-mail.',
  too_many_attempts: 'Trop d’essais. Réessayez dans une heure.',
  auth_required: 'Connectez-vous à votre compte MediumIA pour activer ChronoSphère MAX.',
  consent_required: 'Cochez la case d’exécution immédiate pour activer la carte.',
}

function errorMessage(data) {
  if (data?.error === 'gift_wrong_product') {
    return data.product === 'max3'
      ? <>Cette carte offre ChronoSphère MAX : activez-la sur <a href="/chronosphere-max" className="underline">la page MAX</a>.</>
      : <>Cette carte offre le pack de 3 tirages : activez-la sur <a href="/chronosphere" className="underline">la page ChronoSphère</a>.</>
  }
  return ERRORS[data?.error] || 'Activation impossible pour le moment. Réessayez dans quelques instants.'
}

export default function GiftChronosphereRedeem({ product, consentAccepted, consentText, accessToken, email, beforeRedeem, onRedeemed }) {
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [ownConsent, setOwnConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const consent = consentText ? ownConsent : Boolean(consentAccepted)

  async function activate() {
    setError('')
    if (code.replace(/[^0-9a-z]/gi, '').length < 12) { setError(ERRORS.gift_code_invalid); return }
    if (!consent) { setError(ERRORS.consent_required); return }
    if (beforeRedeem && !beforeRedeem()) return
    setBusy(true)
    try {
      const res = await fetch('/api/rdv-config?giftCardAction=chronosphere', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
        body: JSON.stringify({ code, product, consentAccepted: true, ...(email ? { email } : {}) }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.status !== 'ACTIVATED' || !data.packToken) { setError(errorMessage(data)); return }
      setCode('')
      onRedeemed(data)
    } catch {
      setError('Activation impossible pour le moment. Réessayez dans quelques instants.')
    } finally {
      setBusy(false)
    }
  }

  function setOpenState(next) {
    setOpen(next)
  }

  if (!open) {
    return (
      <div className="gift-redeem-peer" data-open="false">
        <style>{'.gift-redeem-peer[data-open="true"] ~ .chronosphere-standard-payment { display: none; }'}</style>
        <button type="button" onClick={() => setOpenState(true)} className="mt-4 w-full rounded-xl border border-gold/40 bg-white/70 px-5 py-3 font-georgia text-sm text-deep hover:bg-gold/10">
          🎁 J’ai une carte cadeau
        </button>
      </div>
    )
  }

  return (
    <div className="gift-redeem-peer mt-4 rounded-2xl border border-gold/35 bg-white/75 p-4 text-left" data-open="true">
      <style>{'.gift-redeem-peer[data-open="true"] ~ .chronosphere-standard-payment { display: none; }'}</style>
      <div className="flex items-center justify-between gap-3">
        <p className="font-georgia text-sm font-medium text-deep">🎁 Activer ma carte cadeau</p>
        <button type="button" onClick={() => setOpenState(false)} className="font-georgia text-xs text-mist underline underline-offset-2 hover:text-deep">Finalement, payer normalement</button>
      </div>
      <p className="mt-1 font-georgia text-xs leading-relaxed text-mist">
        {product === 'max3'
          ? 'Le suivi MAX offert (3 lectures) est rattaché à votre compte, à utiliser dans les 6 mois.'
          : 'Les 3 tirages offerts sont à utiliser dans les 6 mois ; le premier se lance tout de suite avec le formulaire ci-dessus.'}
      </p>
      <input
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); activate() } }}
        placeholder="MDIA-XXXX-XXXX"
        autoComplete="off"
        spellCheck={false}
        aria-label="Code de la carte cadeau"
        className="mt-3 w-full rounded-xl border border-gold/30 bg-white px-4 py-3 font-georgia text-base tracking-[0.12em] text-deep outline-none focus:border-gold"
      />
      {consentText && (
        <label className="mt-3 flex cursor-pointer items-start gap-3">
          <input type="checkbox" checked={ownConsent} onChange={(e) => setOwnConsent(e.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-gold" />
          <span className="font-georgia text-xs leading-relaxed text-deep/80">{consentText}</span>
        </label>
      )}
      {!consentText && !consent && <p className="mt-2 font-georgia text-xs text-mist">Cochez la case ci-dessus pour activer la carte.</p>}
      <button
        type="button"
        onClick={activate}
        disabled={busy}
        className="mt-3 w-full rounded-xl bg-deep px-5 py-3 font-georgia text-sm font-bold text-gold transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {busy ? 'Activation…' : product === 'max3' ? 'Activer mon suivi MAX offert' : 'Activer et lancer mon premier tirage'}
      </button>
      {error && <p role="alert" className="mt-3 font-georgia text-xs leading-relaxed text-red-700">{error}</p>}
    </div>
  )
}
