// Brouillon de l'assistant pré-rempli depuis la fiche Réseau du praticien.
// Le praticien relit et corrige chaque réponse avant de créer son assistant :
// rien n'est publié à partir de ce brouillon.

const clip = (text, max) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, max)

function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || ''
}

export function buildAssistantDraft(practitioner) {
  if (!practitioner) {
    return {
      name: 'Mon assistant MediumIA',
      mission: '',
      audience: '',
      tone: 'Chaleureux, bienveillant et clair. Vouvoiement. Réponses courtes et concrètes.',
      knowledge_summary: '',
      limits: DEFAULT_LIMITS,
    }
  }

  const p = practitioner
  const practical = p.practical || {}
  const knowledge = [
    `${p.name} — ${p.role}${p.city ? `, ${p.city}` : ''}.`,
    p.introduction && `Présentation : ${clip(p.introduction, 900)}`,
    p.approach && `Approche : ${clip(p.approach, 900)}`,
    p.spirituality && `Dimension spirituelle : ${clip(p.spirituality, 600)}`,
    p.specialties?.length && `Accompagnements : ${p.specialties.join(', ')}.`,
    p.services?.length && `Séances et tarifs : ${p.services.map((s) => [s.name, s.duration, s.price].filter(Boolean).join(' · ')).join(' ; ')}.`,
    practical.modalities?.length && `Où et comment : ${practical.modalities.join(', ')}.`,
    practical.startingPrice && `Tarif : ${practical.startingPrice}.`,
    practical.duration && `Durée : ${practical.duration}.`,
    p.bookingUrl && `Prendre rendez-vous : ${p.bookingUrl}`,
    practical.phone && `Téléphone : ${practical.phone}`,
    practical.email && `E-mail : ${practical.email}`,
  ].filter(Boolean).join('\n')

  return {
    name: `L’assistant de ${firstName(p.name)}`,
    mission: `Accueillir les personnes qui découvrent ${p.name} sur MediumIA, répondre à leurs questions sur ses accompagnements, sa façon de travailler et ses tarifs, puis les orienter vers la prise de rendez-vous.`,
    audience: clip(practical.audience || p.audience, 300) || 'Particuliers',
    tone: 'Chaleureux, bienveillant et clair. Vouvoiement. Réponses courtes et concrètes.',
    knowledge_summary: knowledge.slice(0, 6000),
    limits: DEFAULT_LIMITS,
  }
}

export const DEFAULT_LIMITS = 'Ne pose jamais de diagnostic médical ou psychologique et ne remplace pas un professionnel de santé. Ne fais aucune promesse de résultat. Ne donne pas de consultation ni de tirage à la place du praticien. Si une information manque, dis-le et propose de prendre contact ou rendez-vous.'

// Les questions de Lumi, dans l'ordre du parcours de création.
export const ASSISTANT_QUESTIONS = [
  { key: 'name', label: 'Le nom de votre assistant', question: 'Comment voulez-vous que votre assistant s’appelle ?', help: 'C’est ce nom que verront les visiteurs de votre fiche.', rows: 1, max: 80 },
  { key: 'mission', label: 'Sa mission', question: 'Quelle est sa mission auprès des personnes qui vous découvrent ?', help: 'En une ou deux phrases : ce qu’il doit faire pour elles.', rows: 3, max: 1500 },
  { key: 'audience', label: 'Les personnes qu’il accueille', question: 'À qui s’adresse-t-il ?', help: 'Adultes, adolescents, couples, en cabinet ou à distance…', rows: 2, max: 1200 },
  { key: 'tone', label: 'Son ton', question: 'Comment doit-il parler ?', help: 'Tutoiement ou vouvoiement, chaleureux, sobre, poétique…', rows: 2, max: 800 },
  { key: 'knowledge_summary', label: 'Ce qu’il sait de vous', question: 'Que doit-il savoir de votre activité ?', help: 'Vos séances, tarifs, lieux, horaires, votre approche. Il ne répondra qu’à partir de ces informations et de vos documents validés.', rows: 9, max: 6000 },
  { key: 'limits', label: 'Ce qu’il ne doit jamais faire', question: 'Quelles limites doit-il toujours respecter ?', help: 'Ce qu’il doit refuser ou renvoyer vers vous.', rows: 4, max: 1500 },
]
