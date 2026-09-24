import { useEffect, useRef, useState } from 'react'
import LegalFooter from './LegalFooter'
import { useAuth } from '../lib/useAuth.js'

const API = '/api/rdv-config?reviewsAction='

export const OFFERING_LABELS = {
  consultation: 'Consultation',
  oracle: 'Oracle',
  chronosphere: 'ChronoSphère',
  formation: 'Formation',
  conference: 'Conférence',
  autre: 'Autre',
}

const REJECTION_LABELS = {
  insulting: 'Propos injurieux ou diffamatoires',
  personal_data: 'Données personnelles d’un tiers',
  off_topic: 'Sans rapport avec MediumIA',
  not_a_customer: 'Expérience non vérifiable',
  duplicate: 'Doublon',
  requested_by_author: 'Retrait demandé par l’auteur',
}

function monthLabel(value) {
  if (!value) return null
  const date = new Date(`${value}-01T12:00:00`)
  return Number.isNaN(date.getTime()) ? null : new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(date)
}

function dayLabel(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).format(date)
}

function Stars({ value, size = 'text-base' }) {
  return (
    <span className={`${size} tracking-[0.12em] text-gold`} role="img" aria-label={`${value} sur 5`}>
      {'★'.repeat(value)}<span className="text-gold/25">{'★'.repeat(5 - value)}</span>
    </span>
  )
}

export function ReviewCard({ review }) {
  const experience = monthLabel(review.experience_month)
  return (
    <article className="rounded-2xl border border-gold/25 bg-white/75 p-5 shadow-[0_8px_24px_rgba(26,21,53,.04)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Stars value={review.rating} />
        <span className="rounded-full border border-gold/25 px-2.5 py-0.5 font-georgia text-[10px] uppercase tracking-[0.14em] text-mist">
          {OFFERING_LABELS[review.offering] || 'MediumIA'}
        </span>
      </div>
      <p className="mt-3 whitespace-pre-line font-georgia text-sm leading-relaxed text-deep/85">{review.body}</p>
      <p className="mt-4 font-georgia text-xs text-mist">
        <strong className="text-deep">{review.display_name}</strong>
        {' · '}avis du {dayLabel(review.created_at)}
        {experience && <> · expérience de {experience}</>}
      </p>
    </article>
  )
}

export function useApprovedReviews() {
  const [state, setState] = useState({ loading: true, available: false, reviews: [] })
  useEffect(() => {
    let active = true
    fetch(`${API}list`)
      .then((r) => (r.ok ? r.json() : { available: false, reviews: [] }))
      .then((data) => { if (active) setState({ loading: false, available: Boolean(data.available), reviews: Array.isArray(data.reviews) ? data.reviews : [] }) })
      .catch(() => { if (active) setState({ loading: false, available: false, reviews: [] }) })
    return () => { active = false }
  }, [])
  return state
}

// Google reviews of the MediumIA profile (Places API, cached 6 h server-side).
// Without the API key the block still offers the two Google links.
const GOOGLE_LINKS = { mapsUrl: 'https://g.page/r/CbFv2pHpBKtYEBM', writeUrl: 'https://g.page/r/CbFv2pHpBKtYEBM/review' }

export function useGoogleReviews() {
  const [state, setState] = useState({ loading: true, available: false, ...GOOGLE_LINKS, reviews: [] })
  useEffect(() => {
    let active = true
    fetch(`${API}google`)
      .then((r) => (r.ok ? r.json() : {}))
      .then((data) => { if (active) setState({ loading: false, ...GOOGLE_LINKS, reviews: [], ...data }) })
      .catch(() => { if (active) setState((s) => ({ ...s, loading: false })) })
    return () => { active = false }
  }, [])
  return state
}

function GoogleReviewCard({ review }) {
  return (
    <article className="rounded-2xl border border-gold/25 bg-white/80 p-5 shadow-[0_8px_24px_rgba(26,21,53,.04)]">
      <div className="flex items-center justify-between gap-2">
        {review.rating ? <Stars value={Math.round(review.rating)} /> : <span />}
        <span className="font-georgia text-[10px] uppercase tracking-[0.14em] text-mist">Avis Google</span>
      </div>
      <p className="mt-3 line-clamp-6 whitespace-pre-line font-georgia text-sm leading-relaxed text-deep/85">{review.text}</p>
      <p className="mt-4 font-georgia text-xs text-mist">
        {review.authorUrl
          ? <a href={review.authorUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-deep hover:underline">{review.author}</a>
          : <strong className="text-deep">{review.author}</strong>}
        {review.when && <> · {review.when}</>}
      </p>
    </article>
  )
}

export function GoogleReviewsBlock({ max = 3, columns = 'md:grid-cols-3' }) {
  const google = useGoogleReviews()
  if (google.loading) return null
  const hasReviews = google.available && google.count > 0
  return (
    <div className="mb-8">
      {hasReviews && (
        <>
          <p className="mb-5 text-center font-georgia text-sm text-mist">
            <Stars value={Math.round(google.rating || 0)} />{' '}
            <strong className="text-deep">{String(google.rating?.toFixed?.(1) || '').replace('.', ',')} / 5</strong> · {google.count} avis sur Google
          </p>
          <div className={`grid gap-4 ${columns}`}>
            {google.reviews.slice(0, max).map((review, i) => <GoogleReviewCard key={`${review.author}-${i}`} review={review} />)}
          </div>
        </>
      )}
      <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <a href={google.mapsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-full border border-gold/45 bg-white/80 px-6 py-3 font-georgia text-sm font-bold text-deep hover:bg-white">
          {hasReviews ? 'Voir tous les avis sur Google' : 'Voir nos avis sur Google'} <span aria-hidden="true">→</span>
        </a>
        <a href={google.writeUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-full bg-deep px-6 py-3 font-georgia text-sm font-bold text-gold hover:opacity-90">
          Laisser un avis sur Google
        </a>
      </div>
    </div>
  )
}

// Home block: Google reviews first (what visitors trust most), then the
// reviews collected on the site, or an invitation to leave one.
export function ReviewsHighlight() {
  const { loading, reviews } = useApprovedReviews()
  if (loading) return null
  return (
    <section id="avis" className="px-6 py-14 max-w-6xl mx-auto">
      <div className="text-center max-w-2xl mx-auto mb-8">
        <p className="font-georgia text-gold tracking-[0.24em] text-xs uppercase mb-3">Avis clients</p>
        <h2 className="font-georgia font-medium text-3xl md:text-4xl leading-tight text-deep">
          Ils ont vécu l’expérience MediumIA.
        </h2>
        {!reviews.length && (
          <p className="mt-4 font-georgia text-mist leading-relaxed">
            Vous avez consulté, suivi la formation ou utilisé l’Oracle ou ChronoSphère ? Votre avis aide d’autres personnes à choisir en confiance.
          </p>
        )}
      </div>
      <GoogleReviewsBlock max={3} />
      {reviews.length > 0 && (
        <div className="grid gap-4 md:grid-cols-3 mb-8">
          {reviews.slice(0, 3).map((review) => <ReviewCard key={review.id} review={review} />)}
        </div>
      )}
      <div className="text-center">
        <a href="/avis" className="inline-flex items-center gap-2 rounded-full border border-gold/45 bg-white/80 px-6 py-3 font-georgia text-sm font-bold text-deep hover:bg-white transition-colors">
          {reviews.length ? 'Lire tous les avis et laisser le vôtre' : 'Laisser un avis sur le site'} <span aria-hidden="true">→</span>
        </a>
      </div>
    </section>
  )
}

function ReviewForm() {
  const startedAt = useRef(Date.now())
  const [form, setForm] = useState({ displayName: '', email: '', offering: '', rating: 0, body: '', experienceMonth: '', consentPublication: false, _hp: '' })
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }))
  const currentMonth = new Date().toISOString().slice(0, 7)

  const messages = {
    displayName: 'Indiquez un prénom ou un pseudonyme (2 à 60 caractères).',
    email: 'Vérifiez votre adresse e-mail.',
    offering: 'Choisissez la prestation concernée.',
    rating: 'Choisissez une note de 1 à 5 étoiles.',
    body: 'Votre avis doit faire entre 30 et 1 500 caractères.',
    experienceMonth: 'Le mois de l’expérience ne peut pas être dans le futur.',
    consentPublication: 'Cochez l’accord de publication pour envoyer votre avis.',
  }

  async function submit(event) {
    event.preventDefault()
    setError('')
    if (!form.offering) return setError(messages.offering)
    if (!form.rating) return setError(messages.rating)
    if (form.body.trim().length < 30) return setError(messages.body)
    if (!form.consentPublication) return setError(messages.consentPublication)
    setStatus('sending')
    try {
      const res = await fetch(`${API}submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, experienceMonth: form.experienceMonth || null, _elapsedMs: Date.now() - startedAt.current }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) return setStatus('sent')
      setStatus('idle')
      if (data.error === 'validation_failed') return setError(messages[data.field] || 'Vérifiez les champs du formulaire.')
      if (data.error === 'too_many_reviews') return setError('Vous avez déjà envoyé deux avis aujourd’hui. Merci, nous les lisons avant publication.')
      if (data.error === 'reviews_not_ready') return setError('La collecte des avis ouvre très bientôt. Vous pouvez aussi écrire à contact@mediumia.fr.')
      return setError('L’envoi n’a pas abouti. Réessayez dans quelques instants.')
    } catch {
      setStatus('idle')
      setError('Connexion impossible. Vérifiez votre réseau et réessayez.')
    }
  }

  if (status === 'sent') {
    return (
      <div role="status" className="rounded-2xl border border-gold/35 bg-gold/10 p-6 text-center">
        <p className="text-3xl text-gold" aria-hidden="true">✦</p>
        <h3 className="mt-2 font-georgia text-xl font-medium text-deep">Merci, votre avis a bien été reçu.</h3>
        <p className="mt-2 font-georgia text-sm leading-relaxed text-mist">Il sera lu puis publié s’il respecte les règles ci-dessous. Votre adresse e-mail ne sera jamais affichée.</p>
      </div>
    )
  }

  const input = 'w-full rounded-xl border border-gold/30 bg-white px-4 py-3 font-georgia text-sm text-deep placeholder:text-mist/40 focus:border-gold/70 focus:outline-none'
  const label = 'mb-1.5 block font-georgia text-xs uppercase tracking-[0.12em] text-mist'

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 font-georgia text-sm text-red-800">{error}</div>}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="review-name" className={label}>Prénom ou pseudonyme</label>
          <input id="review-name" required maxLength={60} autoComplete="given-name" value={form.displayName} onChange={(e) => set('displayName', e.target.value)} className={input} placeholder="Marie D." />
        </div>
        <div>
          <label htmlFor="review-email" className={label}>E-mail (jamais affiché)</label>
          <input id="review-email" type="email" required autoComplete="email" inputMode="email" value={form.email} onChange={(e) => set('email', e.target.value)} className={input} placeholder="vous@exemple.fr" />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="review-offering" className={label}>Prestation concernée</label>
          <select id="review-offering" required value={form.offering} onChange={(e) => set('offering', e.target.value)} className={input}>
            <option value="">Choisir…</option>
            {Object.entries(OFFERING_LABELS).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="review-month" className={label}>Mois de l’expérience (facultatif)</label>
          <input id="review-month" type="month" max={currentMonth} value={form.experienceMonth} onChange={(e) => set('experienceMonth', e.target.value)} className={input} />
        </div>
      </div>
      <fieldset>
        <legend className={label}>Votre note</legend>
        <div className="flex gap-1" role="radiogroup" aria-label="Note sur 5">
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={form.rating === value}
              aria-label={`${value} étoile${value > 1 ? 's' : ''}`}
              onClick={() => set('rating', value)}
              className={`h-11 w-11 rounded-full text-2xl transition-colors ${value <= form.rating ? 'text-gold' : 'text-gold/25 hover:text-gold/60'}`}
            >
              ★
            </button>
          ))}
        </div>
      </fieldset>
      <div>
        <label htmlFor="review-body" className={label}>Votre avis</label>
        <textarea id="review-body" required rows={5} maxLength={1500} value={form.body} onChange={(e) => set('body', e.target.value)} className={input} placeholder="Ce que vous avez vécu, ce qui vous a aidé, ce qui pourrait être amélioré…" />
        <p className="mt-1 text-right font-georgia text-[11px] text-mist/70">{form.body.trim().length} / 1 500 (30 minimum)</p>
      </div>
      <div className="hidden" aria-hidden="true">
        <label htmlFor="review-website">Site web</label>
        <input id="review-website" tabIndex={-1} autoComplete="off" value={form._hp} onChange={(e) => set('_hp', e.target.value)} />
      </div>
      <label className="flex items-start gap-3 font-georgia text-sm leading-relaxed text-deep/80">
        <input type="checkbox" checked={form.consentPublication} onChange={(e) => set('consentPublication', e.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-[#b77a12]" />
        <span>J’accepte que cet avis soit publié sur mediumia.fr avec mon prénom ou pseudonyme, la note et la date. Je confirme qu’il décrit une expérience que j’ai réellement vécue.</span>
      </label>
      <button type="submit" disabled={status === 'sending'} className="w-full rounded-xl bg-deep py-4 font-georgia text-base font-bold text-gold transition-opacity hover:opacity-90 disabled:opacity-60">
        {status === 'sending' ? 'Envoi…' : 'Envoyer mon avis'}
      </button>
      <p className="text-center font-georgia text-[11px] leading-relaxed text-mist/70">
        Votre e-mail sert uniquement à vérifier l’avis et à vous contacter à son sujet. Voir la <a href="/confidentialite" className="text-gold hover:underline">politique de confidentialité</a>.
      </p>
    </form>
  )
}

function ModerationPolicy() {
  return (
    <section className="rounded-2xl border border-gold/25 bg-white/70 p-5 md:p-6">
      <h2 className="font-georgia text-lg font-medium text-deep">Comment les avis sont traités</h2>
      <ul className="mt-3 space-y-2 font-georgia text-sm leading-relaxed text-deep/78">
        <li>✦ Chaque avis est lu par MediumIA avant publication. Il n’est ni modifié ni réécrit.</li>
        <li>✦ Les avis positifs comme négatifs sont publiés. Un avis n’est refusé que s’il contient des propos injurieux, des données personnelles d’un tiers, s’il est sans rapport avec MediumIA, s’il ne correspond pas à une expérience vérifiable ou s’il fait doublon.</li>
        <li>✦ Aucun avis n’est rémunéré ni obtenu en échange d’un avantage.</li>
        <li>✦ Les avis sont affichés du plus récent au plus ancien, avec la date de l’avis et, si elle est indiquée, celle de l’expérience.</li>
        <li>✦ Vous pouvez demander la modification ou le retrait de votre avis à tout moment : <a href="mailto:contact@mediumia.fr" className="text-gold hover:underline">contact@mediumia.fr</a>.</li>
      </ul>
    </section>
  )
}

function ModerationPanel() {
  const { session, loading } = useAuth()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [reasons, setReasons] = useState({})
  const token = session?.access_token

  async function load() {
    if (!token) return
    setError('')
    const res = await fetch(`${API}pending`, { headers: { Authorization: `Bearer ${token}` } })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) return setError(res.status === 403 ? 'Ce compte ne peut pas modérer les avis.' : 'Chargement impossible.')
    setData(body)
  }

  useEffect(() => { load() }, [token]) // eslint-disable-line react-hooks/exhaustive-deps

  async function decide(id, decision, reasonOverride) {
    const reason = reasonOverride || reasons[id]
    if (decision === 'rejected' && !reason) return setError('Choisissez le motif du refus.')
    const res = await fetch(`${API}moderate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id, decision, reason }),
    })
    if (!res.ok) return setError('La décision n’a pas été enregistrée.')
    load()
  }

  if (loading) return <p className="font-georgia text-sm text-mist">Chargement…</p>
  if (!token) return <p className="font-georgia text-sm text-mist">Connectez-vous avec le compte propriétaire (bouton « Connexion » en bas de l’écran) pour modérer les avis.</p>
  if (error && !data) return <p role="alert" className="font-georgia text-sm text-red-800">{error}</p>
  if (!data) return <p className="font-georgia text-sm text-mist">Chargement…</p>
  if (!data.available) return <p className="font-georgia text-sm text-mist">La table des avis n’existe pas encore : appliquez la migration <code>20260923180000_customer_reviews.sql</code>.</p>

  return (
    <div className="space-y-6">
      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 font-georgia text-sm text-red-800">{error}</p>}
      <h2 className="font-georgia text-2xl font-medium text-deep">À modérer ({data.pending.length})</h2>
      {data.pending.length === 0 && <p className="font-georgia text-sm text-mist">Aucun avis en attente.</p>}
      {data.pending.map((review) => (
        <div key={review.id} className="space-y-3">
          <ReviewCard review={review} />
          <p className="font-georgia text-xs text-mist">Contact (privé) : {review.email}</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <button type="button" onClick={() => decide(review.id, 'approved')} className="rounded-xl bg-deep px-5 py-2.5 font-georgia text-sm font-bold text-gold">Publier</button>
            <select aria-label="Motif du refus" value={reasons[review.id] || ''} onChange={(e) => setReasons((r) => ({ ...r, [review.id]: e.target.value }))} className="rounded-xl border border-gold/30 bg-white px-3 py-2.5 font-georgia text-sm">
              <option value="">Motif de refus…</option>
              {Object.entries(REJECTION_LABELS).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
            </select>
            <button type="button" onClick={() => decide(review.id, 'rejected')} className="rounded-xl border border-gold/40 px-5 py-2.5 font-georgia text-sm font-bold text-deep">Refuser</button>
          </div>
        </div>
      ))}
      {data.recent.length > 0 && (
        <>
          <h2 className="pt-4 font-georgia text-xl font-medium text-deep">Dernières décisions</h2>
          <ul className="space-y-2 font-georgia text-sm text-deep/80">
            {data.recent.map((review) => (
              <li key={review.id} className="flex flex-wrap items-center gap-2">
                <span className={review.status === 'approved' ? 'text-emerald-700' : 'text-red-700'}>{review.status === 'approved' ? 'Publié' : 'Refusé'}</span>
                <span>· {review.display_name} · <Stars value={review.rating} size="text-xs" /></span>
                {review.rejection_reason && <span className="text-mist">({REJECTION_LABELS[review.rejection_reason]})</span>}
                {review.status === 'approved' && (
                  <button type="button" onClick={() => decide(review.id, 'rejected', 'requested_by_author')} className="text-xs text-mist underline">
                    retirer (demande de l’auteur)
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

export default function ReviewsPage({ onBack, onNavigate }) {
  const moderation = window.location.pathname.startsWith('/avis/moderation')
  const { loading, available, reviews } = useApprovedReviews()
  const average = reviews.length ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length : 0

  return (
    <div className="cosmic-page cosmic-page--network min-h-screen bg-cream text-deep">
      <header className="cosmic-page__header sticky top-0 z-50 border-b border-gold/20 bg-cream/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <button onClick={onBack} className="font-georgia text-sm font-semibold tracking-[0.18em] text-deep">✦ MEDIUMIA</button>
          <button onClick={onBack} className="font-georgia text-xs text-mist hover:text-deep">← Accueil</button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 pb-24 pt-10">
        {moderation ? (
          <>
            <p className="font-georgia text-[11px] uppercase tracking-[0.2em] text-gold">Espace propriétaire</p>
            <h1 className="mt-2 mb-8 font-georgia text-3xl font-medium">Modération des avis</h1>
            <ModerationPanel />
          </>
        ) : (
          <>
            <p className="font-georgia text-[11px] uppercase tracking-[0.2em] text-gold">Avis clients</p>
            <h1 className="mt-2 font-georgia text-3xl font-medium leading-tight md:text-5xl">Ce qu’en disent celles et ceux qui ont vécu l’expérience.</h1>
            {reviews.length >= 3 && (
              <p className="mt-4 font-georgia text-sm text-mist">
                <Stars value={Math.round(average)} /> <strong className="text-deep">{average.toFixed(1).replace('.', ',')} / 5</strong> · {reviews.length} avis publiés
              </p>
            )}

            <div className="mt-10 grid gap-10 md:grid-cols-[1.1fr_.9fr]">
              <section aria-label="Avis publiés" className="space-y-4">
                <GoogleReviewsBlock max={5} columns="grid-cols-1" />
                {loading && <p className="font-georgia text-sm text-mist">Chargement des avis…</p>}
                {!loading && reviews.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-gold/35 p-6 text-center">
                    <p className="font-georgia text-deep">Aucun avis publié pour l’instant.</p>
                    <p className="mt-2 font-georgia text-sm text-mist">{available ? 'Soyez la première personne à partager son expérience.' : 'La collecte des avis ouvre très bientôt.'}</p>
                  </div>
                )}
                {reviews.map((review) => <ReviewCard key={review.id} review={review} />)}
              </section>
              <div className="space-y-6">
                <section className="rounded-3xl border border-gold/30 bg-white/80 p-5 md:p-6">
                  <h2 className="mb-5 font-georgia text-2xl font-medium">Laisser un avis</h2>
                  <ReviewForm />
                </section>
                <ModerationPolicy />
              </div>
            </div>
          </>
        )}
      </main>
      <LegalFooter onNavigate={onNavigate} />
    </div>
  )
}
