import { useMemo, useState } from 'react'
import {
  MEDIUMIA_TEAM_AGENTS,
  MEDIUMIA_TEAM_MISSIONS,
  MEDIUMIA_TEAM_WORKFLOWS,
  planMediumiaTeamWorkflow,
} from '../../lib/mediumiaTeamOrchestrator.js'

/**
 * Tableau de pilotage Phase 0 — aucune donnée client ni appel d'API.
 *
 * Ce composant n'exécute aucune mission : il présente un PLAN, jamais une
 * intervention réelle. Ne pas le connecter à des accès financiers / admin
 * depuis le navigateur. La future Phase 1 aura sa propre API sécurisée.
 */

const DESCRIPTIONS = Object.freeze({
  coordinator: 'Oriente les missions, contrôle les dépendances et demande tes accords.',
  rdv: 'Réservations, disponibilités et synchronisation avec Google Agenda.',
  finance: 'Contrôle des paiements, arrhes et remboursements.',
  communication: 'Préparation de messages et confirmations aux clients.',
  technique: 'Audits, qualité, tests et correctifs du site.',
})

const ICONS = Object.freeze({
  coordinator: '◈',
  rdv: '◷',
  finance: '€',
  communication: '✉',
  technique: '⌘',
})

const WORKFLOW_LABELS = Object.freeze({
  'rdv.cancel_refund': 'Annuler et rembourser un rendez-vous',
  'rdv.reschedule': 'Déplacer un rendez-vous',
  'finance.reconcile': 'Vérifier un paiement',
})

const CATEGORY_LABELS = Object.freeze({
  read: 'Vérification planifiée',
  write: 'Modification : accord obligatoire',
  money: 'Argent : accord distinct obligatoire',
  send: 'Envoi : accord obligatoire',
  deploy: 'Déploiement : accord obligatoire',
})

const TASK_LABELS = Object.freeze({
  'rdv.verify': 'Identifier le rendez-vous',
  'rdv.availability': 'Vérifier les disponibilités',
  'rdv.cancel': 'Préparer l’annulation',
  'rdv.reschedule': 'Préparer le nouvel horaire',
  'finance.verify': 'Vérifier les paiements',
  'finance.refund': 'Préparer le remboursement',
  'communication.draft': 'Préparer le message',
  'communication.send': 'Prévoir la confirmation client',
  'technique.audit': 'Analyser les incohérences',
  'technique.deploy': 'Préparer le déploiement',
})

const agentById = new Map(Object.values(MEDIUMIA_TEAM_AGENTS).map(a => [a.id, a]))

export default function AgentTeamConsole() {
  const [selected, setSelected] = useState('rdv.reschedule')
  const [prepared, setPrepared] = useState(null)
  const plan = useMemo(() => prepared ? planMediumiaTeamWorkflow(prepared) : null, [prepared])

  const prepare = () => setPrepared(selected)
  const change = (event) => {
    setSelected(event.target.value)
    setPrepared(null)
  }

  return (
    <section aria-labelledby="mediumia-team-title" className="space-y-6">
      <div className="rounded-2xl border border-gold/25 bg-white/75 p-5 sm:p-7">
        <p className="font-georgia text-[11px] uppercase tracking-[0.18em] text-gold">
          Les Coulisses · Projet équipe IA
        </p>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 id="mediumia-team-title" className="font-georgia text-2xl font-medium text-deep">
              Bureau de direction
            </h2>
            <p className="mt-2 max-w-2xl font-georgia text-sm leading-relaxed text-mist">
              Prépare les missions de ton équipe. Ce prototype montre uniquement les parcours et
              les responsabilités : aucun agent n&apos;est lancé, aucune donnée client
              n&apos;est consultée et aucun message ou remboursement ne peut partir.
            </p>
          </div>
          <span className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1.5 font-georgia text-xs font-semibold text-amber-900">
            Simulation · Aucun agent actif
          </span>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          {[
            ['5', 'Rôles préparés'],
            [String(Object.keys(MEDIUMIA_TEAM_WORKFLOWS).length), 'Parcours disponibles'],
            ['0', 'Action réelle autorisée'],
          ].map(([value, title]) => (
            <div key={title} className="rounded-xl border border-gold/20 bg-cream/80 px-4 py-3">
              <p className="font-georgia text-2xl text-deep">{value}</p>
              <p className="font-georgia text-xs text-mist">{title}</p>
            </div>
          ))}
        </div>
      </div>

      <section aria-label="Les cinq rôles de l'équipe" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Object.entries(MEDIUMIA_TEAM_AGENTS).map(([key, agent]) => (
          <article key={agent.id} className="rounded-2xl border border-gold/20 bg-white/65 p-5">
            <div className="flex items-center justify-between">
              <span aria-hidden="true" className="text-2xl text-gold">{ICONS[key]}</span>
              <span className="font-georgia text-[10px] uppercase tracking-wide text-mist">
                Non connecté
              </span>
            </div>
            <h3 className="mt-3 font-georgia text-base font-semibold text-deep">{agent.name}</h3>
            <p className="mt-2 font-georgia text-xs leading-relaxed text-mist">
              {DESCRIPTIONS[key]}
            </p>
          </article>
        ))}
      </section>

      <section aria-labelledby="team-mission-title" className="rounded-2xl border border-gold/25 bg-white/75 p-5 sm:p-7">
        <p className="font-georgia text-[11px] uppercase tracking-[0.18em] text-gold">Mission</p>
        <h3 id="team-mission-title" className="mt-1 font-georgia text-lg font-semibold text-deep">
          Préparer un parcours
        </h3>
        <p className="mt-2 font-georgia text-sm text-mist">
          Choisis un scénario. Le coordinateur affiche les étapes, sans les exécuter.
        </p>
        <div className="mt-5 flex flex-col items-start gap-3 sm:flex-row sm:items-end">
          <label className="w-full font-georgia text-xs font-semibold text-deep sm:max-w-md">
            Type de mission
            <select
              value={selected}
              onChange={change}
              className="mt-2 block w-full rounded-xl border border-gold/40 bg-cream px-4 py-3 font-georgia text-sm text-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold"
            >
              {Object.keys(MEDIUMIA_TEAM_WORKFLOWS).map(key => (
                <option key={key} value={key}>{WORKFLOW_LABELS[key]}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={prepare}
            className="rounded-xl bg-deep px-5 py-3 font-georgia text-sm font-semibold text-gold hover:bg-deep/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
          >
            Préparer le plan
          </button>
        </div>

        {plan?.ok && (
          <div aria-live="polite" className="mt-6 rounded-xl border border-gold/25 bg-cream/60 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h4 className="font-georgia text-base font-semibold text-deep">{plan.title}</h4>
              <span className="font-georgia text-xs text-amber-800">Plan uniquement · Non exécuté</span>
            </div>
            <ol className="mt-4 space-y-3">
              {plan.steps.map(step => {
                const agent = agentById.get(step.agent)
                return (
                  <li key={step.mission} className="rounded-xl border border-gold/20 bg-white/75 px-4 py-3">
                    <div className="flex gap-3">
                      <span aria-hidden="true" className="font-georgia text-sm text-gold">
                        {String(step.order).padStart(2, '0')}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-georgia text-sm font-semibold text-deep">
                          {TASK_LABELS[step.mission] || MEDIUMIA_TEAM_MISSIONS[step.mission]?.description}
                        </p>
                        <p className="mt-1 font-georgia text-xs text-mist">
                          {agent?.name} · {CATEGORY_LABELS[step.category]}
                        </p>
                        <p className="mt-1 font-georgia text-xs text-mist">
                          État : non exécuté
                        </p>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ol>
            <p className="mt-4 font-georgia text-xs leading-relaxed text-mist">
              Les validations mentionnées sont des exigences du futur système ;
              ce prototype ne contient aucun bouton d&apos;approbation ou d&apos;exécution.
            </p>
          </div>
        )}
      </section>
    </section>
  )
}
