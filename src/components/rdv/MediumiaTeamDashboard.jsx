import { useState } from 'react'
import {
  MEDIUMIA_TEAM_AGENTS,
  MEDIUMIA_TEAM_WORKFLOWS,
  planMediumiaTeamWorkflow,
} from '../../../lib/mediumiaTeamOrchestrator.js'

// Prototype interne : aucune API, aucune lecture client, aucune écriture.
const CHOICES = {
  'rdv.cancel_refund': 'Annuler et rembourser',
  'rdv.reschedule': 'Déplacer un rendez-vous',
  'finance.reconcile': 'Contrôler les paiements',
}

export default function MediumiaTeamDashboard() {
  const [selected, setSelected] = useState('rdv.reschedule')
  const plan = planMediumiaTeamWorkflow(selected)

  return (
    <section aria-labelledby="team-heading" className="space-y-6">
      <header className="rounded-3xl border border-gold/30 bg-deep px-6 py-7 text-cream sm:px-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-georgia text-xs uppercase tracking-widest text-gold">
              Les Coulisses · Bureau de direction
            </p>
            <h2 id="team-heading" className="mt-2 font-georgia text-2xl sm:text-3xl">
              Votre équipe IA MediumIA
            </h2>
          </div>
          <span className="rounded-full border border-gold/40 px-3 py-1 font-georgia text-xs text-gold">
            Prototype TEST · Phase 0
          </span>
        </div>
        <p className="mt-4 max-w-3xl font-georgia text-sm leading-7 text-cream/85">
          Découvrez le rôle de chaque agent et le déroulé des missions. Aucun agent
          n’est encore connecté à un modèle IA ou à vos comptes.
        </p>
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            ['5', 'rôles préparés'],
            ['3', 'parcours disponibles'],
            ['0', 'action réellement exécutée'],
          ].map(([value, label]) => (
            <div key={label} className="rounded-xl border border-gold/25 bg-white/5 px-4 py-3">
              <p className="font-georgia text-2xl text-gold">{value}</p>
              <p className="font-georgia text-xs text-cream/80">{label}</p>
            </div>
          ))}
        </div>
      </header>

      <section aria-labelledby="members-heading" className="rounded-2xl border border-gold/25 bg-white/70 p-5 sm:p-6">
        <h3 id="members-heading" className="font-georgia text-xl text-deep">Votre équipe</h3>
        <p className="mt-1 font-georgia text-xs text-mist">Chaque rôle dispose de son prompt. Aucune connexion active.</p>
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(MEDIUMIA_TEAM_AGENTS).map(([key, agent]) => (
            <article key={agent.id} className={
              'rounded-2xl border p-4 ' +
              (key === 'coordinator' ? 'border-gold/40 bg-deep text-cream' : 'border-gold/25 bg-cream/70 text-deep')
            }>
              <p className={
                'font-georgia text-[10px] uppercase tracking-wider ' +
                (key === 'coordinator' ? 'text-gold' : 'text-mist')
              }>{key === 'coordinator' ? 'Coordination' : 'Agent spécialisé'}</p>
              <h4 className="mt-2 font-georgia text-base font-semibold">{agent.name}</h4>
              <p className={
                'mt-2 font-georgia text-xs leading-6 ' +
                (key === 'coordinator' ? 'text-cream/80' : 'text-mist')
              }>{agent.scope}</p>
              <span className={
                'mt-4 inline-block rounded-full border px-2 py-1 font-georgia text-[10px] ' +
                (key === 'coordinator' ? 'border-gold/40 text-gold' : 'border-gold/25 text-mist')
              }>Prompt prêt · inactif</span>
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="workflow-heading" className="rounded-2xl border border-gold/25 bg-white/70 p-5 sm:p-6">
        <h3 id="workflow-heading" className="font-georgia text-xl text-deep">Simuler une mission</h3>
        <p className="mt-1 font-georgia text-xs leading-6 text-mist">
          Ces plans ne contiennent aucun dossier client réel et ne déclenchent aucune action.
        </p>
        <div role="group" aria-label="Choisir un parcours" className="mt-4 flex flex-wrap gap-2">
          {Object.keys(MEDIUMIA_TEAM_WORKFLOWS).map(id => (
            <button
              key={id}
              type="button"
              onClick={() => setSelected(id)}
              aria-pressed={id === selected}
              className={
                'rounded-xl border px-4 py-2.5 font-georgia text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold ' +
                (id === selected ? 'border-deep bg-deep text-gold' : 'border-gold/30 bg-cream text-deep hover:border-gold')
              }
            >
              {CHOICES[id] || MEDIUMIA_TEAM_WORKFLOWS[id].title}
            </button>
          ))}
        </div>

        {plan.ok && (
          <div aria-live="polite" className="mt-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-cream px-4 py-3">
              <strong className="font-georgia text-base text-deep">{plan.title}</strong>
              <span className="rounded-full border border-gold/30 px-3 py-1 font-georgia text-xs text-mist">
                Plan non exécuté
              </span>
            </div>
            <ol className="space-y-3">
              {plan.steps.map(step => (
                <li key={step.mission} className="flex gap-3 rounded-xl border border-gold/25 bg-white/80 p-4">
                  <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-deep font-georgia text-sm text-gold">
                    {step.order}
                  </span>
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="font-georgia text-sm text-deep">
                        {Object.values(MEDIUMIA_TEAM_AGENTS).find(agent => agent.id === step.agent)?.name || 'Agent inconnu'}
                      </strong>
                      {step.requiresOwnerApproval && (
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 font-georgia text-[10px] text-amber-800">
                          Votre accord requis
                        </span>
                      )}
                    </div>
                    <p className="mt-1 font-georgia text-xs leading-6 text-mist">{step.description}</p>
                    <p className="mt-1 font-georgia text-[10px] uppercase tracking-wider text-mist">
                      À préparer · aucune exécution
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}
      </section>

      <aside role="note" className="rounded-xl border border-gold/30 bg-cream px-5 py-4 font-georgia text-xs leading-6 text-deep">
        <strong>Mode protégé :</strong> aucune réservation, aucun remboursement, aucun e-mail et aucun
        déploiement ne peuvent être déclenchés ici. Les prochaines phases exigeront les
        preuves métier, les permissions serveur et votre validation explicite.
      </aside>
    </section>
  )
}
