import { useEffect, useState } from 'react'

// Page Formation, section « Tarif » : la seconde façon de rejoindre la formation,
// le parcours progressif. Affiché seulement quand le serveur l'annonce ouvert
// (formationPathAction=offer répond 404 tant que le parcours est fermé).
// Les montants viennent du serveur : 29 € puis 48 €/mois, dernière 40 €, 597 € maximum.

const money = (cents) => `${(Number(cents || 0) / 100).toFixed(2).replace('.', ',').replace(',00', '')}\u00a0€`

export default function ParcoursOffer() {
  const [offer, setOffer] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/rdv-config?formationPathAction=offer', { headers: { Accept: 'application/json' } })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data?.enabled) return
        const { capCents, discoveryCents, stepCents, regularCount, finalCents } = data
        // Shown only if the amounts add up to the Formation price, never more.
        if (discoveryCents + regularCount * stepCents + finalCents !== capCents) return
        setOffer({ capCents, discoveryCents, stepCents, regularCount, finalCents })
      })
      .catch(() => null)
    return () => { cancelled = true }
  }, [])

  if (!offer) return null

  return (
    <div className="max-w-2xl mx-auto mt-10">
      <div className="rounded-2xl border-2 border-gold/35 bg-white/75 p-7 md:p-8 text-left shadow-[0_16px_46px_rgba(26,21,53,0.07)]">
        <div className="text-center mb-6">
          <p className="font-georgia text-[11px] text-gold tracking-[0.2em] uppercase mb-2">Ou à votre rythme</p>
          <h3 className="font-georgia text-2xl md:text-3xl font-medium text-deep">Parcours progressif</h3>
          <p className="font-georgia text-deep mt-3 leading-relaxed">
            <span className="text-2xl font-medium">{money(offer.discoveryCents)}</span> pour commencer, puis{' '}
            <span className="text-2xl font-medium">{money(offer.stepCents)}</span>/mois
          </p>
          <p className="font-georgia text-sm text-mist mt-1">dernière mensualité {money(offer.finalCents)} · total maximum {money(offer.capCents)} TTC</p>
        </div>

        <p className="rounded-xl border border-gold/30 bg-gold/10 px-4 py-3 text-center font-georgia text-sm font-semibold leading-relaxed text-deep mb-6">
          Même total que la Formation complète : {money(offer.capCents)}, jamais plus.
        </p>

        <ol className="font-georgia text-sm text-deep/85 space-y-2 max-w-lg mx-auto mb-6 tabular-nums">
          <li className="flex justify-between gap-4 border-b border-gold/15 pb-2"><span>Découverte · introduction et module 1</span><span className="shrink-0">{money(offer.discoveryCents)}</span></li>
          <li className="flex justify-between gap-4 border-b border-gold/15 pb-2"><span>{offer.regularCount} mensualités · 2 modules à chaque fois</span><span className="shrink-0">{offer.regularCount} × {money(offer.stepCents)}</span></li>
          <li className="flex justify-between gap-4 border-b border-gold/15 pb-2"><span>Dernière mensualité · modules 24 et 25</span><span className="shrink-0">{money(offer.finalCents)}</span></li>
          <li className="flex justify-between gap-4 font-semibold text-deep"><span>Total</span><span className="shrink-0">{money(offer.capCents)}</span></li>
        </ol>

        <ul className="font-georgia text-sm text-deep/85 space-y-2 max-w-lg mx-auto mb-6">
          {[
            'Arrêt en un clic à tout moment : les modules débloqués restent à vous',
            'Reprise possible quand vous le souhaitez',
            'Tout débloquer à tout moment : vous ne payez que le reste',
          ].map((item) => (
            <li key={item} className="flex gap-3 items-start"><span className="text-gold shrink-0 mt-0.5">✓</span><span>{item}</span></li>
          ))}
        </ul>

        <p className="font-georgia text-xs text-mist text-center">
          Le parcours commence par la Découverte ci-dessus. Déjà inscrit ?{' '}
          <a href="/formation/parcours" className="text-gold underline">Continuer dans Mon parcours →</a>
        </p>
      </div>
    </div>
  )
}
