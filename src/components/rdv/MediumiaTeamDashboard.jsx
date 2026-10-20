import { useEffect, useState } from 'react'
import {
  MEDIUMIA_TEAM_AGENTS,
  MEDIUMIA_TEAM_WORKFLOWS,
  planMediumiaTeamWorkflow,
} from '../../../lib/mediumiaTeamOrchestrator.js'
import { buildMediumiaTeamDemo } from '../../../lib/mediumiaTeamDemoReports.js'

// Prototype interne : aucune API, aucune lecture client, aucune écriture.
const CHOICES = {
  'rdv.cancel_refund': 'Annuler et rembourser',
  'rdv.reschedule': 'Déplacer un rendez-vous',
  'finance.reconcile': 'Contrôler les paiements',
}

export default function MediumiaTeamDashboard() {
  const [selected, setSelected] = useState('rdv.reschedule')
  const [visibleCount, setVisibleCount] = useState(0)
  const [aiEnabled, setAiEnabled] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiResult, setAiResult] = useState(null)
  const [aiError, setAiError] = useState('')
  const plan = planMediumiaTeamWorkflow(selected)

  useEffect(() => {
    let active = true
    fetch('/api/rdv-admin?action=mediumia-team-demo', {cache: 'no-store'})
      .then(r => r.ok ? r.json() : {available:false})
      .then(d => { if(active) setAiEnabled(d.available === true) })
      .catch(() => { if(active) setAiEnabled(false) })
    return () => { active = false }
  }, [])

  async function askAiTeam() {
    if(!aiEnabled || aiBusy) return
    setAiBusy(true)
    setAiError('')
    setAiResult(null)
    try {
      const r = await fetch('/api/rdv-admin?action=mediumia-team-demo', {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({workflowId:selected}),
      })
      const d = await r.json()
      if(!r.ok || !d.ok || !d.syntheticData || !Array.isArray(d.responses)) throw new Error('ai_unavailable')
      setAiResult(d)
    } catch {
      setAiError("L'équipe IA n'a pas pu répondre. Aucun changement n'a été effectué.")
    } finally {
      setAiBusy(false)
    }
  }
  const demo = buildMediumiaTeamDemo(selected, visibleCount)

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
          Découvrez le rôle de chaque agent et le déroulé des missions. Sur la préversion autorisée,
          deux agents peuvent analyser ensemble un cas fictif, sans accès à vos comptes.
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
        <p className="mt-1 font-georgia text-xs text-mist">Chaque rôle possède son prompt. Aucun accès aux vrais dossiers clients.</p>
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
              }>Prompt prêt · sans accès client</span>
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
              onClick={() => { setSelected(id); setVisibleCount(0); setAiResult(null); setAiError('') }}
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

            <section aria-labelledby="team-rehearsal-title" className="mt-6 rounded-2xl border border-gold/30 bg-cream/70 p-4 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-georgia text-[10px] uppercase tracking-widest text-gold">
                    Atelier de démonstration
                  </p>
                  <h4 id="team-rehearsal-title" className="mt-1 font-georgia text-lg text-deep">
                    Voir les agents se transmettre le travail
                  </h4>
                  <p className="mt-2 font-georgia text-xs leading-6 text-mist">
                    Un exemple entièrement fictif, programmé à l’avance. Aucun modèle IA
                    ne réfléchit ici, aucun client n’est consulté et aucune opération ne peut partir.
                  </p>
                </div>
                <span className="rounded-full border border-gold/30 bg-white px-3 py-1 text-xs text-deep">
                  {demo.visibleCount} / {demo.totalSteps} étapes simulées
                </span>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={demo.complete}
                  onClick={() => setVisibleCount(n => Math.min(n + 1, demo.totalSteps))}
                  className="rounded-xl bg-deep px-4 py-2.5 font-georgia text-sm font-semibold text-gold disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {demo.visibleCount === 0 ? 'Lancer la simulation' : demo.complete ? 'Simulation terminée' : 'Voir la transmission suivante'}
                </button>
                <button
                  type="button"
                  onClick={() => setVisibleCount(0)}
                  disabled={demo.visibleCount === 0}
                  className="rounded-xl border border-gold/40 bg-white px-4 py-2.5 font-georgia text-sm text-deep disabled:cursor-not-allowed disabled:opacity-45"
                >
                  Recommencer
                </button>
              </div>

              {demo.visibleCount > 0 && (
                <ol aria-live="polite" className="mt-5 space-y-3">
                  {demo.steps.map(report => (
                    <li key={report.mission} className="rounded-xl border border-gold/25 bg-white/85 p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-georgia text-sm font-semibold text-deep">
                          {report.order}. {Object.values(MEDIUMIA_TEAM_AGENTS).find(a => a.id === report.agent)?.name}
                        </span>
                        <span className="rounded-full border border-gold/30 bg-cream px-2 py-1 font-georgia text-[10px] text-mist">
                          Résultat fictif
                        </span>
                      </div>
                      <p className="mt-2 font-georgia text-xs leading-6 text-deep">
                        {report.simulatedFinding}
                      </p>
                      <p className="mt-2 border-t border-gold/20 pt-2 font-georgia text-xs leading-6 text-mist">
                        Transmission : {report.handoff}
                      </p>
                    </li>
                  ))}
                </ol>
              )}

              {demo.complete && (
                <p role="status" className="mt-4 rounded-xl border border-gold/30 bg-white p-3 font-georgia text-xs leading-6 text-deep">
                  Simulation terminée : {demo.totalSteps} étapes expliquées, zéro appel à un modèle IA,
                  zéro client consulté, zéro action externe. Les validations restent à concevoir côté serveur.
                </p>
              )}
            </section>
          </div>
        )}
      </section>

      <section aria-labelledby="two-agents-demo" className="rounded-2xl border border-gold/30 bg-white/70 p-5 sm:p-6">
        <p className="font-georgia text-[11px] uppercase tracking-widest text-gold">Prochaine étape · IA réelle, cas fictifs</p>
        <h3 id="two-agents-demo" className="mt-1 font-georgia text-xl text-deep">Deux agents réfléchissent ensemble</h3>
        <p className="mt-2 font-georgia text-sm leading-7 text-mist">
          Un seul bouton, deux spécialistes : le deuxième lit le compte rendu du premier.
          Ils travaillent uniquement sur un dossier inventé. Aucun vrai client ni paiement.
        </p>
        {aiEnabled ? (
          <button
            type="button"
            disabled={aiBusy}
            onClick={askAiTeam}
            className="mt-4 rounded-xl bg-deep px-5 py-3 font-georgia text-sm font-semibold text-gold disabled:cursor-wait disabled:opacity-60"
          >
            {aiBusy ? 'Les agents réfléchissent…' : 'Faire travailler mon équipe IA'}
          </button>
        ) : (
          <p role="status" className="mt-4 inline-block rounded-xl border border-gold/30 bg-cream px-4 py-3 font-georgia text-sm text-mist">
            Connexion au modèle IA à finaliser sur TEST. La simulation précédente fonctionne déjà.
          </p>
        )}
        {aiError && <p role="alert" className="mt-3 font-georgia text-sm text-red-800">{aiError}</p>}
        {aiResult && (
          <div aria-live="polite" className="mt-5 space-y-3">
            <p className="font-georgia text-xs font-semibold text-deep">
              Résultats générés par IA · dossier fictif · aucune opération exécutée
            </p>
            {aiResult.responses.map((item,index) => (
              <article key={item.agentId} className="rounded-xl border border-gold/25 bg-cream/70 p-4">
                <h4 className="font-georgia text-sm font-semibold text-deep">
                  {index+1}. {Object.values(MEDIUMIA_TEAM_AGENTS).find(a => a.id === item.agentId)?.name || 'Agent'}
                </h4>
                <p className="mt-2 whitespace-pre-wrap font-georgia text-sm leading-7 text-deep">{item.reply}</p>
              </article>
            ))}
            <p className="font-georgia text-xs text-mist">
              Ces analyses ne sont pas des vérifications réelles et ne déclenchent aucune action.
            </p>
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
