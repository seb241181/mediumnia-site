import { useCallback, useEffect, useState } from 'react'

const money=n=>(Number(n)/100).toFixed(2).replace('.',',')+' €'
const when=d=>new Intl.DateTimeFormat('fr-FR',{
  dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Paris',
}).format(new Date(d))
export default function BankTransferAdminPanel({practitionerId,session,onChanged}) {
  const [rows,setRows]=useState([])
  const [refundRows,setRefundRows]=useState([])
  const [loading,setLoading]=useState(false)
  const [busy,setBusy]=useState(null)
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  const [bankConnection,setBankConnection]=useState(null)
  const [bankConnectionAvailable,setBankConnectionAvailable]=useState(false)
  const [bankConnecting,setBankConnecting]=useState(false)
  const [bankConnectionError,setBankConnectionError]=useState('')
  const token=session?.access_token
  const load=useCallback(async()=>{
    if(!token||!practitionerId)return
    setLoading(true)
    try{
      const res=await fetch('/api/rdv-admin?action=bank-bookings&practitioner_id='+encodeURIComponent(practitionerId),{
        headers:{Authorization:'Bearer '+token},
      })
      const data=await res.json()
      if(!res.ok)throw new Error(data.error||'lecture impossible')
      setRows(data.requests||[])
      setRefundRows(data.refunds_to_review||[])
    }catch{setError('Impossible de récupérer les virements en attente.')}
    finally{setLoading(false)}
  },[practitionerId,token])
  useEffect(()=>{void load()},[load])
  useEffect(()=>{
    if(!token)return
    let active=true
    fetch('/api/rdv-admin?action=bank-connection',{
      headers:{Authorization:'Bearer '+token},cache:'no-store',
    }).then(async response=>{
      if(!active)return
      if(response.status===503){setBankConnectionAvailable(false);return}
      if(!response.ok)return
      const body=await response.json()
      if(active){setBankConnectionAvailable(true);setBankConnection(body.connection||null)}
    }).catch(()=>{})
    return ()=>{active=false}
  },[token])
  async function connectBank(){
    if(!token||bankConnecting)return
    setBankConnectionError('')
    setBankConnecting(true)
    try{
      const response=await fetch('/api/rdv-admin?action=bank-connection',{
        method:'POST',
        headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
        body:'{}',
      })
      const body=await response.json().catch(()=>({}))
      if(!response.ok||typeof body.authorization_url!=='string')throw new Error('unavailable')
      const url=new URL(body.authorization_url)
      if(url.protocol!=='https:'||(url.hostname!=='enablebanking.com'&&!url.hostname.endsWith('.enablebanking.com')))
        throw new Error('untrusted_bank_url')
      window.location.assign(url.href)
    }catch{setBankConnectionError('Connexion indisponible. Aucune donnée bancaire modifiée.')}
    finally{setBankConnecting(false)}
  }
  async function act(row,op){
    const msg=op==='confirm'
      ? 'Avez-vous vérifié sur votre compte bancaire la réception du virement de '+money(row.amount_cents)+' (référence '+row.reference+') ?'
      : 'Annuler le blocage provisoire de '+row.customer_name+' ?'
    if(!window.confirm(msg))return
    setBusy(row.id);setError('');setNotice('')
    try{
      const response=await fetch('/api/rdv-admin?action=bank-bookings',{
        method:'POST',
        headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
        body:JSON.stringify({practitioner_id:practitionerId,request_id:row.id,op}),
      })
      const data=await response.json()
      if(!response.ok)throw new Error(data.error||'operation_refused')
      setNotice(op==='confirm'
        ? 'Virement comptabilisé ; rendez-vous confirmé.'+(data.googleSync==='failed'?' Vérifiez sa présence dans Google Agenda.':'')
        : 'Blocage provisoire levé.')
      await load();onChanged?.()
    }catch{setError('Opération impossible. Vérifiez le statut et contactez l’assistance technique si nécessaire.')}
    finally{setBusy(null)}
  }
  const pending=rows.filter(r=>r.status==='pending'||r.status==='expired')
  return (
    <section className="rounded-2xl border border-gold/25 bg-white/60 p-4 sm:p-6">
      <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
        <div>
          <p className="font-georgia text-[11px] uppercase tracking-[.18em] text-gold">Paiements en attente</p>
          <h2 className="font-georgia text-lg font-medium">Virements bancaires</h2>
        </div>
        <button onClick={load} disabled={loading} className="rounded-lg border border-gold/30 px-3 py-2 text-sm text-deep">
          {loading?'Actualisation…':'Actualiser'}
        </button>
      </div>
      <div className="mb-4 rounded-xl border border-gold/20 bg-white/80 p-3 text-sm">
        <p className="font-georgia font-semibold text-deep">Crédit Mutuel PRO — lecture seule</p>
        <p className="mt-1 text-xs text-mist">
          {bankConnection?.status==='review_required'
            ? 'Autorisation reçue ; le compte reste à vérifier. Aucun règlement n’est validé automatiquement.'
            : bankConnectionAvailable
              ? 'Connexion possible après validation des autorisations bancaires. Aucun virement sortant.'
              : 'Connexion bancaire non activée. Les validations de virements restent manuelles.'}
        </p>
        {bankConnectionAvailable&&!bankConnection&&<button type="button" disabled={bankConnecting}
          onClick={connectBank} className="mt-2 rounded-lg border border-gold/40 px-3 py-2 text-xs font-semibold disabled:opacity-50">
          {bankConnecting?'Ouverture sécurisée…':'Connecter mon compte en lecture seule'}
        </button>}
        {bankConnectionError&&<p role="alert" className="mt-2 text-xs text-red-800">{bankConnectionError}</p>}
      </div>
      <p className="font-georgia text-sm text-mist mb-4">
        Une demande de virement bloque le créneau sur MediumIA mais ne constitue pas un règlement.
        Cliquez sur « Virement reçu » uniquement après l'avoir constaté sur votre relevé bancaire.
      </p>
      {error&&<p role="alert" className="text-red-800 text-sm mb-3">{error}</p>}
      {notice&&<p role="status" className="text-emerald-800 text-sm mb-3">{notice}</p>}
      {!loading&&!pending.length&&<p className="text-sm text-mist">Aucun virement en attente de validation.</p>}
      {refundRows.length>0&&(
        <div className="my-5 rounded-xl border border-amber-300 bg-amber-50/80 p-4">
          <h3 className="font-georgia font-semibold text-deep">Virements de rendez-vous annulés — à examiner</h3>
          <p className="mt-2 font-georgia text-xs leading-relaxed text-mist">
            Le remboursement d'un virement n'est jamais automatique. Vérifiez les droits du client et
            demandez au payeur les coordonnées bancaires nécessaires. Après le virement de remboursement,
            conservez le justificatif pour votre comptabilité : cette rubrique ne comptabilise pas encore automatiquement les remboursements bancaires.
          </p>
          <div className="mt-3 space-y-3">
            {refundRows.map(row=>(
              <article key={row.request_id} className="rounded-lg border border-amber-200 bg-white p-3">
                <p className="font-georgia text-sm font-semibold">{row.customer_name} — {when(row.starts_at)}</p>
                <p className="text-xs text-mist">Réf. {row.reference} · reçu initialement : {money(row.amount_cents)}</p>
                <p className="mt-2 text-sm font-georgia text-deep">
                  {row.recommended_refund_cents == null
                    ? 'Montant à vérifier manuellement (ancien contrat, annulation du praticien ou droit légal).'
                    : 'Remboursement restant indicatif : '+money(row.recommended_refund_cents)+' (sous réserve des droits légaux).'}
                </p>
                <a className="mt-2 inline-block text-xs text-gold underline" href={'mailto:'+row.customer_email}>Contacter le client</a>
              </article>
            ))}
          </div>
        </div>
      )}
      <div className="space-y-3">
        {pending.map(row=><article key={row.id} className="rounded-xl border border-gold/20 bg-white/75 p-4">
          <div className="flex flex-wrap justify-between gap-3">
            <div>
              <p className="font-georgia font-semibold">{row.customer_name}</p>
              <p className="font-georgia text-sm text-mist">Rendez-vous : {when(row.starts_at)}</p>
              <p className="font-georgia text-xs text-mist">{row.customer_email}</p>
            </div>
            <div className="text-right">
              <p className="font-georgia font-semibold">{money(row.amount_cents)}</p>
              <p className="font-georgia text-xs">{row.payment_choice==='arrhes'?'Arrhes':'Totalité'}</p>
              <p className="font-georgia text-xs text-mist">Réf. {row.reference}</p>
            </div>
          </div>
          <p className="my-3 text-sm text-mist">
            {row.status==='expired'?'Délai expiré : créneau libéré':'Bloqué jusqu’au '+when(row.expires_at)}
          </p>
          {row.status==='pending'&&<div className="flex flex-wrap gap-2">
            <button onClick={()=>act(row,'confirm')} disabled={busy===row.id}
              className="rounded-lg bg-deep px-3 py-2 text-sm text-cream disabled:opacity-50">Virement reçu : confirmer</button>
            <button onClick={()=>act(row,'cancel')} disabled={busy===row.id}
              className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-700 disabled:opacity-50">Libérer le créneau</button>
          </div>}
        </article>)}
      </div>
    </section>
  )
}
