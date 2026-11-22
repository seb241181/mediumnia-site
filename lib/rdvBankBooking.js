import { RDV_TERMS_VERSION, RDV_TERMS_URL, rdvRefundGuidance } from './rdvCancellationTerms.js'
/* global process */
import { createHmac } from 'node:crypto'
import { getSupabaseAdmin, isSupabaseConfigured } from './supabaseAdmin.js'
import { recordBookingConsent } from './marketingConsent.js'
import { validateServerAvailability } from './rdvDepositApiHandler.js'
import { sendEmail, escapeHtml } from './transactionalEmail.js'
import { syncBookingToGoogleCalendar } from './googleCalendarEvents.js'
import { createCancellationToken, bookingCancellationUrl } from './bookingCancellation.js'
import { buildRdvDepositConfirmation } from './rdvDepositConfirmationEmail.js'
import { accountSpaceUrl } from './rdvContactMode.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/
const MIN_LEAD_HOURS = 96
const TERMS_VERSION = RDV_TERMS_VERSION
const MONEY = n => (Number(n) / 100).toFixed(2).replace('.', ',') + ' €'
const bankDetails = () => ({
  holder: String(process.env.BOOKING_BANK_HOLDER || '').trim(),
  iban: String(process.env.BOOKING_BANK_IBAN || '').replace(/\s/g,'').toUpperCase(),
  bic: String(process.env.BOOKING_BANK_BIC || '').replace(/\s/g,'').toUpperCase(),
})
const bankReady = () => {
  const b = bankDetails()
  return !!(b.holder && /^FR[0-9A-Z]{25}$/.test(b.iban) && isSupabaseConfigured())
}
function sanitizeError(code) {
  return ['bank_min_4_days','slot_unavailable','daily_limit_reached','checkout_context_changed',
    'outside_horizon','invalid_customer','request_expired','service_not_payable'].includes(code) ? code : 'bank_booking_unavailable'
}
function bankMail({firstName,serviceTitle,startsAt,amountCents,deadline,reference,bank}) {
  const when = new Intl.DateTimeFormat('fr-FR', {dateStyle:'full',timeStyle:'short',timeZone:'Europe/Paris'}).format(new Date(startsAt))
  const by = new Intl.DateTimeFormat('fr-FR', {dateStyle:'full',timeStyle:'short',timeZone:'Europe/Paris'}).format(new Date(deadline))
  const lines = [
    'Bonjour '+firstName+',','','Votre créneau est provisoirement bloqué, mais votre rendez-vous n’est pas encore confirmé.',
    'Prestation : '+serviceTitle,'Date : '+when,'Virement demandé : '+MONEY(amountCents),
    'Référence à indiquer impérativement : '+reference,'Titulaire : '+bank.holder,
    'IBAN : '+bank.iban,'BIC : '+(bank.bic || 'non nécessaire pour un virement SEPA dans l’EEE'),
    'Date limite de réception et validation : '+by,
    'Le créneau sera libéré si le paiement n’est pas réceptionné et validé avant cette échéance.',
    'Ne payez pas une deuxième fois si le virement est déjà parti : contactez Sébastien en précisant la référence.',
    'Conditions de réservation et d’annulation : '+RDV_TERMS_URL,
    'Pensez à vérifier les courriers indésirables (spams) pour les futurs e-mails de MediumIA.',
    'À bientôt,','Sébastien — MediumIA',
  ]
  return {
    subject:'MediumIA — Virement demandé, créneau bloqué provisoirement',
    text:lines.join('\n'),
    html:'<!doctype html><html lang="fr"><meta charset="utf-8"><body style="font-family:Georgia,serif;color:#1A1535;max-width:650px;margin:auto;padding:24px;"><h2>MediumIA — Virement bancaire</h2>'+
      '<p>Bonjour '+escapeHtml(firstName)+',</p><p><strong>Votre créneau est bloqué provisoirement, mais non confirmé tant que le virement n’est pas reçu et validé.</strong></p>'+
      '<p>Prestation : '+escapeHtml(serviceTitle)+'<br>Date : '+escapeHtml(when)+'<br>Montant : <strong>'+MONEY(amountCents)+'</strong></p>'+
      '<div style="padding:16px;background:#f5f0e5;border-radius:10px;"><p>Référence obligatoire : <strong>'+escapeHtml(reference)+'</strong></p>'+
      '<p>Titulaire : '+escapeHtml(bank.holder)+'<br>IBAN : '+escapeHtml(bank.iban)+'<br>BIC : '+escapeHtml(bank.bic || 'non requis dans l’EEE')+'</p></div>'+
      '<p><strong>Limite de réception et validation : '+escapeHtml(by)+'</strong>. Après cette échéance, le créneau est automatiquement libéré.</p>'+
      '<p>Un virement déjà envoyé ? Ne payez pas une seconde fois ; écrivez à contact@mediumia.fr avec votre référence.</p>'+
      '<p><a href="'+RDV_TERMS_URL+'">Consulter les conditions de réservation et d’annulation</a>.</p>'+
      '<p><strong>Pensez à consulter le dossier spam ou courriers indésirables.</strong></p><p>Sébastien — MediumIA</p></body></html>',
  }
}
async function bankRateLimit(req,supabase) {
  const secret=String(process.env.RDV_RATE_LIMIT_SECRET||'')
  const ip=String(req.headers?.['x-forwarded-for']||'').split(',')[0].trim().toLowerCase()
  if(!/^[a-f0-9]{64}$/i.test(secret)||!ip)return false
  const hash=createHmac('sha256',secret).update(ip).digest('hex')
  const {data,error}=await supabase.rpc('consume_api_rate_limit',{
    p_ip_hash:hash,p_endpoint:'rdv_bank_booking',p_hourly_limit:8,p_daily_limit:18,
  })
  return !error && !!data?.allowed
}
export async function handleBankBookingPublic(req,res,action) {
  res.setHeader('Cache-Control','no-store')
  if(action==='config' && req.method==='GET') return res.status(200).json({enabled:bankReady(),minLeadHours:MIN_LEAD_HOURS})
  if(action!=='create'||req.method!=='POST')return res.status(405).json({error:'method_not_allowed'})
  if(!bankReady())return res.status(503).json({error:'bank_booking_unavailable'})
  if(req.body?.offer_token)return res.status(400).json({error:'bank_booking_unavailable'})
  if(req.body?.termsAccepted!==true||req.body?.earlyPerformance!==true)return res.status(400).json({error:'terms_required'})
  const {practitioner_slug,service_slug,date,time,customer,client_checkout_id,payment_choice}=req.body||{}
  if(practitioner_slug!=='sebastien-seguin'||!DAY_RE.test(date||'')||!TIME_RE.test(time||'')
    ||!UUID_RE.test(client_checkout_id||'')||!['arrhes','full_payment'].includes(payment_choice)
    ||!customer?.firstName||!customer?.lastName||!customer?.email)
    return res.status(400).json({error:'invalid_request'})
  const supabase=getSupabaseAdmin()
  if(!await bankRateLimit(req,supabase))return res.status(429).json({error:'bank_request_rate_limited'})
  const {data:practitioner}=await supabase.from('booking_practitioners')
    .select('id,slug,is_active,booking_enabled,min_advance_hours,booking_horizon_days').eq('slug',practitioner_slug).maybeSingle()
  if(!practitioner?.is_active||!practitioner?.booking_enabled)return res.status(503).json({error:'booking_unavailable'})
  const {data:service}=await supabase.from('booking_services')
    .select('id,slug,title,duration_min,modality,price_cents,reservation_payment_cents,reservation_payment_kind,booking_mode,is_active')
    .eq('slug',service_slug).eq('practitioner_id',practitioner.id).maybeSingle()
  if(!service?.is_active||service.booking_mode!=='instant'||service.reservation_payment_kind!=='arrhes')
    return res.status(400).json({error:'service_not_payable'})
  const selectedModality=service.modality?.includes('video')?'video':'in-person'
  let slot
  try { slot=await validateServerAvailability({supabase,practitioner,service,date,time}) }
  catch { return res.status(409).json({error:'slot_unavailable'}) }
  if(slot.startsAt.getTime()<Date.now()+MIN_LEAD_HOURS*3600000)
    return res.status(409).json({error:'bank_min_4_days'})
  const {data:result,error}=await supabase.rpc('create_rdv_bank_booking_request',{
    p_practitioner_id:practitioner.id,p_service_id:service.id,
    p_starts_at:slot.startsAt.toISOString(),p_ends_at:slot.endsAt.toISOString(),
    p_selected_modality:selectedModality,p_video_channel:customer.videoChannel||null,
    p_first_name:customer.firstName,p_last_name:customer.lastName,
    p_email:customer.email,p_phone:customer.phone||null,p_message:customer.message||null,
    p_client_checkout_id:client_checkout_id,p_payment_choice:payment_choice,
    p_terms_version:TERMS_VERSION,p_early_performance:true,
  })
  if(error){console.error('[bank-booking] creation SQL failed',error.code);return res.status(503).json({error:'bank_booking_unavailable'})}
  if(!result?.ok)return res.status(409).json({error:sanitizeError(result?.error)})
  // Marketing indépendant de la réservation : enregistrer le choix seulement
  // s'il a effectivement été proposé. Ne jamais bloquer le virement sur une panne.
  if (!result.existing && typeof customer.marketingOptIn === 'boolean') {
    try {
      const {data:requestRow}=await supabase.from('rdv_bank_booking_requests')
        .select('hold_id').eq('id',result.request_id).maybeSingle()
      if(requestRow?.hold_id)await recordBookingConsent(supabase,{
        email:customer.email,optIn:customer.marketingOptIn,holdId:requestRow.hold_id,
      })
    }catch { /* opt-in facultatif, sans effet sur le paiement */ }
  }
  const bank=bankDetails()
  let mailStatus='pending'
  const {data:bankRow}=await supabase.from('rdv_bank_booking_requests').select('pending_email_sent_at')
    .eq('id',result.request_id).single()
  if(bankRow&&!bankRow.pending_email_sent_at){
    const sent=await sendEmail({to:customer.email,...bankMail({
      firstName:customer.firstName,serviceTitle:service.title,startsAt:slot.startsAt,
      amountCents:result.amount_cents,deadline:result.expires_at,reference:result.reference,bank,
    }),idempotencyKey:'bank-pending/'+result.request_id})
    mailStatus=sent.status
    if(sent.status==='sent') await supabase.from('rdv_bank_booking_requests')
      .update({pending_email_sent_at:new Date().toISOString()}).eq('id',result.request_id).is('pending_email_sent_at',null)
  } else if(bankRow?.pending_email_sent_at)mailStatus='already_sent'
  return res.status(200).json({pending:true,amountCents:result.amount_cents,priceCents:service.price_cents,
    reference:result.reference,expiresAt:result.expires_at,
    holder:bank.holder,iban:bank.iban,bic:bank.bic,emailStatus:mailStatus})
}
async function listBankRequests(supabase,userId,practitionerId) {
  const {data:owned}=await supabase.from('booking_practitioners').select('id')
    .eq('id',practitionerId).eq('owner_id',userId).maybeSingle()
  if(!owned)return {status:403,body:{error:'forbidden'}}
  const {data,error}=await supabase.from('rdv_bank_booking_requests')
    .select('id,transfer_reference,amount_cents,payment_choice,status,confirmed_booking_id,created_at,hold:rdv_booking_holds!inner(practitioner_id,customer_first_name,customer_last_name,customer_email,starts_at,expires_at,status,service_id,terms_version)')
    .eq('hold.practitioner_id',practitionerId).order('created_at',{ascending:false}).limit(100)
  if(error)return {status:500,body:{error:'bank_lookup_failed'}}
  // Afficher les remboursements de virements confirmés mais annulés.
  // Les coordonnées du payeur ne sont pas disponibles : remboursement bancaire manuel, jamais un débit automatique.
  const ids=(data||[]).filter(r=>r.confirmed_booking_id).map(r=>r.confirmed_booking_id)
  let refundsToReview=[]
  if(ids.length){
    const serviceIds=[...new Set((data||[]).filter(r=>r.confirmed_booking_id).map(r=>r.hold.service_id))]
    const [{data:bookings,error:bErr},{data:services,error:sErr},{data:refundLedger,error:lErr}]=await Promise.all([
      supabase.from('bookings').select('id,starts_at,cancelled_at,cancel_reason,status').in('id',ids),
      supabase.from('booking_services').select('id,reservation_payment_cents').in('id',serviceIds),
      supabase.from('rdv_financial_entries').select('booking_id,gross_cents').in('booking_id',ids).eq('direction','refund').eq('payment_method','transfer'),
    ])
    if(bErr||sErr||lErr)return {status:503,body:{error:'bank_refunds_lookup_failed'}}
    const byId=new Map((bookings||[]).map(b=>[b.id,b]))
    const arrhes=new Map((services||[]).map(s=>[s.id,Number(s.reservation_payment_cents||0)]))
    const returned=new Map()
    for(const entry of refundLedger||[])returned.set(entry.booking_id,(returned.get(entry.booking_id)||0)+Number(entry.gross_cents||0))
    refundsToReview=(data||[]).filter(r=>r.confirmed_booking_id).flatMap(r=>{
      const b=byId.get(r.confirmed_booking_id)
      if(!b||b.status!=='cancelled')return []
      const guidance=rdvRefundGuidance({
        termsVersion:r.hold.terms_version,cancelledAt:b.cancelled_at,startsAt:b.starts_at,
        cancelReason:b.cancel_reason,paidCents:r.amount_cents,
        arrhesCents:arrhes.get(r.hold.service_id),
      })
      const alreadyRefunded=returned.get(b.id)||0
      const refundDue=guidance.recommendedRefundCents
      if(refundDue!=null && alreadyRefunded>=refundDue)return []
      return [{
        request_id:r.id,reference:r.transfer_reference,customer_name:[r.hold.customer_first_name,r.hold.customer_last_name].join(' '),
        customer_email:r.hold.customer_email,starts_at:b.starts_at,amount_cents:r.amount_cents,
        already_refunded_cents:alreadyRefunded,
        recommended_refund_cents:refundDue==null?null:Math.max(0,refundDue-alreadyRefunded),
        guidance_code:guidance.code,
      }]
    })
  }
  return {status:200,body:{refunds_to_review:refundsToReview,requests:(data||[]).map(r=>({
    id:r.id,reference:r.transfer_reference,amount_cents:r.amount_cents,payment_choice:r.payment_choice,
    status:r.status==='pending'&&new Date(r.hold.expires_at)<=new Date()?'expired':r.status,
    customer_name:[r.hold.customer_first_name,r.hold.customer_last_name].join(' '),
    customer_email:r.hold.customer_email,starts_at:r.hold.starts_at,expires_at:r.hold.expires_at,
    booking_id:r.confirmed_booking_id,
  }))}}
}
async function finalizeBankBooking(supabase,bookingId,requestId) {
  const {data:booking}=await supabase.from('bookings')
    .select('id,practitioner_id,service_id,customer_first_name,customer_last_name,customer_email,customer_phone,starts_at,ends_at,timezone,google_event_id,booked_price_cents,reservation_payment_cents,modality,video_channel,cancellation_token_hash')
    .eq('id',bookingId).single()
  if(!booking)return {googleSync:'pending',emailStatus:'pending'}
  const [{data:service},{data:practitioner},{data:request}]=await Promise.all([
    supabase.from('booking_services').select('title,modality').eq('id',booking.service_id).single(),
    supabase.from('booking_practitioners').select('name,timezone').eq('id',booking.practitioner_id).single(),
    supabase.from('rdv_bank_booking_requests').select('confirmation_email_sent_at').eq('id',requestId).single(),
  ])
  if(!service)return {googleSync:'pending',emailStatus:'pending'}
  let googleSync={status:'pending'}
  try{ googleSync=await syncBookingToGoogleCalendar({
    supabase,practitionerId:booking.practitioner_id,bookingId:booking.id,currentGoogleEventId:booking.google_event_id,
    event:{
      title:service.title+' — '+booking.customer_first_name+' '+booking.customer_last_name,
      startsAt:booking.starts_at,endsAt:booking.ends_at,
      timezone:practitioner?.timezone||'Europe/Paris',
      description:['MediumIA Rendez-vous','', 'Virement validé par le praticien',
        'Client : '+booking.customer_first_name+' '+booking.customer_last_name,
        'Email : '+booking.customer_email,
        'Identifiant MediumIA : '+booking.id].join('\n'),
    },
  })}catch{}
  if(request?.confirmation_email_sent_at)return {googleSync:googleSync.status,emailStatus:'already_sent'}
  let cancellation=null
  if(!booking.cancellation_token_hash){
    cancellation=createCancellationToken()
    const {error}=await supabase.from('bookings').update({
      cancellation_token_hash:cancellation.tokenHash,cancellation_token_created_at:new Date().toISOString(),
    }).eq('id',booking.id).is('cancellation_token_hash',null)
    if(error)cancellation=null
  }
  const visio=booking.modality==='video' ? 'Visio — '+(booking.video_channel||'canal à confirmer') : null
  const message=buildRdvDepositConfirmation({
    firstName:booking.customer_first_name,serviceTitle:service.title,startsAt:booking.starts_at,
    servicePriceCents:booking.booked_price_cents,depositCents:booking.reservation_payment_cents,
    cancelUrl:cancellation?bookingCancellationUrl(cancellation.token):accountSpaceUrl(),
    timezone:practitioner?.timezone||'Europe/Paris',visio,
    phone:booking.customer_phone,accountUrl:accountSpaceUrl(),
    balanceReminderEnabled:booking.modality==='video'&&booking.reservation_payment_cents<booking.booked_price_cents,
  })
  const sent=await sendEmail({to:booking.customer_email,...message,idempotencyKey:'bank-confirm/'+booking.id})
  if(sent.status==='sent')await supabase.from('rdv_bank_booking_requests').update({
    confirmation_email_sent_at:new Date().toISOString(),
  }).eq('id',requestId).is('confirmation_email_sent_at',null)
  return {googleSync:googleSync.status,emailStatus:sent.status}
}
export async function handleBankBookingAdmin({supabase,userId,method,query,input}) {
  const practitionerId=String(query.practitioner_id||input.practitioner_id||'')
  if(method==='GET')return listBankRequests(supabase,userId,practitionerId)
  if(method!=='POST'||!UUID_RE.test(input.request_id||'')||!['confirm','cancel'].includes(input.op))
    return {status:400,body:{error:'invalid_request'}}
  const rpc=input.op==='confirm'?'confirm_rdv_bank_booking_request':'cancel_rdv_bank_booking_request'
  const {data,error}=await supabase.rpc(rpc,{
    p_actor:userId,p_request_id:input.request_id,
    ...(input.op==='confirm'?{p_received_at:new Date().toISOString()}:{})
  })
  if(error)return {status:503,body:{error:'bank_request_unavailable'}}
  if(!data?.ok)return {status:data?.error==='forbidden'?403:409,body:{error:data?.error||'bank_request_unavailable'}}
  if(input.op==='cancel')return {status:200,body:{ok:true,cancelled:true}}
  const finalized=await finalizeBankBooking(supabase,data.booking_id,input.request_id)
  return {status:200,body:{ok:true,booking_id:data.booking_id,already_confirmed:!!data.already_confirmed,...finalized}}
}
