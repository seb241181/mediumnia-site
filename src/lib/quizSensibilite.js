import { storyAttributionUrl } from './mediumiaAttribution.js'

// Quiz « Quel est votre canal de perception ? » : les quatre canaux du
// Module 2 de la Formation (La Perception Pure). Chaque réponse pointe vers un
// canal ; le résultat est un miroir pour commencer à pratiquer, jamais un
// diagnostic ni la mesure d'un don.

export const QUIZ_URL = 'https://mediumia.fr/quiz-sensibilite'
export const QUIZ_SHARE_URL = storyAttributionUrl('quiz')

export const CHANNELS = ['sensation', 'vision', 'audience', 'connaissance']

export const PROFILES = {
  sensation: {
    name: 'ClairSensation',
    motto: 'Je sens avant de savoir',
    portrait: 'Votre corps est votre première antenne. Vous percevez l’ambiance d’une pièce dès que vous y entrez, la tristesse d’une personne avant qu’elle ne parle, une présence avant de la voir.',
    signs: ['Frissons ou picotements sans cause extérieure', 'Variations de chaleur, poids sur le thorax ou dans le dos', 'Émotions qui arrivent sans raison apparente'],
    pitfall: 'Prendre pour vous ce qui appartient aux autres. Votre travail : apprendre à distinguer ce que vous ressentez de ce que vous captez.',
    practice: 'Avant d’interpréter une sensation, nommez-la simplement : où est-elle dans le corps, quelle température, quel poids ? La perception d’abord, le sens ensuite.',
  },
  vision: {
    name: 'Clairvision',
    motto: 'Je vois en dedans',
    portrait: 'Vous recevez par images intérieures : formes, couleurs, scènes, symboles. Elles arrivent vite, comme des flashs, souvent avant que vous ayez eu le temps de les chercher.',
    signs: ['Images fugaces derrière les paupières fermées', 'Flashs de couleur ou symboles inattendus', 'Lieux visualisés avec une précision étonnante'],
    pitfall: 'Raconter une histoire autour de l’image au lieu de la décrire. Votre travail : livrer l’image brute avant d’en chercher le sens.',
    practice: 'Quand une image arrive, décrivez-la telle quelle, sans l’expliquer : couleur, forme, position. Le sens se précise avec la pratique, pas avec le mental.',
  },
  audience: {
    name: 'Clairaudience',
    motto: 'Je reçois une intention formulée',
    portrait: 'Vous recevez par les mots. Pas une voix à l’oreille, mais une pensée qui arrive avec une qualité différente : brève, précise, inattendue, distincte de vos pensées habituelles.',
    signs: ['Phrases courtes qui surgissent sans raison', 'Prénoms ou mots qui s’imposent', 'Mélodies intérieures au moment juste'],
    pitfall: 'Confondre le bavardage du mental avec une information reçue. Votre travail : reconnaître la texture particulière de ce qui ne vient pas de vous.',
    practice: 'Notez mot pour mot la première phrase reçue, sans la reformuler. La justesse se loge souvent dans le mot exact, pas dans le résumé.',
  },
  connaissance: {
    name: 'Clairconnaissance',
    motto: 'L’évidence apparaît sans raisonnement',
    portrait: 'Vous savez, sans savoir pourquoi. Rien de visible ni de sensoriel : l’information est simplement là, évidente, certaine, sans source apparente. C’est souvent le canal le plus difficile à reconnaître.',
    signs: ['Certitudes sur des choses que vous ne pouviez pas savoir', 'Compréhension immédiate de situations complexes', 'Réponses justes à des questions jamais réfléchies'],
    pitfall: 'Douter de tout parce que rien ne « se voit », ou au contraire tout tenir pour certain. Votre travail : vérifier, garder trace, laisser l’expérience confirmer.',
    practice: 'Tenez un carnet des évidences : notez-les au moment où elles arrivent, puis revenez-y plus tard. C’est le temps qui vous apprend à leur faire confiance.',
  },
}

export const QUESTIONS = [
  {
    text: 'Vous entrez dans une pièce où vous n’êtes jamais venu. Qu’est-ce qui vous parvient en premier ?',
    answers: [
      ['sensation', 'Une ambiance dans le corps : lourde, légère, tendue'],
      ['vision', 'Une image qui s’impose, un détail qui « s’allume »'],
      ['audience', 'Une phrase intérieure, comme un commentaire qui n’est pas le vôtre'],
      ['connaissance', 'Une certitude : il s’est passé quelque chose ici'],
    ],
  },
  {
    text: 'Le téléphone sonne. Vous savez souvent qui appelle parce que…',
    answers: [
      ['sensation', 'Vous avez senti la personne juste avant'],
      ['vision', 'Son visage vous est apparu'],
      ['audience', 'Son prénom vous est venu en tête'],
      ['connaissance', 'Vous le savez, simplement'],
    ],
  },
  {
    text: 'Dans un lieu chargé d’histoire (vieille maison, église, château), il vous arrive…',
    answers: [
      ['sensation', 'De sentir un changement d’air, un froid, une présence'],
      ['vision', 'D’imaginer très nettement des scènes d’autrefois'],
      ['audience', 'D’entendre intérieurement des bribes, des noms, des sons'],
      ['connaissance', 'De savoir ce qui s’y est passé, sans l’avoir lu nulle part'],
    ],
  },
  {
    text: 'Vos rêves marquants sont surtout…',
    answers: [
      ['sensation', 'Chargés d’émotions qui restent au réveil'],
      ['vision', 'Très visuels, colorés, précis'],
      ['audience', 'Porteurs de paroles, de messages entendus'],
      ['connaissance', 'Suivis d’une compréhension soudaine au réveil'],
    ],
  },
  {
    text: 'Face à une décision importante, ce qui vous guide vraiment, c’est…',
    answers: [
      ['sensation', 'Le corps : ça se serre ou ça s’ouvre'],
      ['vision', 'Une image de la situation qui se dessine'],
      ['audience', 'Une petite phrase intérieure claire et brève'],
      ['connaissance', 'Une évidence qui précède tout raisonnement'],
    ],
  },
  {
    text: 'Quelqu’un vous ment. Comment le remarquez-vous ?',
    answers: [
      ['sensation', 'Un malaise physique, quelque chose « sonne faux » dans le ventre'],
      ['vision', 'Son visage ou la scène changent de couleur, d’éclat'],
      ['audience', 'Les mots « ce n’est pas vrai » arrivent dans votre tête'],
      ['connaissance', 'Vous le savez avant même qu’il ait fini sa phrase'],
    ],
  },
  {
    text: 'En méditation ou au calme, ce qui vient le plus spontanément :',
    answers: [
      ['sensation', 'Des sensations : picotements, chaleur, vibrations'],
      ['vision', 'Des couleurs, des formes, des scènes'],
      ['audience', 'Des mots, des sons, une musique intérieure'],
      ['connaissance', 'Des compréhensions, des « déclics »'],
    ],
  },
  {
    text: 'Enfant, ce qu’on vous a le plus souvent dit de vous :',
    answers: [
      ['sensation', '« Tu es trop sensible »'],
      ['vision', '« Tu as trop d’imagination »'],
      ['audience', '« Tu parles tout seul »'],
      ['connaissance', '« Comment tu peux savoir ça ? »'],
    ],
  },
]

// Ordre stable des canaux pour départager les égalités : le premier canal choisi
// au fil du quiz l'emporte, comme le premier signal brut du Module 2.
export function scoreQuiz(choices) {
  const scores = Object.fromEntries(CHANNELS.map((c) => [c, 0]))
  const firstSeen = {}
  ;(choices || []).forEach((channel, index) => {
    if (!CHANNELS.includes(channel)) return
    scores[channel] += 1
    if (firstSeen[channel] === undefined) firstSeen[channel] = index
  })
  const ranked = [...CHANNELS].sort((a, b) =>
    (scores[b] - scores[a]) || ((firstSeen[a] ?? Infinity) - (firstSeen[b] ?? Infinity)) || (CHANNELS.indexOf(a) - CHANNELS.indexOf(b)))
  const answered = CHANNELS.reduce((sum, c) => sum + scores[c], 0)
  const dominant = ranked[0]
  const secondary = scores[ranked[1]] > 0 ? ranked[1] : null
  // Profil « équilibré » : aucun canal ne se détache (écart d'une réponse au plus).
  const balanced = answered > 0 && scores[ranked[0]] - scores[ranked[CHANNELS.length - 1]] <= 1
  return { scores, ranked, dominant, secondary, balanced, answered }
}

// Plus forts restes : les pourcentages affichés font toujours 100 au total.
export function percentages(scores) {
  const total = CHANNELS.reduce((sum, c) => sum + (scores[c] || 0), 0)
  if (!total) return Object.fromEntries(CHANNELS.map((c) => [c, 0]))
  const exact = CHANNELS.map((c) => [c, ((scores[c] || 0) / total) * 100])
  const result = Object.fromEntries(exact.map(([c, v]) => [c, Math.floor(v)]))
  let missing = 100 - CHANNELS.reduce((sum, c) => sum + result[c], 0)
  for (const [c] of [...exact].sort((a, b) => (b[1] % 1) - (a[1] % 1))) {
    if (missing <= 0) break
    result[c] += 1
    missing -= 1
  }
  return result
}

export function quizShareText(dominant) {
  const profile = PROFILES[dominant]
  if (!profile) return `Quel est votre canal de perception ? Découvrez-le en 2 minutes.\n${QUIZ_SHARE_URL}`
  return `✦ Mon canal de perception dominant : ${profile.name} — « ${profile.motto} ».\nEt vous, quel est le vôtre ? Quiz gratuit en 2 minutes.\n${QUIZ_SHARE_URL}`
}
