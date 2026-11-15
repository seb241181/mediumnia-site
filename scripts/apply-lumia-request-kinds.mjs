import { readFileSync, writeFileSync } from 'node:fs'

// Lumia — type d'action des demandes importées (« Demandes de RDV à traiter »).
// Dernier patch de la chaîne : ses ancres visent RdvDashboard.jsx après les
// patchs historiques. Ne jamais modifier RdvDashboard.jsx directement.
// Affichage seulement : aucune action, aucun bouton, rien n'est modifié.

const file = new URL('../src/components/rdv/RdvDashboard.jsx', import.meta.url)
let source = readFileSync(file, 'utf8')
const MARKER = 'LUMIA_REQUEST_KIND_LABELS'

if (source.includes(MARKER)) {
  console.log('MediumIA Lumia: request kinds already wired')
} else {
  const labelsAnchor = "const INTAKE_MODALITY_LABELS = { video: 'Visio', 'in-person': 'En présence', phone: 'Téléphone', unknown: 'Non précisée' }"
  const badgeAnchor = '                    {agentLabel(req.intake_agent)}\n                  </span>\n                )}'
  const detailAnchor = '                    <p className="font-semibold text-deep">Demande détectée par {agentLabel(req.intake_agent)}</p>'
  for (const [anchor, label] of [[labelsAnchor, 'labels'], [badgeAnchor, 'badge'], [detailAnchor, 'detail']]) {
    if (source.split(anchor).length !== 2) throw new Error(`Lumia request kinds patch drift: ${label}`)
  }

  source = source.replace(labelsAnchor, `${labelsAnchor}
// Lumia : type d'action d'une demande importée depuis les messages (toujours à vérifier).
const ${MARKER} = { new: 'Nouvelle demande', reschedule: 'Déplacement / modification', cancel: 'Annulation', followup: 'Relance / suivi' }
const LUMIA_RELATED_BOOKING_LABEL = (req) => (req.related_booking_match === 'found'
  ? 'rendez-vous trouvé (non modifié)'
  : req.related_booking_match === 'multiple' ? 'plusieurs rendez-vous à venir, à identifier'
    : req.related_booking_match === 'not_found' ? 'aucun rendez-vous à venir trouvé' : null)`)

  source = source.replace(badgeAnchor, `${badgeAnchor}
                {req.request_kind && ${MARKER}[req.request_kind] && (
                  <span className="shrink-0 whitespace-nowrap font-georgia text-[10px] uppercase tracking-wide rounded-full px-2.5 py-1 border border-amber-400/60 bg-amber-50 text-deep">
                    {${MARKER}[req.request_kind]} · À vérifier
                  </span>
                )}`)

  source = source.replace(detailAnchor, `${detailAnchor}
                    {req.request_kind && ${MARKER}[req.request_kind] && (
                      <p><span className="text-mist">Type : </span><span className="text-deep">{${MARKER}[req.request_kind]} — à vérifier</span></p>
                    )}
                    {LUMIA_RELATED_BOOKING_LABEL(req) && (
                      <p><span className="text-mist">Rendez-vous concerné : </span><span className="text-deep">{LUMIA_RELATED_BOOKING_LABEL(req)}{req.related_booking_id ? ' — à traiter dans l’agenda, Lumia ne l’a pas modifié' : ''}</span></p>
                    )}`)

  writeFileSync(file, source)
  console.log('MediumIA Lumia: request kinds wired')
}
