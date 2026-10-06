import { useEffect, useRef, useState } from 'react'
import LegalFooter from './LegalFooter'
import SiteNav from './SiteNav'
import { trackMediumiaMetric } from '../lib/mediumiaMetrics.js'

const PACK_META = {
  q1: { count: 1, title: 'Une question', blurb: 'Une question précise, un seul sujet.' },
  q2: { count: 2, title: 'Deux questions', blurb: 'Deux questions autour d’un même thème.' },
}

function loadPayPalSdk(clientId) {
  if (window.paypal?.Buttons) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const existing = document.getElementById('mediumia-paypal-sdk')
    if (existing) {
      existing.addEventListener('load', resolve, { once: true })
      existing.addEventListener('error', () => reject(new Error('paypal_sdk_load_failed')), { once: true })
      return
    }
    const script = document.createElement('script')
    script.id = 'mediumia-paypal-sdk'
    script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=EUR&intent=capture&components=buttons`
    script.onload = resolve
    script.onerror = () => reject(new Error('paypal_sdk_load_failed'))
    document.head.appendChild(script)
  })
}

const euro = (cents) => `${(cents / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`

function QuestionCheckout({ config }) {
  const [pack, setPack] = useState('q1')
  const [firstName, setFirstName] = useState('')
  const [email, setEmail] = useState('')
  const [birthDate, setBirthDate] = useState('')
  const [questions, setQuestions] = useState(['', ''])
  const [contexts, setContexts] = useState(['', ''])
  const [waived, setWaived] = useState(false)
  const [rulesOk, setRulesOk] = useState(false)
  const [status, setStatus] = useState('')
  const [success, setSuccess] = useState(null)
  const containerRef = useRef(null)
  const payloadRef = useRef(null)

  const packs = Object.fromEntries((config.packs || []).map((p) => [p.id, p]))
  const count = PACK_META[pack].count
  const price = packs[pack]?.amountCents ?? (pack === 'q2' ? 2990 : 1990)

  const activeQuestions = questions.slice(0, count)
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  const questionsOk = activeQuestions.every((q) => q.trim().length >= 10)
  const formValid = firstName.trim().length >= 1 && emailOk && questionsOk && waived && rulesOk

  payloadRef.current = {
    pack,
    firstName: firstName.trim(),
    email: email.trim().toLowerCase(),
    birthDate: birthDate || undefined,
    questions: activeQuestions.map((q, i) => ({ q: q.trim(), context: (contexts[i] || '').trim() })),
    retractationWaived: true,
    rulesAccepted: true,
  }

  useEffect(() => { trackMediumiaMetric('question_view', 'question') }, [])

  useEffect(() => {
    if (!formValid || success) return
    let cancelled = false
    const node = containerRef.current
    if (!node) return
    node.innerHTML = ''

    loadPayPalSdk(config.clientId)
      .then(() => {
        if (cancelled || !window.paypal?.Buttons) return
        return window.paypal.Buttons({
          createOrder: async () => {
            setStatus('Création sécurisée de la commande…')
            trackMediumiaMetric('question_payment_started', `question:${payloadRef.current.pack}`)
            const res = await fetch('/api/rdv-config?questionAction=create', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payloadRef.current),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok || !data.id) {
              if (data.error === 'daily_capacity_reached') throw new Error('capacity')
              throw new Error(data.error || 'paypal_create_order_failed')
            }
            return data.id
          },
          onApprove: async (data) => {
            setStatus('Paiement confirmé. Enregistrement de votre demande…')
            const res = await fetch('/api/rdv-config?questionAction=capture', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ orderId: data.orderID }),
            })
            const result = await res.json().catch(() => ({}))
            if (!res.ok || !result.ok) throw new Error(result.error || 'question_record_failed')
            trackMediumiaMetric('question_purchase_completed', `question:${payloadRef.current.pack}`)
            setSuccess({ dueAt: result.due_at })
            node.innerHTML = ''
          },
          onCancel: () => setStatus('Paiement annulé. Aucune somme n’a été débitée.'),
          onError: (error) => setStatus(error?.message === 'capacity'
            ? 'Le quota de demandes disponible pour le moment est atteint.'
            : 'Le paiement n’a pas pu aboutir. Vous pouvez réessayer sans être débité deux fois.'),
        }).render(node)
      })
      .catch((error) => setStatus(error?.message === 'capacity'
        ? 'Le quota de demandes disponible pour le moment est atteint.'
        : 'PayPal est momentanément indisponible. Réessayez dans quelques instants.'))

    return () => {
      cancelled = true
      if (node) node.innerHTML = ''
    }
  }, [formValid, success, config.clientId, pack])

  if (success) {
    const due = success.dueAt
      ? new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full', timeZone: 'Europe/Paris' }).format(new Date(success.dueAt))
      : null
    return (
      <div className="rounded-3xl border-2 border-gold/30 bg-white/80 p-7 text-center md:p-10">
        <p className="font-georgia text-[11px] uppercase tracking-[0.2em] text-gold">Demande enregistrée</p>
        <h2 className="mt-3 font-georgia text-2xl font-medium text-deep md:text-3xl">C’est noté ✦</h2>
        <p className="mx-auto mt-4 max-w-lg font-georgia leading-relaxed text-mist">
          Je prends personnellement connaissance de votre demande et je vous transmets une réponse personnelle et développée par e-mail{due ? `, au plus tard le ${due}` : ' sous 72 heures ouvrées'}. Un e-mail de confirmation vient de vous être envoyé.
        </p>
        <p className="mt-4 font-georgia text-sm text-mist">Vous n’avez rien d’autre à faire : la réponse arrivera directement dans votre boîte e-mail.</p>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div className="grid gap-4 sm:grid-cols-2">
        {['q1', 'q2'].map((id) => {
          const active = pack === id
          const cents = packs[id]?.amountCents ?? (id === 'q2' ? 2990 : 1990)
          return (
            <button
              key={id}
              type="button"
              onClick={() => setPack(id)}
              className={`rounded-3xl border-2 p-6 text-left transition-colors ${active ? 'border-gold bg-gold/10' : 'border-gold/25 bg-white/70 hover:border-gold/60'}`}
            >
              <div className="flex items-baseline justify-between gap-3">
                <p className="font-georgia text-lg font-medium text-deep">{PACK_META[id].title}</p>
                <p className="font-georgia text-xl font-bold text-deep">{euro(cents)}</p>
              </div>
              <p className="mt-2 font-georgia text-sm leading-relaxed text-mist">{PACK_META[id].blurb}</p>
              {id === 'q2' && <p className="mt-3 font-georgia text-xs font-semibold text-gold">La formule la plus avantageuse</p>}
            </button>
          )
        })}
      </div>

      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="q-first" className="mb-1.5 block font-georgia text-xs uppercase tracking-[0.15em] text-mist">Votre prénom</label>
            <input id="q-first" type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} maxLength={80} className="w-full rounded-lg border-2 border-gold/25 bg-white px-4 py-3 font-georgia text-sm text-deep focus:border-gold/60 focus:outline-none" />
          </div>
          <div>
            <label htmlFor="q-email" className="mb-1.5 block font-georgia text-xs uppercase tracking-[0.15em] text-mist">Votre e-mail</label>
            <input id="q-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="votre@email.com" className="w-full rounded-lg border-2 border-gold/25 bg-white px-4 py-3 font-georgia text-sm text-deep focus:border-gold/60 focus:outline-none" />
          </div>
        </div>

        <div>
          <label htmlFor="q-dob" className="mb-1.5 block font-georgia text-xs uppercase tracking-[0.15em] text-mist">Votre date de naissance <span className="normal-case tracking-normal text-mist/70">(facultatif)</span></label>
          <input id="q-dob" type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} className="w-full rounded-lg border-2 border-gold/25 bg-white px-4 py-3 font-georgia text-sm text-deep focus:border-gold/60 focus:outline-none sm:w-auto" />
        </div>

        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="rounded-2xl border border-gold/20 bg-cream/50 p-4">
            <label htmlFor={`q-text-${i}`} className="mb-1.5 block font-georgia text-xs uppercase tracking-[0.15em] text-gold">{count > 1 ? `Question ${i + 1}` : 'Votre question'}</label>
            <textarea
              id={`q-text-${i}`}
              value={questions[i]}
              onChange={(e) => setQuestions((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))}
              rows={3}
              maxLength={1000}
              placeholder="Formulez une question précise, sur un sujet identifiable."
              className="w-full resize-y rounded-lg border-2 border-gold/25 bg-white px-4 py-3 font-georgia text-sm text-deep focus:border-gold/60 focus:outline-none"
            />
            <label htmlFor={`q-ctx-${i}`} className="mt-3 mb-1.5 block font-georgia text-[11px] uppercase tracking-[0.12em] text-mist">Contexte <span className="normal-case tracking-normal text-mist/70">(facultatif, quelques lignes)</span></label>
            <textarea
              id={`q-ctx-${i}`}
              value={contexts[i]}
              onChange={(e) => setContexts((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))}
              rows={2}
              maxLength={2000}
              className="w-full resize-y rounded-lg border-2 border-gold/20 bg-white px-4 py-3 font-georgia text-sm text-deep focus:border-gold/60 focus:outline-none"
            />
          </div>
        ))}

        <div className="rounded-2xl border border-gold/20 bg-white/60 p-4 font-georgia text-xs leading-relaxed text-mist">
          <p className="mb-2">Une question = un sujet identifiable. Je vous réponds personnellement ; il ne s’agit pas d’une conversation illimitée. Aucune question d’ordre médical n’est acceptée : diagnostic, traitement, pronostic, symptômes, grossesse, urgence ou décision de santé. La réponse est une guidance ; elle ne remplace jamais un avis juridique ou financier et ne garantit pas de contact avec un défunt. Toute demande médicale sera refusée et remboursée. N’indiquez aucune donnée de santé dans votre question ou dans le contexte.</p>
          <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-xl border border-gold/20 bg-cream/60 p-3">
            <input type="checkbox" checked={rulesOk} onChange={(e) => setRulesOk(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#C9A84C]" />
            <span className="text-sm text-deep">J’ai lu et j’accepte les règles de cette prestation, notamment l’interdiction de toute question d’ordre médical, ainsi que la <a href="/confidentialite" className="text-gold hover:underline">politique de confidentialité</a>.</span>
          </label>
          <label className="mt-2 flex cursor-pointer items-start gap-3 rounded-xl border border-gold/20 bg-cream/60 p-3">
            <input type="checkbox" checked={waived} onChange={(e) => setWaived(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#C9A84C]" />
            <span className="text-sm text-deep">Je demande que la prestation commence avant la fin du délai de rétractation et reconnais qu’une fois la prestation pleinement exécutée, je ne pourrai plus exercer ce droit.</span>
          </label>
        </div>

        {formValid ? (
          <div ref={containerRef} className="min-h-[52px]" />
        ) : (
          <p className="rounded-xl border border-gold/20 bg-cream/50 px-4 py-3 text-center font-georgia text-sm text-mist">
            Renseignez votre prénom, votre e-mail, {count > 1 ? 'vos deux questions' : 'votre question'} et cochez les deux cases pour accéder au paiement ({euro(price)}).
          </p>
        )}
        {status && <p role="status" className="text-center font-georgia text-sm text-deep">{status}</p>}
      </div>
    </div>
  )
}

export default function QuestionPage({ onBack, onNavigate }) {
  const [availability, setAvailability] = useState('loading')
  const [config, setConfig] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/rdv-config?questionAction=config', { cache: 'no-store' })
      .then((res) => res.json().catch(() => ({})))
      .then((data) => {
        if (cancelled) return
        if (!data?.enabled || !data.clientId) {
          setConfig(data || null)
          setAvailability('disabled')
          return
        }
        setConfig(data)
        setAvailability('ready')
      })
      .catch(() => { if (!cancelled) setAvailability('error') })
    return () => { cancelled = true }
  }, [])

  return (
    <div className="cosmic-page cosmic-page--network min-h-screen bg-cream text-deep">
      <SiteNav current="consulter" onHome={onBack} />
      <main className="mx-auto max-w-3xl px-5 pb-20 pt-28 md:pt-32">
        <p className="font-georgia text-[11px] uppercase tracking-[0.22em] text-gold">Nouveau · sans rendez-vous</p>
        <h1 className="mt-2 font-georgia text-3xl font-medium leading-tight md:text-5xl">Guidance par e-mail</h1>
        <p className="mt-4 max-w-xl font-georgia text-base leading-relaxed text-mist">
          Vous posez une ou deux questions précises. Je prends personnellement connaissance de votre demande et je vous transmets <strong className="text-deep">une guidance personnelle et développée</strong> par e-mail — pas un simple oui ou non, un véritable éclairage.
        </p>

        <ul className="mt-6 grid gap-2 font-georgia text-sm text-deep/80 sm:grid-cols-3">
          <li className="rounded-xl border border-gold/20 bg-white/60 px-4 py-3">Réponse écrite personnellement par moi</li>
          <li className="rounded-xl border border-gold/20 bg-white/60 px-4 py-3">Sous 72 h ouvrées</li>
          <li className="rounded-xl border border-gold/20 bg-white/60 px-4 py-3">Aucun rendez-vous à prévoir</li>
        </ul>

        <div className="mt-10">
          {availability === 'loading' && <p className="font-georgia text-sm text-mist">Chargement…</p>}
          {availability === 'disabled' && (
            <div className="rounded-2xl border border-gold/25 bg-white/70 p-6 text-center font-georgia text-sm text-mist">
              {config?.remaining === 0 ? 'Le quota de demandes disponible pour le moment est atteint.' : 'Ce service sera bientôt disponible.'}
              {' '}Vous pouvez <a href="/rdv/sebastien-seguin" className="text-gold hover:underline">réserver une guidance avec moi</a>.
            </div>
          )}
          {availability === 'error' && <p className="font-georgia text-sm text-mist">Service momentanément indisponible. Réessayez dans un instant.</p>}
          {availability === 'ready' && config && <QuestionCheckout config={config} />}
        </div>

        <p className="mt-10 font-georgia text-xs leading-relaxed text-mist/80">
          La prestation comprend la réponse à la ou aux questions commandées. Toute nouvelle question constitue une nouvelle demande. Si votre demande dépasse ce cadre, je pourrai vous orienter vers une guidance complète ou procéder à un remboursement.
        </p>
      </main>
      <LegalFooter onNavigate={onNavigate} />
    </div>
  )
}
