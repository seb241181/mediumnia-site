import { useEffect, useState } from 'react'

// Caisse : bloc « ChronoSphère » du mois, à côté des rendez-vous et des livres.
// N'apparaît que pour l'administrateur de la plateforme (réponse 403 sinon).

const PRODUCTS = [
  ['single', 'Tirage unique', '5 €'],
  ['pack3', 'Pack 3 tirages', '9,90 €'],
  ['max3', 'ChronoSphère MAX', '19,90 €'],
]

function money(cents) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(Number(cents || 0) / 100)
}

export default function ChronosphereIncome({ session, from, to, onTotal }) {
  const [data, setData] = useState(null)
  const [hidden, setHidden] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!session?.access_token || !from || !to) return
    let cancelled = false
    setError(null)
    const params = new URLSearchParams({ action: 'chronosphere-finance', from, to })
    fetch(`/api/rdv-admin?${params}`, { headers: { Authorization: `Bearer ${session.access_token}` }, cache: 'no-store' })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}))
        if (res.status === 403) { if (!cancelled) { setHidden(true); onTotal?.(0) } return null }
        if (!res.ok) throw new Error(body.error || 'chronosphere_finance_error')
        return body
      })
      .then((body) => {
        if (cancelled || !body) return
        setHidden(false)
        setData(body)
        onTotal?.(Number(body.gross_cents || 0))
      })
      .catch((err) => { if (!cancelled) { setError(err.message); onTotal?.(0) } })
    return () => { cancelled = true }
  }, [session?.access_token, from, to]) // eslint-disable-line react-hooks/exhaustive-deps

  if (hidden) return null
  if (error) {
    return (
      <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
        <p className="font-georgia text-xs text-red-800">Encaissements ChronoSphère indisponibles pour le moment.</p>
      </div>
    )
  }
  if (!data) return null

  return (
    <div className="mt-5 rounded-2xl border border-gold/25 bg-gold/[.06] p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-georgia text-[10px] uppercase tracking-[0.16em] text-gold">Tirages · ChronoSphère</p>
          <h3 className="mt-1 font-georgia text-lg font-medium text-deep">{data.count} achat{data.count > 1 ? 's' : ''} ce mois-ci</h3>
          <ul className="mt-2 space-y-0.5 font-georgia text-xs text-mist">
            {PRODUCTS.map(([key, label, price]) => (
              <li key={key}>{label} ({price}) : <strong className="text-deep">{data.products?.[key]?.count || 0}</strong> · {money(data.products?.[key]?.gross_cents)}</li>
            ))}
          </ul>
        </div>
        <div className="grid min-w-[300px] grid-cols-3 gap-2">
          <div className="rounded-xl border border-gold/20 bg-white/60 px-3 py-3">
            <p className="font-georgia text-[9px] uppercase tracking-wide text-mist">TTC encaissé</p>
            <p className="mt-1 font-georgia text-lg font-semibold text-deep">{money(data.gross_cents)}</p>
          </div>
          <div className="rounded-xl border border-gold/20 bg-white/60 px-3 py-3">
            <p className="font-georgia text-[9px] uppercase tracking-wide text-mist">HT</p>
            <p className="mt-1 font-georgia text-lg font-semibold text-deep">{money(data.net_cents)}</p>
          </div>
          <div className="rounded-xl border border-gold/20 bg-white/60 px-3 py-3">
            <p className="font-georgia text-[9px] uppercase tracking-wide text-mist">TVA 20 %</p>
            <p className="mt-1 font-georgia text-lg font-semibold text-deep">{money(data.vat_cents)}</p>
          </div>
        </div>
      </div>
      <p className="mt-4 font-georgia text-[10px] leading-relaxed text-mist/75">
        Paiements PayPal réels du mois, à la date d’encaissement. Frais PayPal non déduits.
        {data.gift_activations_excluded ? ` ${data.gift_activations_excluded} pack(s) activé(s) par carte cadeau non compté(s) ici : la carte est déjà comptée à sa vente.` : ' Les packs activés par carte cadeau ne sont pas comptés ici : la carte est déjà comptée à sa vente.'}
      </p>
    </div>
  )
}
