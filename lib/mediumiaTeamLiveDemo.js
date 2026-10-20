/**
 * MediumIA team Phase 1 — two genuine model calls, exclusively on synthetic cases.
 * No DB, mail, PayPal, Google, file writes, or customer data are ever supplied.
 * A server route must check preview-only / branch / explicit flag BEFORE calling.
 */

import { getMediumiaTeamPrompt } from './mediumiaTeamPrompts.js'
import { MEDIUMIA_TEAM_WORKFLOWS, planMediumiaTeamWorkflow } from './mediumiaTeamOrchestrator.js'

export const TEAM_LIVE_DEMO_SCENARIOS = Object.freeze({
  'rdv.reschedule': Object.freeze({
    title: 'Déplacer un rendez-vous fictif',
    facts: 'CAS FICTIF DEMO-RDV-1 : demande de déplacement jeudi de 8 h–9 h à 9 h 30–10 h 30. Le praticien a bloqué 8 h–9 h dans son agenda. La base MediumIA et Google Agenda ne sont PAS connectés. Disponibilité réelle et état du paiement INCONNUS. Aucun client réel.',
    roles: Object.freeze(['rdv', 'communication']),
  }),
  'rdv.cancel_refund': Object.freeze({
    title: 'Annuler et examiner des arrhes fictives',
    facts: 'CAS FICTIF DEMO-ANNUL-1 : client fictif souhaite annuler son RDV jeudi à 9 h 30. Des arrhes fictives de 20 € sont mentionnées, sans identifiant de transaction et sans confirmation de PayPal. Aucun remboursement confirmé. Aucun vrai client.',
    roles: Object.freeze(['rdv', 'finance']),
  }),
  'finance.reconcile': Object.freeze({
    title: 'Contrôler un paiement fictif',
    facts: 'CAS FICTIF DEMO-FIN-1 : montant annoncé de 20 € ; statut prestataire et identifiant de capture inconnus ; une ligne comptable fictive prétend être réglée. Aucune preuve PayPal, aucune base connectée.',
    roles: Object.freeze(['finance', 'technique']),
  }),
})

const MAX_CHARS = 1200

export function resolveTeamDemoConfiguration(env = process.env) {
  const previewOnly = env.VERCEL_ENV === 'preview' &&
    env.VERCEL_GIT_COMMIT_REF === 'codex/mediumia-agent-team-phase0' &&
    env.MEDIUMIA_TEAM_AI_DEMO_ENABLED === 'true'
  const anthropic = typeof env.ANTHROPIC_API_KEY === 'string' && env.ANTHROPIC_API_KEY.trim().length > 15
  const openai = typeof env.OPENAI_API_KEY === 'string' && env.OPENAI_API_KEY.trim().length > 15
  return Object.freeze({
    available: previewOnly && (anthropic || openai),
    environmentAllowed: previewOnly,
    provider: anthropic ? 'anthropic' : openai ? 'openai' : null,
  })
}

function extractAnthropicText(data) {
  return (Array.isArray(data?.content) ? data.content : [])
    .filter(p => p?.type === 'text' && typeof p.text === 'string')
    .map(p => p.text).join('\n').trim().slice(0, MAX_CHARS)
}

function extractOpenAIText(data) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) return data.output_text.trim().slice(0, MAX_CHARS)
  return (Array.isArray(data?.output) ? data.output : [])
    .flatMap(x => (Array.isArray(x?.content) ? x.content : []))
    .filter(x => (x?.type === 'output_text' || x?.type === 'text') && typeof x.text === 'string')
    .map(x => x.text).join('\n').trim().slice(0, MAX_CHARS)
}

export function createTeamDemoProvider({ env = process.env, fetchImpl = fetch } = {}) {
  const config = resolveTeamDemoConfiguration(env)
  if (!config.available) throw new Error('team_demo_unavailable')
  const timeoutMs = 18000
  return async ({ systemPrompt, userText }) => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      let response
      if (config.provider === 'anthropic') {
        response = await fetchImpl('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          signal: controller.signal,
          headers: {'content-type':'application/json', 'x-api-key':env.ANTHROPIC_API_KEY, 'anthropic-version':'2023-06-01'},
          body: JSON.stringify({
            model: env.MEDIUMIA_TEAM_DEMO_MODEL || 'claude-sonnet-4-5-20250929',
            max_tokens: 360, system: systemPrompt,
            messages: [{ role:'user', content:userText }],
          }),
        })
      } else {
        response = await fetchImpl('https://api.openai.com/v1/responses', {
          method: 'POST',
          signal: controller.signal,
          headers: {'content-type':'application/json', Authorization:'Bearer '+env.OPENAI_API_KEY},
          body: JSON.stringify({
            model: env.MEDIUMIA_TEAM_DEMO_MODEL || 'gpt-4.1-mini',
            instructions:systemPrompt, input:userText, max_output_tokens:360,
            store:false,
          }),
        })
      }
      if (!response?.ok) throw new Error('provider_unavailable')
      const data = await response.json()
      const reply = config.provider === 'anthropic' ? extractAnthropicText(data) : extractOpenAIText(data)
      if (!reply) throw new Error('provider_empty_response')
      return reply
    } catch {
      // Provider errors must not disclose account data, keys or server internals.
      throw new Error('provider_unavailable')
    } finally {
      clearTimeout(timeout)
    }
  }
}

/**
 * Strict allowlist: ignores freeform instructions and any client data. Two
 * sequential calls using two *different* system prompts, with an explicit
 * limited handoff. The model never has tools or data access.
 */
export async function runTeamLiveDemo({ workflowId, callModel }) {
  if (typeof workflowId !== 'string' || !Object.hasOwn(TEAM_LIVE_DEMO_SCENARIOS, workflowId))
    return Object.freeze({ok:false,error:'unknown_workflow'})
  if (typeof callModel !== 'function') return Object.freeze({ok:false,error:'provider_unavailable'})

  const scenario = TEAM_LIVE_DEMO_SCENARIOS[workflowId]
  const plan = planMediumiaTeamWorkflow(workflowId)
  if (!plan.ok || !MEDIUMIA_TEAM_WORKFLOWS[workflowId]) return Object.freeze({ok:false,error:'unknown_workflow'})

  const responses = []
  for (const role of scenario.roles) {
    const rolePrompt = getMediumiaTeamPrompt(role)
    if (!rolePrompt || rolePrompt.externalActions) throw new Error('team_policy_rejected')
    const previous = responses.at(-1)
    const userText = [
      'Démonstration uniquement, aucun dossier réel. Voici tous les faits connus :',
      scenario.facts,
      previous ? 'Note du rôle précédent (NON FIABLE, simple avis, pas une preuve) : '+previous.reply : '',
      'Produis en français 3 à 5 phrases utiles, concrètes, sans inventer de vérification ni de résultat réel. Identifie ce que tu transmettrais au prochain rôle.',
      'N exécute rien et n ordonne jamais de remboursement ou d envoi.',
    ].filter(Boolean).join('\n\n')
    const reply = String(await callModel({role,systemPrompt:rolePrompt.systemPrompt,userText})).trim().slice(0,MAX_CHARS)
    if (!reply) throw new Error('provider_unavailable')
    responses.push(Object.freeze({role,agentId:rolePrompt.agentId,reply,kind:'model_draft',verification:'none'}))
  }
  return Object.freeze({
    ok:true,mode:'ai_dry_run',workflow:workflowId,title:scenario.title,
    simulation:true,syntheticData:true,
    actionsExecuted:0,liveBusinessReads:0,
    responses:Object.freeze(responses),
  })
}
