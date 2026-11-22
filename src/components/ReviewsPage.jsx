import { useEffect, useRef, useState } from 'react'
import LegalFooter from './LegalFooter'
import { useAuth } from '../lib/useAuth.js'
import PublicPageNav from './PublicPageNav'
import { findPossibleDuplicates } from '../lib/reviewDuplicates.js'
import { GOOGLE_LINKS, SITE_OFFERINGS, dayLabel, googleReviewDate, isFormationReview, sortGoogleReviews } from '../lib/googleReviewsDisplay.js'

const API = '/api/rdv-config?reviewsAction='
const BUSINESS_API = '/api/rdv-config?googleBusinessAction='

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

export function Stars({ value, size = 'text-base' }) {
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

// Google reviews of the MediumIA profile: Business Profile (all reviews, newest
// first) or, as a fallback, Places (5 reviews chosen by Google). Cached server-side.
// Without any Google access the block still offers the two Google links.
export function useGoogleReviews() {
  const [state, setState] = useState({ loading: true, available: false, ...GOOGLE_LINKS, reviews: [] })
  useEffect(() => {
    let active = true
    fetch(`${API}google`)
      .then((r) => (r.ok ? r.json() : {}))
      .then((data) => {
        if (!active) return
        const reviews = Array.isArray(data.reviews) ? sortGoogleReviews(data.reviews) : []
        setState({ loading: false, ...GOOGLE_LINKS, ...data, reviews })
      })
      .catch(() => { if (active) setState((s) => ({ ...s, loading: false })) })
    return () => { active = false }
  }, [])
  return state
}

export function GoogleReviewButton({ href = GOOGLE_LINKS.writeUrl, className = '' }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={`inline-flex items-center justify-center gap-2 rounded-full bg-deep px-6 py-3 font-georgia text-sm font-bold text-gold hover:opacity-90 ${className}`}>
      <span aria-hidden="true">★</span> Laisser un avis sur Google
    </a>
  )
}

export function GoogleReviewCard({ review }) {
  const date = googleReviewDate(review)
  return (
    <article className="rounded-2xl border border-gold/25 bg-white/80 p-5 shadow-[0_8px_24px_rgba(26,21,53,.04)]">
      <div className="flex items-center justify-between gap-2">
        {review.rating ? <Stars value={Math.round(review.rating)} /> : <span />}
        <span className="font-georgia text-[10px] uppercase tracking-[0.14em] text-mist">Avis Google</span>
      </div>
      <p className="mt-3 line-clamp-6 whitespace-pre-line font-georgia text-sm leading-relaxed text-deep/85">{review.text}</p>
      <div className="mt-4 flex items-center gap-2 font-georgia text-xs text-mist">
        {review.photoUrl && <img src={review.photoUrl} alt="" width="24" height="24" loading="lazy" referrerPolicy="no-referrer" className="h-6 w-6 shrink-0 rounded-full" />}
        <p>
          {review.authorUrl
            ? <a href={review.authorUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-deep hover:underline">{review.author}</a>
            : <strong className="text-deep">{review.author}</strong>}
          {date && <> · {date}</>}
        </p>
      </div>
    </article>
  )
}

export function GoogleReviewsBlock({ max = 3, columns = 'md:grid-cols-3' }) {
  const google = useGoogleReviews()
  if (google.loading) return null
  const hasReviews = google.available && google.count > 0
  const reviews = (google.reviews || []).slice(0, max)
  return (
    <div className="mb-8">
      {hasReviews && (
        <>
          <p className="mb-2 text-center font-georgia text-sm text-mist">
            <Stars value={Math.round(google.rating || 0)} />{' '}
            <strong className="text-deep">{String(google.rating?.toFixed?.(1) || '').replace('.', ',')} / 5</strong> · {google.count} avis sur Google
          </p>
          <p className="mb-5 text-center font-georgia text-xs text-mist/80">
            {google.source === 'business_profile' ? 'Les avis Google les plus récents, du plus récent au plus ancien.' : 'Une sélection d’avis proposée par Google.'}
          </p>
          <div className={`grid gap-4 ${columns}`}>
            {reviews.map((review, i) => <GoogleReviewCard key={`${review.author}-${review.publishedAt || i}`} review={review} />)}
          </div>
        </>
      )}
      <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <GoogleReviewButton href={google.writeUrl} />
        <a href={google.mapsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-full border border-gold/45 bg-white/80 px-6 py-3 font-georgia text-sm font-bold text-deep hover:bg-white">
          {hasReviews ? 'Voir tous les avis sur Google' : 'Voir nos avis sur Google'} <span aria-hidden="true">→</span>
        </a>
      </div>
    </div>
  )
}

// RepU carousel: user-configured Google reviews widget. Only public pages load
// the third-party script, after React has mounted the widget container.
// Keep the native Google Places/Business component as a network-error fallback.
const REPU_WIDGET_SCRIPT = 'https://business.repu.ai/widget/reviews.js'
const REPU_WIDGET_ID = '3ac987072d88d2bf'

export function RepUGoogleReviewsBlock({ max = 3, columns = 'md:grid-cols-3' }) {
  const [scriptFailed, setScriptFailed] = useState(false)

  useEffect(() => {
    const script = document.createElement('script')
    script.src = REPU_WIDGET_SCRIPT
    script.async = true
    script.onerror = () => setScriptFailed(true)
    document.body.appendChild(script)
    return () => {
      script.onerror = null
      script.remove()
    }
  }, [])

  if (scriptFailed) return <GoogleReviewsBlock max={max} columns={columns} />

  return (
    <div className="mb-8 min-w-0">
      <div data-repu-inline={REPU_WIDGET_ID} className="min-w-0" aria-label="Témoignages Google récents" />
      <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <GoogleReviewButton />
        <a href={GOOGLE_LINKS.mapsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-full border border-gold/45 bg-white/80 px-6 py-3 font-georgia text-sm font-bold text-deep hover:bg-white">
          Voir tous les avis sur Google <span aria-hidden="true">→</span>
        </a>
      </div>
    </div>
  )
}

// Home block: recent Google reviews first, then reviews left on MediumIA
// (consultations and other services, never the formation testimonials).
export function ReviewsHighlight() {
  const { loading, reviews } = useApprovedReviews()
  if (loading) return null
  const siteReviews = reviews.filter((review) => !isFormationReview(review))
  return (
    <section id="avis" className="px-6 py-14 max-w-6xl mx-auto">
      <div className="text-center max-w-2xl mx-auto mb-8">
        <p className="font-georgia text-gold tracking-[0.24em] text-xs uppercase mb-3">Avis clients</p>
        <h2 className="font-georgia font-medium text-3xl md:text-4xl leading-tight text-deep">
          Ils ont vécu l’expérience MediumIA.
        </h2>
        <p className="mt-4 font-georgia text-mist leading-relaxed">
          Vous avez consulté Sébastien&nbsp;? Votre avis sur Google aide d’autres personnes à le trouver et à choisir en confiance.
        </p>
      </div>
      <RepUGoogleReviewsBlock max={3} />
      {siteReviews.length > 0 && (
        <>
          <h3 className="mb-4 text-center font-georgia text-xs uppercase tracking-[0.2em] text-gold">Avis déposés sur MediumIA</h3>
          <div className="grid gap-4 md:grid-cols-3 mb-8">
            {siteReviews.slice(0, 3).map((review) => <ReviewCard key={review.id} review={review} />)}
          </div>
        </>
      )}
      <div className="text-center">
        <a href="/avis" className="inline-flex items-center gap-2 font-georgia text-sm font-semibold text-deep underline decoration-gold/50 underline-offset-4 hover:decoration-gold">
          Lire tous les avis <span aria-hidden="true">→</span>
        </a>
      </div>
    </section>
  )
}

// Dedicated formation testimonials, drawn only from already-approved site reviews.
// Never substitute consultation reviews or unpublished student messages.
export function FormationReviewsBlock() {
  const { loading, available, reviews } = useApprovedReviews()
  const [formOpen, setFormOpen] = useState(false)
  const studentReviews = reviews.filter(isFormationReview)

  return (
    <section id="temoignages-formation" aria-labelledby="temoignages-formation-title" className="mx-auto max-w-5xl scroll-mt-40 px-6 py-12 md:py-16">
      <div className="rounded-3xl border border-gold/30 bg-white/75 px-5 py-8 shadow-[0_8px_24px_rgba(26,21,53,.04)] md:px-10 md:py-10">
        <div className="mx-auto mb-7 max-w-2xl text-center">
          <p className="mb-3 font-georgia text-xs uppercase tracking-[0.24em] text-gold">La parole aux élèves</p>
          <h2 id="temoignages-formation-title" className="font-georgia text-3xl font-medium leading-tight text-deep md:text-4xl">Ils découvrent MediumIA, à leur rythme</h2>
          <p className="mt-3 font-georgia text-sm leading-relaxed text-mist">Des retours authentiques sur les modules, les exercices et la manière d’apprendre.</p>
        </div>

        {studentReviews.length > 0 && (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {studentReviews.slice(0, 6).map((review) => <ReviewCard key={review.id} review={review} />)}
          </div>
        )}
        {!loading && available && studentReviews.length === 0 && (
          <p className="mx-auto max-w-xl text-center font-georgia text-sm leading-relaxed text-mist">
            Les premiers témoignages des élèves apparaîtront ici après leur envoi et leur validation.
          </p>
        )}

        <div className="mt-7 text-center">
          {!formOpen && (
            <button type="button" onClick={() => setFormOpen(true)} aria-expanded="false" aria-controls="formation-review-form" className="inline-flex items-center justify-center rounded-full bg-deep px-6 py-3 font-georgia text-sm font-bold text-gold transition-opacity hover:opacity-90">
              Partager mon avis sur la formation
            </button>
          )}
        </div>
        {formOpen && (
          <div id="formation-review-form" className="mx-auto mt-2 max-w-xl rounded-2xl border border-gold/25 bg-white/80 p-5 text-left md:p-6">
            <h3 className="mb-4 font-georgia text-xl font-medium text-deep">Votre avis sur la formation</h3>
            <ReviewForm fixedOffering="formation" idPrefix="formation-review" />
          </div>
        )}
      </div>
    </section>
  )
}

function ReviewForm({ fixedOffering = null, offerings = SITE_OFFERINGS, idPrefix = 'review' }) {
  const startedAt = useRef(Date.now())
  const [form, setForm] = useState(() => ({ displayName: '', email: '', offering: fixedOffering || '', rating: 0, body: '', experienceMonth: '', consentPublication: false, _hp: '' }))
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }))
  const currentMonth = new Date().toISOString().slice(0, 7)
  const id = (name) => `${idPrefix}-${name}`

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
        body: JSON.stringify({ ...form, offering: fixedOffering || form.offering, experienceMonth: form.experienceMonth || null, _elapsedMs: Date.now() - startedAt.current }),
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
        <p className="mt-2 font-georgia text-sm leading-relaxed text-mist">Il sera lu puis publié s’il respecte les règles de publication. Votre adresse e-mail ne sera jamais affichée.</p>
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
          <label htmlFor={id('name')} className={label}>Prénom ou pseudonyme</label>
          <input id={id('name')} required maxLength={60} autoComplete="given-name" value={form.displayName} onChange={(e) => set('displayName', e.target.value)} className={input} placeholder="Marie D." />
        </div>
        <div>
          <label htmlFor={id('email')} className={label}>E-mail (jamais affiché)</label>
          <input id={id('email')} type="email" required autoComplete="email" inputMode="email" value={form.email} onChange={(e) => set('email', e.target.value)} className={input} placeholder="vous@exemple.fr" />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {fixedOffering ? (
          <p className="font-georgia text-sm text-deep/80"><span className={label}>Prestation concernée</span>{OFFERING_LABELS[fixedOffering]} MediumIA</p>
        ) : (
          <div>
            <label htmlFor={id('offering')} className={label}>Prestation concernée</label>
            <select id={id('offering')} required value={form.offering} onChange={(e) => set('offering', e.target.value)} className={input}>
              <option value="">Choisir…</option>
              {offerings.map((value) => <option key={value} value={value}>{OFFERING_LABELS[value]}</option>)}
            </select>
          </div>
        )}
        <div>
          <label htmlFor={id('month')} className={label}>Mois de l’expérience (facultatif)</label>
          <input id={id('month')} type="month" max={currentMonth} value={form.experienceMonth} onChange={(e) => set('experienceMonth', e.target.value)} className={input} />
        </div>
      </div>
      {!fixedOffering && form.offering === 'consultation' && (
        <div className="rounded-xl border border-gold/35 bg-gold/10 p-4 font-georgia text-sm leading-relaxed text-deep/85">
          <p><strong className="text-deep">Pour une consultation, votre avis est encore plus utile sur Google</strong> : il aide d’autres personnes à trouver Sébastien et à choisir en confiance.</p>
          <GoogleReviewButton className="mt-3" />
          <p className="mt-3 text-xs text-mist">Vous pouvez aussi l’envoyer ici : il sera publié sur MediumIA après lecture.</p>
        </div>
      )}
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
        <label htmlFor={id('body')} className={label}>Votre avis</label>
        <textarea id={id('body')} required rows={5} maxLength={1500} value={form.body} onChange={(e) => set('body', e.target.value)} className={input} placeholder="Ce que vous avez vécu, ce qui vous a aidé, ce qui pourrait être amélioré…" />
        <p className="mt-1 text-right font-georgia text-[11px] text-mist/70">{form.body.trim().length} / 1 500 (30 minimum)</p>
      </div>
      <div className="hidden" aria-hidden="true">
        <label htmlFor={id('website')}>Site web</label>
        <input id={id('website')} tabIndex={-1} autoComplete="off" value={form._hp} onChange={(e) => set('_hp', e.target.value)} />
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
        <li>✦ Chaque avis déposé sur MediumIA est lu avant publication. Il n’est ni modifié ni réécrit.</li>
        <li>✦ Les avis positifs comme négatifs sont publiés. Un avis n’est refusé que s’il contient des propos injurieux, des données personnelles d’un tiers, s’il est sans rapport avec MediumIA, s’il ne correspond pas à une expérience vérifiable ou s’il fait doublon.</li>
        <li>✦ Aucun avis n’est rémunéré ni obtenu en échange d’un avantage.</li>
        <li>✦ Les avis sont affichés du plus récent au plus ancien, avec la date de l’avis et, si elle est indiquée, celle de l’expérience.</li>
        <li>✦ Les avis Google sont repris tels qu’ils sont publiés sur Google, avec le nom de leur auteur, sans tri par note. La fiche Google reste la référence.</li>
        <li>✦ Les témoignages des élèves de la formation sont présentés sur la page Formation.</li>
        <li>✦ Vous pouvez demander la modification ou le retrait de votre avis à tout moment : <a href="mailto:contact@mediumia.fr" className="text-gold hover:underline">contact@mediumia.fr</a>.</li>
      </ul>
    </section>
  )
}

const BUSINESS_RESULT_LABELS = {
  connected: 'Fiche Google connectée : les avis affichés viennent désormais de Google Business Profile.',
  pending_access: 'Autorisation enregistrée. La fiche n’a pas encore pu être lue (accès à l’API Business Profile pas encore accordé par Google, ou plusieurs fiches). Le site continue d’afficher les avis Places. Reconnectez-vous une fois l’accès accordé.',
  refused: 'Connexion annulée sur Google. Rien n’a été modifié.',
  invalid_state: 'Ce lien de connexion a expiré ou a déjà servi. Recommencez.',
  token_failed: 'Google a refusé l’échange d’autorisation. Vérifiez le client OAuth dédié, puis recommencez.',
  scope_missing: 'L’autorisation « gérer votre fiche d’établissement » n’a pas été accordée.',
  no_refresh_token: 'Google n’a pas fourni d’autorisation durable. Retirez l’accès dans votre compte Google puis recommencez.',
  not_configured: 'Le client OAuth Google Business n’est pas encore configuré sur le serveur.',
  storage_failed: 'L’autorisation n’a pas pu être enregistrée. Réessayez.',
}

const BUSINESS_ERROR_LABELS = {
  api_quota_zero_or_exceeded: 'Google n’a pas encore accordé l’accès à l’API (quota à 0) ou le quota est dépassé.',
  api_access_denied: 'Accès refusé par Google : vérifiez que les API Business Profile sont activées et que ce compte gère la fiche.',
  multiple_locations: 'Plusieurs fiches trouvées : indiquez GOOGLE_BUSINESS_LOCATION_ID sur le serveur.',
  no_location: 'Aucune fiche trouvée pour ce compte Google.',
  location_not_found: 'La fiche indiquée est introuvable pour ce compte.',
  token_invalid_grant: 'Autorisation expirée ou révoquée : reconnectez la fiche.',
}

function GoogleBusinessPanel({ token }) {
  const [status, setStatus] = useState(null)
  const [message, setMessage] = useState(() => BUSINESS_RESULT_LABELS[new URLSearchParams(window.location.search).get('google')] || '')
  const [busy, setBusy] = useState(false)

  const [reloadKey, setReloadKey] = useState(0)
  const load = () => setReloadKey((k) => k + 1)
  useEffect(() => {
    if (!token) return undefined
    let active = true
    fetch(`${BUSINESS_API}status`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : { unavailable: true }))
      .then((body) => { if (active) setStatus(body) })
      .catch(() => { if (active) setStatus({ unavailable: true }) })
    return () => { active = false }
  }, [token, reloadKey])

  async function connect() {
    setBusy(true)
    const res = await fetch(`${BUSINESS_API}connect`, { headers: { Authorization: `Bearer ${token}` } })
    const body = await res.json().catch(() => ({}))
    if (res.ok && body.url) { window.location.href = body.url; return }
    setBusy(false)
    setMessage(body.error === 'google_business_not_configured' ? BUSINESS_RESULT_LABELS.not_configured : 'La connexion n’a pas pu démarrer.')
  }

  async function disconnect() {
    if (!window.confirm('Déconnecter la fiche Google ? Le site reviendra aux avis Places. Google Agenda n’est pas concerné.')) return
    setBusy(true)
    const res = await fetch(`${BUSINESS_API}disconnect`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
    const body = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) setMessage('La déconnexion a échoué.')
    else setMessage(body.revoked ? 'Fiche Google déconnectée : l’autorisation a été retirée chez Google et le jeton effacé.' : 'Jeton effacé de MediumIA. Google n’a pas confirmé le retrait : vous pouvez le retirer aussi dans votre compte Google (Sécurité → Accès tiers).')
    load()
  }

  if (!status) return null
  return (
    <section className="rounded-2xl border border-gold/30 bg-white/80 p-5" aria-labelledby="gbp-title">
      <h2 id="gbp-title" className="font-georgia text-xl font-medium text-deep">Avis Google : connexion Business Profile</h2>
      {message && <p role="status" className="mt-3 rounded-xl border border-gold/30 bg-gold/10 px-4 py-3 font-georgia text-sm text-deep">{message}</p>}
      {status.unavailable ? (
        <p className="mt-3 font-georgia text-sm text-mist">État indisponible (migration google_business_connection à appliquer ?).</p>
      ) : (
        <div className="mt-3 space-y-2 font-georgia text-sm text-deep/85">
          <p>
            Source des avis Google affichés : <strong>{status.ready ? 'Business Profile (tous les avis, du plus récent au plus ancien)' : 'Places (5 avis choisis par Google)'}</strong>
          </p>
          {status.location_title && <p>Fiche : {status.location_title}</p>}
          {status.last_success_at && <p className="text-mist">Dernière lecture réussie : {dayLabel(status.last_success_at)}</p>}
          {status.last_error && <p className="text-red-800">{BUSINESS_ERROR_LABELS[status.last_error] || `Dernière erreur : ${status.last_error}`}</p>}
          {!status.configured && <p className="text-mist">Configuration serveur manquante : {status.missing_env_vars.join(', ')}.</p>}
          <p className="text-xs text-mist">Connexion indépendante de Google Agenda : autre autorisation, autre jeton.</p>
          <div className="flex flex-wrap gap-2 pt-2">
            <button type="button" disabled={busy || !status.configured} onClick={connect} className="rounded-xl bg-deep px-5 py-2.5 font-bold text-gold disabled:opacity-50">
              {status.connected ? 'Reconnecter Google Business' : 'Connecter Google Business'}
            </button>
            {status.connected && (
              <button type="button" disabled={busy} onClick={disconnect} className="rounded-xl border border-gold/40 px-5 py-2.5 font-bold text-deep disabled:opacity-50">Déconnecter</button>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

function DuplicateNotice({ matches }) {
  if (!matches?.length) return null
  const first = matches[0]
  return (
    <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 font-georgia text-xs leading-relaxed text-amber-900">
      Doublon possible : texte très proche de l’avis Google de {first.author}{first.publishedAt ? ` (${dayLabel(first.publishedAt)})` : first.when ? ` (${first.when})` : ''}.
      {' '}À vérifier : rien n’est masqué ni retiré automatiquement.
    </p>
  )
}

function ModerationPanel() {
  const { session, loading } = useAuth()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [reasons, setReasons] = useState({})
  const google = useGoogleReviews()
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

  const duplicates = findPossibleDuplicates([...data.pending, ...data.recent.filter((r) => r.status === 'approved')], google.reviews || [])

  return (
    <div className="space-y-6">
      <GoogleBusinessPanel token={token} />
      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 font-georgia text-sm text-red-800">{error}</p>}
      <h2 className="font-georgia text-2xl font-medium text-deep">À modérer ({data.pending.length})</h2>
      {data.pending.length === 0 && <p className="font-georgia text-sm text-mist">Aucun avis en attente.</p>}
      {data.pending.map((review) => (
        <div key={review.id} className="space-y-3">
          <ReviewCard review={review} />
          <DuplicateNotice matches={duplicates[review.id]} />
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
              <li key={review.id} className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={review.status === 'approved' ? 'text-emerald-700' : 'text-red-700'}>{review.status === 'approved' ? 'Publié' : 'Refusé'}</span>
                  <span>· {review.display_name} · {OFFERING_LABELS[review.offering] || 'MediumIA'} · <Stars value={review.rating} size="text-xs" /></span>
                  {review.rejection_reason && <span className="text-mist">({REJECTION_LABELS[review.rejection_reason]})</span>}
                  {review.status === 'approved' && (
                    <button type="button" onClick={() => decide(review.id, 'rejected', 'requested_by_author')} className="text-xs text-mist underline">
                      retirer (demande de l’auteur)
                    </button>
                  )}
                </div>
                <DuplicateNotice matches={duplicates[review.id]} />
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
  const askedFormation = new URLSearchParams(window.location.search).get('prestation') === 'formation'
  const { loading, available, reviews } = useApprovedReviews()
  const siteReviews = reviews.filter((review) => !isFormationReview(review))
  const average = siteReviews.length ? siteReviews.reduce((sum, r) => sum + r.rating, 0) / siteReviews.length : 0

  return (
    <div className="cosmic-page cosmic-page--network min-h-screen bg-cream text-deep">
      <PublicPageNav onHome={onBack} />

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

            <div className="mt-6 flex flex-col gap-4 rounded-3xl border border-gold/35 bg-white/80 p-5 sm:flex-row sm:items-center sm:justify-between md:p-6">
              <p className="font-georgia text-sm leading-relaxed text-deep/85 sm:max-w-md">
                <strong className="text-deep">Vous avez consulté Sébastien&nbsp;?</strong> Laissez votre avis directement sur Google : il aide d’autres personnes à le trouver et à choisir en confiance.
              </p>
              <GoogleReviewButton className="shrink-0" />
            </div>

            <div className="mt-10 grid gap-10 md:grid-cols-[1.1fr_.9fr]">
              <div className="space-y-10">
                <section aria-labelledby="avis-google-title">
                  <h2 id="avis-google-title" className="mb-4 font-georgia text-2xl font-medium">Avis Google</h2>
                  <RepUGoogleReviewsBlock max={10} columns="grid-cols-1" />
                </section>

                <section aria-labelledby="avis-mediumia-title" className="space-y-4">
                  <h2 id="avis-mediumia-title" className="font-georgia text-2xl font-medium">Avis déposés sur MediumIA</h2>
                  {siteReviews.length >= 3 && (
                    <p className="font-georgia text-sm text-mist">
                      <Stars value={Math.round(average)} /> <strong className="text-deep">{average.toFixed(1).replace('.', ',')} / 5</strong> · {siteReviews.length} avis publiés sur MediumIA
                    </p>
                  )}
                  {loading && <p className="font-georgia text-sm text-mist">Chargement des avis…</p>}
                  {!loading && siteReviews.length === 0 && (
                    <div className="rounded-2xl border border-dashed border-gold/35 p-6 text-center">
                      <p className="font-georgia text-deep">Aucun avis publié pour l’instant.</p>
                      <p className="mt-2 font-georgia text-sm text-mist">{available ? 'Soyez la première personne à partager son expérience.' : 'La collecte des avis ouvre très bientôt.'}</p>
                    </div>
                  )}
                  {siteReviews.map((review) => <ReviewCard key={review.id} review={review} />)}
                  <p className="font-georgia text-sm text-mist">
                    Les témoignages des élèves sont réunis sur la <a href="/formation#temoignages-formation" className="text-deep underline decoration-gold/50 underline-offset-4">page Formation</a>.
                  </p>
                </section>
              </div>
              <div className="space-y-6">
                <section className="rounded-3xl border border-gold/30 bg-white/80 p-5 md:p-6" aria-labelledby="avis-form-title">
                  <h2 id="avis-form-title" className="font-georgia text-2xl font-medium">Déposer un avis sur MediumIA</h2>
                  <p className="mt-2 mb-5 font-georgia text-sm leading-relaxed text-mist">
                    Pour une consultation, privilégiez Google. Pour l’Oracle, la ChronoSphère, une conférence ou une autre prestation, vous pouvez déposer votre avis ici.
                  </p>
                  {askedFormation && (
                    <p className="mb-5 rounded-xl border border-gold/35 bg-gold/10 px-4 py-3 font-georgia text-sm text-deep">
                      Vous suivez la formation&nbsp;? Votre témoignage se dépose sur la <a href="/formation#temoignages-formation" className="font-semibold underline">page Formation</a>.
                    </p>
                  )}
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
