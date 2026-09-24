import { useEffect, useMemo, useRef, useState } from 'react'
import LegalFooter from './LegalFooter'

const API = '/api/rdv-config?giftCardAction='
const PAY_LATER_MIN_CENTS = 3000

const money = (cents) => `${(Number(cents || 0) / 100).toFixed(2).replace('.', ',')} €`
const todayStr = () => new Date().toISOString().slice(0, 10)
const longDate = (iso) => new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' }).format(new Date(iso))

const KINDS = [
  ['amount', 'Montant libre', 'À utiliser pour la consultation de son choix.'],
  ['consultation', 'Une consultation', 'Une séance précise, offerte.'],
  ['chronosphere', 'ChronoSphère', 'Des lectures personnalisées de son cycle.'],
  ['coffret', 'Coffret', 'Une consultation + un pack ChronoSphère.'],
]

function Header({ onBack }) {
  return (
    <header className="cosmic-page__header sticky top-0 z-50 border-b border-gold/20 bg-cream/95 backdrop-blur-sm print:hidden">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <button onClick={onBack} className="font-georgia text-sm font-semibold tracking-[0.18em] text-deep">✦ MEDIUMIA</button>
        <button onClick={onBack} className="font-georgia text-xs text-mist hover:text-deep">← Accueil</button>
      </div>
    </header>
  )
}

function loadPayPal(clientId) {
  return new Promise((resolve, reject) => {
    if (window.paypal) return resolve(window.paypal)
    const script = document.createElement('script')
    script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=EUR&intent=capture&components=buttons&enable-funding=paylater`
    script.async = true
    script.onload = () => resolve(window.paypal)
    script.onerror = () => reject(new Error('paypal_sdk_failed'))
    document.head.appendChild(script)
  })
}

export function giftPrice(catalog, choice) {
  if (!catalog) return 0
  if (choice.kind === 'amount') return Number(choice.amountCents) || 0
  if (choice.kind === 'chronosphere') return catalog.chronosphere.find((p) => p.id === choice.chronosphereProduct)?.cents || 0
  const service = catalog.services.find((s) => s.id === choice.serviceId)
  if (!service) return 0
  return choice.kind === 'coffret' ? service.priceCents + catalog.coffretExtraCents : service.priceCents
}

function Purchase() {
  const [catalog, setCatalog] = useState(null)
  const [choice, setChoice] = useState({ kind: 'amount', amountCents: 5000, serviceId: '', chronosphereProduct: 'pack3' })
  const [form, setForm] = useState({ recipientName: '', message: '', delivery: 'me', recipientEmail: '', sendOn: todayStr(), buyerName: '', buyerEmail: '' })
  const [terms, setTerms] = useState(false)
  const [notice, setNotice] = useState('')
  const [done, setDone] = useState(null)
  const buttonsRef = useRef(null)
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  useEffect(() => {
    fetch(`${API}catalog`).then((r) => (r.ok ? r.json() : null)).then((data) => {
      if (!data) return setCatalog({ open: false, services: [], chronosphere: [], amounts: [] })
      setCatalog(data)
      if (data.services?.[0]) setChoice((c) => ({ ...c, serviceId: c.serviceId || data.services[0].id }))
    }).catch(() => setCatalog({ open: false, services: [], chronosphere: [], amounts: [] }))
  }, [])

  const price = giftPrice(catalog, choice)
  const payload = useMemo(() => ({
    ...choice,
    buyerName: form.buyerName, buyerEmail: form.buyerEmail, recipientName: form.recipientName, message: form.message,
    recipientEmail: form.delivery === 'recipient' ? form.recipientEmail : '',
    sendOn: form.delivery === 'recipient' && form.sendOn > todayStr() ? form.sendOn : null,
    termsAccepted: terms,
  }), [choice, form, terms])
  const ready = terms && form.buyerName.trim() && form.buyerEmail.includes('@') && form.recipientName.trim()
    && (form.delivery === 'me' || form.recipientEmail.includes('@')) && price > 0

  useEffect(() => {
    if (!catalog?.open || !ready || !buttonsRef.current) return undefined
    let disposed = false
    const container = buttonsRef.current
    loadPayPal(catalog.clientId).then((paypal) => {
      if (disposed || !paypal) return
      container.innerHTML = ''
      paypal.Buttons({
        style: { layout: 'vertical', shape: 'rect', label: 'paypal' },
        createOrder: async () => {
          setNotice('')
          const res = await fetch(`${API}create`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
          const data = await res.json().catch(() => ({}))
          if (!res.ok) throw new Error(data.error === 'validation_failed' ? 'Vérifiez les informations saisies.' : 'Le paiement ne peut pas être préparé pour le moment.')
          return data.id
        },
        onApprove: async (data) => {
          const res = await fetch(`${API}capture`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId: data.orderID }) })
          const result = await res.json().catch(() => ({}))
          if (result.status === 'COMPLETED') setDone(result)
          else setNotice('Le paiement n’a pas pu être confirmé. Ne repayez pas : écrivez-nous à contact@mediumia.fr.')
        },
        onError: (err) => setNotice(err?.message || 'Le paiement a échoué. Réessayez.'),
      }).render(container)
    }).catch(() => setNotice('Le paiement sécurisé est momentanément indisponible.'))
    return () => { disposed = true; container.innerHTML = '' }
  }, [catalog, ready, payload])

  if (done) {
    return (
      <div role="status" className="mx-auto max-w-lg rounded-3xl border border-gold/30 bg-white/80 p-8 text-center">
        <p className="text-4xl text-gold" aria-hidden="true">✦</p>
        <h2 className="mt-3 font-georgia text-2xl text-deep">Merci ! Votre carte cadeau est prête.</h2>
        <p className="mt-3 font-georgia text-sm leading-relaxed text-mist">Vous la recevez par e-mail{form.delivery === 'recipient' ? ', et elle sera envoyée à la personne à la date choisie' : ''}.</p>
        {done.viewToken && <a href={`/carte-cadeau/${done.viewToken}`} className="mt-6 inline-block rounded-xl bg-deep px-6 py-3 font-georgia text-sm font-bold text-gold">Voir et imprimer la carte</a>}
      </div>
    )
  }

  const input = 'w-full rounded-xl border border-gold/30 bg-white px-4 py-3 font-georgia text-sm text-deep placeholder:text-mist/50 focus:border-gold/70 focus:outline-none'
  const label = 'mb-1.5 block font-georgia text-xs uppercase tracking-[0.12em] text-mist'
  const chip = (active) => `rounded-xl border px-4 py-3 text-left font-georgia text-sm transition-colors ${active ? 'border-deep bg-deep text-gold' : 'border-gold/30 bg-white text-deep hover:bg-gold/10'}`

  return (
    <div className="grid gap-8 md:grid-cols-[1.2fr_.8fr]">
      <div className="space-y-7">
        <section>
          <h2 className="mb-3 font-georgia text-xl text-deep">1. Que souhaitez-vous offrir ?</h2>
          <div className="grid grid-cols-2 gap-3">
            {KINDS.map(([kind, title, detail]) => (
              <button key={kind} type="button" aria-pressed={choice.kind === kind} onClick={() => setChoice((c) => ({ ...c, kind }))} className={chip(choice.kind === kind)}>
                <strong className="block">{choice.kind === kind ? '✓ ' : ''}{title}</strong>
                <span className={`mt-1 block text-xs ${choice.kind === kind ? 'text-cream/75' : 'text-mist'}`}>{detail}</span>
              </button>
            ))}
          </div>
          <div className="mt-4">
            {choice.kind === 'amount' && (
              <div className="flex flex-wrap gap-2">
                {(catalog?.amounts || []).map((cents) => (
                  <button key={cents} type="button" aria-pressed={choice.amountCents === cents} onClick={() => setChoice((c) => ({ ...c, amountCents: cents }))} className={`rounded-full border px-4 py-2 font-georgia text-sm ${choice.amountCents === cents ? 'border-deep bg-deep text-gold' : 'border-gold/30 bg-white text-deep'}`}>{money(cents)}</button>
                ))}
              </div>
            )}
            {(choice.kind === 'consultation' || choice.kind === 'coffret') && (
              <select aria-label="Consultation offerte" value={choice.serviceId} onChange={(e) => setChoice((c) => ({ ...c, serviceId: e.target.value }))} className={input}>
                {(catalog?.services || []).map((s) => <option key={s.id} value={s.id}>{s.title} — {money(s.priceCents)}{choice.kind === 'coffret' ? ` + ChronoSphère (${money(catalog.coffretExtraCents)})` : ''}</option>)}
              </select>
            )}
            {choice.kind === 'chronosphere' && (
              <div className="flex flex-wrap gap-2">
                {(catalog?.chronosphere || []).map((p) => (
                  <button key={p.id} type="button" aria-pressed={choice.chronosphereProduct === p.id} onClick={() => setChoice((c) => ({ ...c, chronosphereProduct: p.id }))} className={`rounded-full border px-4 py-2 font-georgia text-sm ${choice.chronosphereProduct === p.id ? 'border-deep bg-deep text-gold' : 'border-gold/30 bg-white text-deep'}`}>{p.label} · {money(p.cents)}</button>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="font-georgia text-xl text-deep">2. Pour qui ?</h2>
          <div>
            <label htmlFor="gift-recipient" className={label}>Prénom de la personne</label>
            <input id="gift-recipient" maxLength={80} value={form.recipientName} onChange={(e) => set('recipientName', e.target.value)} className={input} placeholder="Claire" />
          </div>
          <div>
            <label htmlFor="gift-message" className={label}>Votre message (facultatif)</label>
            <textarea id="gift-message" rows={3} maxLength={400} value={form.message} onChange={(e) => set('message', e.target.value)} className={input} placeholder="Joyeux Noël ! Un moment rien que pour toi…" />
          </div>
          <fieldset className="space-y-2">
            <legend className={label}>Envoi</legend>
            <label className="flex items-start gap-3 font-georgia text-sm text-deep"><input type="radio" name="gift-delivery" checked={form.delivery === 'me'} onChange={() => set('delivery', 'me')} className="mt-1" />Je reçois la carte et je l’offre moi-même (à imprimer ou à transférer)</label>
            <label className="flex items-start gap-3 font-georgia text-sm text-deep"><input type="radio" name="gift-delivery" checked={form.delivery === 'recipient'} onChange={() => set('delivery', 'recipient')} className="mt-1" />L’envoyer aussi par e-mail à la personne, à la date de mon choix</label>
          </fieldset>
          {form.delivery === 'recipient' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="gift-recipient-email" className={label}>Son e-mail</label>
                <input id="gift-recipient-email" type="email" inputMode="email" value={form.recipientEmail} onChange={(e) => set('recipientEmail', e.target.value)} className={input} placeholder="claire@exemple.fr" />
              </div>
              <div>
                <label htmlFor="gift-send-on" className={label}>Date d’envoi</label>
                <input id="gift-send-on" type="date" min={todayStr()} value={form.sendOn} onChange={(e) => set('sendOn', e.target.value)} className={input} />
              </div>
            </div>
          )}
        </section>

        <section className="space-y-4">
          <h2 className="font-georgia text-xl text-deep">3. Vos coordonnées</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="gift-buyer-name" className={label}>Votre prénom</label>
              <input id="gift-buyer-name" autoComplete="given-name" maxLength={80} value={form.buyerName} onChange={(e) => set('buyerName', e.target.value)} className={input} />
            </div>
            <div>
              <label htmlFor="gift-buyer-email" className={label}>Votre e-mail</label>
              <input id="gift-buyer-email" type="email" autoComplete="email" inputMode="email" value={form.buyerEmail} onChange={(e) => set('buyerEmail', e.target.value)} className={input} />
            </div>
          </div>
        </section>
      </div>

      <aside className="h-fit space-y-4 rounded-3xl border border-gold/30 bg-white/80 p-6 md:sticky md:top-24">
        <p className="font-georgia text-[11px] uppercase tracking-[0.18em] text-gold">Votre carte cadeau</p>
        <p className="font-georgia text-3xl text-deep">{price ? money(price) : '—'}</p>
        <p className="font-georgia text-xs leading-relaxed text-mist">Valable {catalog?.validityMonths || 12} mois. Utilisable en une ou plusieurs fois pour les consultations ; ChronoSphère s’active avec le code.</p>
        <label className="flex items-start gap-3 font-georgia text-xs leading-relaxed text-deep/80">
          <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0" />
          <span>J’accepte les conditions : carte valable 12 mois à compter de l’achat, non remboursable une fois utilisée, non échangeable contre de l’argent. Droit de rétractation de 14 jours tant que la carte n’a pas été utilisée (contact@mediumia.fr).</span>
        </label>
        {notice && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 font-georgia text-xs text-red-800">{notice}</p>}
        {catalog && !catalog.open && <p className="rounded-xl border border-gold/30 bg-gold/10 px-3 py-3 font-georgia text-sm text-deep">Les cartes cadeaux arrivent très bientôt.</p>}
        {catalog?.open && !ready && <p className="font-georgia text-xs text-mist">Complétez les étapes et cochez les conditions pour afficher le paiement : <strong className="text-deep">carte bancaire</strong> (sans compte PayPal) ou <strong className="text-deep">PayPal</strong>{price >= PAY_LATER_MIN_CENTS ? ', en une fois ou en 4 fois' : ''}.</p>}
        {catalog?.open && ready && <div ref={buttonsRef} className="min-h-[48px]" />}
        {catalog?.env === 'sandbox' && <p className="font-georgia text-[10px] text-mist">Mode test : montant fictif de 1,00 €.</p>}
      </aside>
    </div>
  )
}

function CardView({ token }) {
  const [state, setState] = useState({ loading: true, card: null })
  useEffect(() => {
    fetch(`${API}view&token=${encodeURIComponent(token)}`).then((r) => (r.ok ? r.json() : null))
      .then((data) => setState({ loading: false, card: data?.card || null }))
      .catch(() => setState({ loading: false, card: null }))
  }, [token])
  if (state.loading) return <p className="font-georgia text-sm text-mist">Chargement de la carte…</p>
  if (!state.card) return <p className="font-georgia text-sm text-mist">Cette carte cadeau est introuvable.</p>
  const card = state.card
  return (
    <div>
      <div className="mx-auto max-w-xl overflow-hidden rounded-3xl bg-deep text-cream shadow-2xl print:shadow-none" style={{ backgroundImage: "linear-gradient(160deg, rgba(20,16,41,.86), rgba(20,16,41,.97)), url('/images/home/mediumia-cosmic-library-hero.webp')", backgroundSize: 'cover', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
        <div className="p-8 md:p-10">
          <img src="/images/brand/MEDIUMIA_logo_officiel_or_champagne_2026-09-12.png" alt="MediumIA" className="h-16 w-auto" />
          <p className="mt-6 font-georgia text-[11px] uppercase tracking-[0.28em] text-gold">Carte cadeau</p>
          <h1 className="mt-2 font-georgia text-3xl leading-tight">{card.label}</h1>
          <p className="mt-4 font-georgia text-lg">Pour {card.recipientName}<span className="text-cream/70"> · de la part de {card.buyerName}</span></p>
          {card.message && <p className="mt-4 font-georgia italic text-cream/85">« {card.message} »</p>}
          <p className="mt-8 font-georgia text-[11px] uppercase tracking-[0.2em] text-cream/60">Votre code</p>
          <p className="whitespace-nowrap font-georgia text-2xl tracking-[0.12em] text-gold sm:text-3xl sm:tracking-[0.18em]">{card.code}</p>
          <p className="mt-2 font-georgia text-xs text-cream/70">Valable jusqu’au {longDate(card.expiresAt)}</p>
          <ul className="mt-6 space-y-2 font-georgia text-sm leading-relaxed text-cream/85">
            {card.usage.map((line) => <li key={line}>✦ {line}</li>)}
          </ul>
        </div>
      </div>
      <div className="mt-6 text-center print:hidden">
        <button type="button" onClick={() => window.print()} className="rounded-xl bg-deep px-6 py-3 font-georgia text-sm font-bold text-gold">Imprimer la carte</button>
        {card.consultationCreditCents > 0 && <p className="mt-3 font-georgia text-xs text-mist">Solde disponible pour les consultations : {money(card.balanceCents)}</p>}
      </div>
    </div>
  )
}

export default function GiftCardsPage({ onBack, onNavigate }) {
  const viewToken = window.location.pathname.startsWith('/carte-cadeau/') ? window.location.pathname.split('/')[2] : null
  return (
    <div className="cosmic-page cosmic-page--network min-h-screen bg-cream text-deep">
      {/* Floating account / guardian buttons must not print on the card. */}
      <style>{'@media print { .guardian-fab, button[aria-label$="MediumIA"] { display: none !important } }'}</style>
      <Header onBack={onBack} />
      <main className="mx-auto max-w-5xl px-6 pb-24 pt-10">
        {viewToken ? <CardView token={viewToken} /> : (
          <>
            <p className="font-georgia text-[11px] uppercase tracking-[0.2em] text-gold">Cartes cadeaux</p>
            <h1 className="mt-2 mb-3 font-georgia text-3xl font-medium leading-tight md:text-5xl">Offrir un moment de clarté.</h1>
            <p className="mb-10 max-w-2xl font-georgia text-mist">Une consultation, un montant à utiliser librement, une lecture ChronoSphère ou un coffret : la personne reçoit une belle carte avec son code, valable 12 mois.</p>
            <Purchase />
          </>
        )}
      </main>
      <div className="print:hidden"><LegalFooter onNavigate={onNavigate} /></div>
    </div>
  )
}
