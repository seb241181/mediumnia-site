import { useCallback, useEffect, useState } from 'react'
import { reseauPractitioners } from '../../data/reseauPractitioners.js'

// Pilotage : membres MediumIA Pro du Réseau. L'administrateur invite un
// professionnel par e-mail et le rattache à sa fiche ; le professionnel crée
// ensuite son compte et active lui-même son espace sur /agents.

const STATUS_LABELS = { pending: 'Invitation envoyée', accepted: 'Espace activé', revoked: 'Accès retiré' }
const ERROR_LABELS = {
  invalid_email: 'Adresse e-mail à vérifier.',
  unknown_reseau_profile: 'Fiche du Réseau inconnue.',
  pilotage_forbidden: 'Réservé à l’administration MediumIA.',
  reseau_profile_already_invited: 'Cette fiche du Réseau possède déjà une invitation ou un espace actif.',
  assistant_not_found: 'Aucun assistant actif sur cette fiche.',
}

const DEMO = {
  members: [
    { id: 'demo-1', email: 'praticien@exemple.fr', reseauSlug: 'amandine-pouwels', status: 'accepted', createdAt: new Date().toISOString(), assistant: { name: 'L’assistant d’Amandine', status: 'active', publicEnabled: false } },
    { id: 'demo-2', email: 'nouveau@exemple.fr', reseauSlug: null, status: 'pending', createdAt: new Date().toISOString(), assistant: null },
  ],
}

function dateLabel(value) {
  const d = new Date(value || '')
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'Europe/Paris' }) : ''
}

export default function ProMembersAdmin({ session, demoMode = false }) {
  const [members, setMembers] = useState(demoMode ? DEMO.members : null)
  const [email, setEmail] = useState('')
  const [slug, setSlug] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const call = useCallback(async (body) => {
    const res = await fetch('/api/rdv-admin?action=pro-members', {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${session?.access_token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'pro_members_unavailable')
    return data
  }, [session?.access_token])

  const load = useCallback(async () => {
    if (demoMode || !session?.access_token) return
    try {
      const data = await call()
      setMembers(data.members || [])
      setError('')
    } catch (e) {
      setError(e.message)
    }
  }, [call, demoMode, session?.access_token])

  useEffect(() => { load() }, [load])

  async function invite(event) {
    event.preventDefault()
    if (demoMode) { setMessage('Démonstration : aucune invitation envoyée.'); return }
    setBusy(true)
    setMessage('')
    setError('')
    try {
      const data = await call({ op: 'invite', email, reseauSlug: slug || null })
      setMessage(data.emailStatus === 'sent'
        ? `Invitation envoyée à ${email}.`
        : `Invitation enregistrée pour ${email}. L’e-mail n’a pas pu partir : transmettez le lien mediumia.fr/agents vous-même.`)
      setEmail('')
      setSlug('')
      await load()
    } catch (e) {
      setError(e.message)
    }
    setBusy(false)
  }

  async function revoke(member) {
    if (demoMode) return
    const confirmText = member.status === 'accepted'
      ? `Retirer l’accès pro de ${member.email} ? Son assistant ne répondra plus.`
      : `Annuler l’invitation de ${member.email} ?`
    if (!window.confirm(confirmText)) return
    try {
      await call({ op: 'revoke', id: member.id })
      await load()
    } catch (e) {
      setError(e.message)
    }
  }

  // Validation par l'administrateur : l'assistant n'apparaît aux visiteurs de
  // la fiche qu'après cette mise en ligne (aperçu possible avant).
  async function publish(member, enabled) {
    if (demoMode) return
    const who = nameOf(member.reseauSlug) || member.email
    const confirmText = enabled
      ? `Mettre en ligne « ${member.assistant?.name} » sur la fiche de ${who} ? Les visiteurs pourront lui poser leurs questions.`
      : `Retirer « ${member.assistant?.name} » de la fiche de ${who} ?`
    if (!window.confirm(confirmText)) return
    try {
      await call({ op: 'publish', reseauSlug: member.reseauSlug, enabled })
      setMessage(enabled ? `Assistant en ligne sur la fiche de ${who}.` : `Assistant retiré de la fiche de ${who}.`)
      await load()
    } catch (e) {
      setError(e.message)
    }
  }

  const nameOf = (id) => reseauPractitioners.find((p) => p.id === id)?.name
  const field = 'rounded-xl border border-gold/30 bg-white px-3 py-2.5 font-georgia text-sm text-deep outline-none focus:border-gold/70'

  return (
    <section className="rounded-2xl border border-gold/25 bg-white/75 p-6 md:p-7" aria-labelledby="pro-members-title">
      <p className="font-georgia text-[10px] uppercase tracking-[0.16em] text-gold">MEDIUMIA PRO</p>
      <h3 id="pro-members-title" className="mt-1 font-georgia text-xl font-medium text-deep">Assistants IA du Réseau</h3>
      <p className="mt-1 font-georgia text-xs leading-relaxed text-mist">Invitez un professionnel : il crée son compte avec cette adresse, active son espace sur mediumia.fr/agents et crée son assistant, inclus dans son adhésion.</p>

      <form onSubmit={invite} className="mt-5 grid gap-3 md:grid-cols-[1.2fr_1fr_auto]">
        <label className="sr-only" htmlFor="pro-invite-email">E-mail du professionnel</label>
        <input id="pro-invite-email" type="email" required placeholder="e-mail du professionnel" value={email} onChange={(e) => setEmail(e.target.value)} className={field} />
        <label className="sr-only" htmlFor="pro-invite-slug">Fiche du Réseau</label>
        <select id="pro-invite-slug" value={slug} onChange={(e) => setSlug(e.target.value)} className={field}>
          <option value="">Sans fiche du Réseau</option>
          {reseauPractitioners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button type="submit" disabled={busy} className="rounded-xl bg-deep px-5 py-2.5 font-georgia text-sm font-bold text-gold disabled:opacity-60">{busy ? 'Envoi…' : 'Inviter'}</button>
      </form>
      {message && <p role="status" className="mt-3 font-georgia text-xs text-deep">{message}</p>}
      {error && <p role="alert" className="mt-3 font-georgia text-xs text-red-700">{ERROR_LABELS[error] || 'Action impossible pour le moment.'}</p>}

      <div className="mt-5 divide-y divide-gold/15">
        {members === null ? (
          <p className="py-3 font-georgia text-xs text-mist">Chargement…</p>
        ) : members.length === 0 ? (
          <p className="py-3 font-georgia text-xs text-mist">Aucune invitation pour l’instant.</p>
        ) : members.map((m) => (
          <div key={m.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="truncate font-georgia text-sm text-deep">{m.email}</p>
              <p className="font-georgia text-[11px] text-mist">
                {nameOf(m.reseauSlug) ? `Fiche : ${nameOf(m.reseauSlug)}` : 'Sans fiche'} · {STATUS_LABELS[m.status] || m.status} · {dateLabel(m.createdAt)}
                {m.assistant ? ` · Assistant « ${m.assistant.name} » (${m.assistant.publicEnabled ? 'visible sur la fiche' : 'privé'})` : m.status === 'accepted' ? ' · Assistant pas encore créé' : ''}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2 self-start sm:self-auto">
              {m.status === 'accepted' && m.assistant?.status === 'active' && m.reseauSlug && (
                <>
                  <a href={`/reseau/${m.reseauSlug}`} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-gold/30 px-3 py-1.5 font-georgia text-xs text-mist hover:text-deep">
                    {m.assistant.publicEnabled ? 'Voir la fiche' : 'Aperçu sur la fiche'}
                  </a>
                  <button type="button" onClick={() => publish(m, !m.assistant.publicEnabled)} className={`rounded-lg px-3 py-1.5 font-georgia text-xs font-semibold ${m.assistant.publicEnabled ? 'border border-gold/30 text-deep' : 'bg-deep text-gold'}`}>
                    {m.assistant.publicEnabled ? 'Retirer de la fiche' : 'Mettre en ligne'}
                  </button>
                </>
              )}
              {m.status !== 'revoked' && (
                <button type="button" onClick={() => revoke(m)} className="rounded-lg border border-gold/30 px-3 py-1.5 font-georgia text-xs text-deep">
                  {m.status === 'accepted' ? 'Retirer l’accès' : 'Annuler'}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
