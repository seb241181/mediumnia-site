import { useEffect, useState } from 'react'

// Paiement par virement : pas d'annonce "payé" avant validation humaine.
// 96 h = strictement au-delà des trois jours demandés ; le serveur revalide.
export default function BankTransferOption({
  practitionerSlug,service,dateStr,time,customer,checkoutId,
  paymentChoice,consentsReady,selectedModality,onBankPending,onUnavailable,offerToken,
}) {
  const [config,setConfig]=useState({enabled:false,minLeadHours:96})
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [expanded,setExpanded]=useState(false)
  useEffect(()=>{
    let active=true
    fetch('/api/rdv-config?bankBookingAction=config')
      .then(r=>r.ok?r.json():{enabled:false})
      .then(v=>{if(active)setConfig(v)})
      .catch(()=>{})
    return ()=>{active=false}
  },[])
  const startsAt=dateStr&&time?new Date(dateStr+'T'+time+':00'):null
  const enoughTime=startsAt&&Number.isFinite(startsAt.getTime())
    &&startsAt.getTime()>Date.now()+96*60*60*1000
  if(!config.enabled || offerToken || !enoughTime) return null
  async function submit() {
    if(busy||!consentsReady)return
    setBusy(true);setError('')
    try {
      const response=await fetch('/api/rdv-config?bankBookingAction=create',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          practitioner_slug:practitionerSlug,service_slug:service.slug,date:dateStr,time,
          customer,client_checkout_id:checkoutId,
          payment_choice:paymentChoice,termsAccepted:true,earlyPerformance:true,
        }),
      })
      const data=await response.json()
      if(!response.ok||!data.pending){
        if(data.error==='slot_unavailable')onUnavailable?.({code:'slot_held'})
        else setError({
          bank_min_4_days:'Cette date est trop proche pour recevoir un virement.',
          bank_request_rate_limited:'Trop de tentatives. Réessayez plus tard ou contactez MediumIA.',
          checkout_context_changed:'Ce formulaire a changé. Revenez au choix du créneau et recommencez.',
        }[data.error]||'Le virement ne peut pas être préparé actuellement. Aucun montant n’a été prélevé.')
        return
      }
      onBankPending?.(data)
    } catch {setError('Connexion indisponible. Réessayez ; aucun montant n’a été prélevé.')}
    finally {setBusy(false)}
  }
  return (
    <section id="rdv-bank-transfer" className="scroll-mt-20">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls="rdv-bank-transfer-details"
        onClick={() => setExpanded(open => !open)}
        className="flex min-h-[55px] w-full items-center justify-center gap-3 rounded-md bg-deep px-4 py-3 font-georgia text-base font-semibold text-cream transition hover:bg-deep/90 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-gold/40"
      >
        <span>Virement bancaire</span>
        <span aria-hidden="true" className="text-xl">{expanded ? '−' : '+'}</span>
      </button>
      {expanded && (
      <div id="rdv-bank-transfer-details" className="mt-3 rounded-xl border border-gold/30 bg-white/80 p-4">
      <p className="font-georgia text-xs uppercase tracking-[.16em] text-gold">Paiement par virement — mode d’emploi</p>
      <p className="mt-2 font-georgia text-sm leading-relaxed text-mist">
        Vous pouvez effectuer un virement pour les arrhes ou pour la totalité.
        Le créneau sera <strong>bloqué provisoirement pendant 72 heures au maximum</strong>,
        sans être confirmé tant que Sébastien n’aura pas constaté la réception de votre virement.
        La limite est avancée à 24 heures avant la séance lorsque nécessaire.
      </p>
      <p className="mt-2 font-georgia text-xs text-mist">
        Le RIB, la référence à indiquer et la date limite seront affichés après votre demande
        et envoyés par e-mail. Pensez à vérifier votre dossier spam.
      </p>
      {error&&<p role="alert" className="mt-3 text-sm text-red-800">{error}</p>}
      <button type="button" disabled={!consentsReady||busy} onClick={submit}
        className="mt-4 w-full rounded-xl border border-gold/50 bg-deep px-4 py-3 font-georgia text-sm font-semibold text-cream disabled:opacity-50">
        {busy?'Réservation provisoire en cours…':'Bloquer mon créneau et recevoir le RIB'}
      </button>
      {!consentsReady&&<p className="mt-2 text-xs text-mist">Acceptez d’abord les conditions de réservation ci-dessus.</p>}
      </div>
      )}
    </section>
  )
}
