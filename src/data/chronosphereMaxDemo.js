import { READING_SECTION_TITLES } from '../../lib/chronosphereReading.js'
import { buildChronosphereMaxSnapshot } from '../../lib/chronosphereMaxSnapshot.js'
import { compareChronosphereSnapshots, summarizeChronosphereLine } from '../../lib/chronosphereMaxCompare.js'

export const chronosphereMaxDemoProfile = {
  solarSign: 'Scorpion',
}

const baseSections = {
  "La photographie de l'instant": 'La situation ressemble à un lien encore vivant, mais traversé par une attente qui fatigue. Le tirage parle moins de conclusion définitive que de seuil à clarifier.',
  'La fréquence principale': 'La carte principale demande de regarder ce qui s’ouvre réellement, sans confondre ouverture et promesse déjà formée.',
  'Les deux résonances': 'La première résonance ramène le choix au centre. La seconde demande de revenir à une parole simple, vérifiable, sans tout relancer.',
  'Ce que racontent les trois fréquences ensemble': 'Les trois cartes décrivent un passage : reconnaître ce qui reste ouvert, choisir une posture claire, puis vérifier ce que le réel peut soutenir.',
  'Le ciel de naissance et le contexte astrologique': 'Le contexte met l’accent sur les liens, les échanges et la capacité à poser une limite calme plutôt qu’une demande implicite.',
  'La ligne de temps': 'La préparation doit rester sobre. La fenêtre prioritaire sert surtout à ouvrir une conversation cadrée, pas à forcer une réponse.',
  'Les deux chemins possibles': 'Si tu maintiens la dynamique actuelle, l’attente peut continuer à te prendre de l’énergie. Si tu modifies l’élément clé, la relation devient plus lisible parce que ta place est nommée.',
  'Vos leviers concrets': 'À faire maintenant : écrire la question exacte à clarifier.\nÀ préparer : poser une limite simple avant toute relance.\nÀ ne pas forcer : obtenir une réponse totale avant que l’autre ait montré une disponibilité réelle.',
  'La question que Chronosphère vous renvoie': 'Qu’est-ce que tu cherches encore à obtenir par silence alors que ton besoin demande une parole claire ?',
}

function reading(overrides = {}) {
  return {
    summary30s: overrides.summary30s || 'La lecture suit une relation encore ouverte, mais qui demande un geste plus clair pour ne pas rester suspendue.',
    direction: null,
    closure: overrides.closure || {
      stillOpen: 'Une parole reste en attente.',
      mainLock: 'Le besoin de certitude avant de dire clairement ce qui est attendu.',
      opensAfterClosure: 'Une conversation plus sobre, avec moins de projection.',
    },
    whyNow: overrides.whyNow || [
      {
        calculated: 'Vénus trigone Mercure natal dans la fenêtre prioritaire.',
        interpretation: 'La période soutient symboliquement une parole relationnelle plus fluide.',
      },
      {
        calculated: 'Maison VII activée dans le contexte de lecture.',
        interpretation: 'Le domaine du lien et du face-à-face ressort comme point utile de compréhension.',
      },
    ],
    sections: READING_SECTION_TITLES.map((title) => ({
      title,
      content: overrides.sections?.[title] || baseSections[title],
    })),
    realignmentAct: {
      gesture: 'Écrire une phrase claire, puis la réduire à une seule demande.',
      decree: 'Je choisis une parole simple plutôt qu’une attente qui m’épuise.',
    },
  }
}

function result({ createdAt, theme, cards, peak, quality, summary30s, closure, sections, whyNow }) {
  return {
    schemaVersion: 'chronosphere-v2',
    engineVersion: 'chronosphere-999-58-v2',
    createdAt,
    theme,
    sky: {
      houseSystem: 'Placidus',
      ascendant: '12° Balance',
      mc: '18° Cancer',
      timing: {
        horizonDays: 120,
        quality,
        primary: {
          start: peak.start,
          peak: peak.peak,
          end: peak.end,
          aspects: peak.aspects,
        },
        alternatives: peak.alternatives,
        caution: peak.caution,
      },
    },
    cards,
    reading: reading({ summary30s, closure, sections, whyNow }),
  }
}

export const chronosphereMaxDemoResults = [
  result({
    createdAt: '2026-08-07T09:15:00.000Z',
    theme: 'Relation / séparation',
    quality: 'soutien en construction',
    cards: [
      { number: 17, name: 'L’Ouverture', block: 'Passage', density: 'air', astre: 'Vénus' },
      { number: 31, name: 'La Bifurcation', block: 'Choix', density: 'feu', astre: 'Mars' },
      { number: 44, name: 'L’Alignement', block: 'Incarnation', density: 'terre', astre: 'Saturne' },
    ],
    peak: {
      start: '2026-09-08',
      peak: '2026-09-14',
      end: '2026-09-20',
      aspects: [{ transitPlanet: 'Vénus', aspect: 'trigone', natalPlanet: 'Mercure', orb: 1.2 }],
      alternatives: [{ start: '2026-09-25', peak: '2026-09-29', end: '2026-10-03', aspects: [{ transitPlanet: 'Jupiter', aspect: 'sextile', natalPlanet: 'Vénus', orb: 1.8 }] }],
      caution: { start: '2026-10-08', peak: '2026-10-11', end: '2026-10-14', aspects: [{ transitPlanet: 'Mars', aspect: 'carré', natalPlanet: 'Lune', orb: 1.5 }] },
    },
  }),
  result({
    createdAt: '2026-09-01T11:30:00.000Z',
    theme: 'Relation / séparation',
    quality: 'soutien plus net',
    cards: [
      { number: 17, name: 'L’Ouverture', block: 'Passage', density: 'air', astre: 'Vénus' },
      { number: 22, name: 'Le Seuil', block: 'Passage', density: 'eau', astre: 'Lune' },
      { number: 51, name: 'La Parole tenue', block: 'Lien', density: 'air', astre: 'Mercure' },
    ],
    peak: {
      start: '2026-09-18',
      peak: '2026-09-23',
      end: '2026-09-28',
      aspects: [{ transitPlanet: 'Vénus', aspect: 'trigone', natalPlanet: 'Mercure', orb: 0.8 }],
      alternatives: [{ start: '2026-10-02', peak: '2026-10-06', end: '2026-10-10', aspects: [{ transitPlanet: 'Mercure', aspect: 'sextile', natalPlanet: 'Vénus', orb: 1.1 }] }],
      caution: { start: '2026-10-15', peak: '2026-10-18', end: '2026-10-21', aspects: [{ transitPlanet: 'Mars', aspect: 'carré', natalPlanet: 'Lune', orb: 1.9 }] },
    },
    summary30s: 'La même ouverture reste présente, mais elle se précise autour d’une parole à poser plutôt que d’un signe à attendre.',
    sections: {
      'La question que Chronosphère vous renvoie': 'Quelle phrase claire peux-tu prononcer sans demander à l’autre de réparer toute l’histoire ?',
    },
  }),
  result({
    createdAt: '2026-09-23T08:05:00.000Z',
    theme: 'Relation / séparation',
    quality: 'clarification active',
    cards: [
      { number: 51, name: 'La Parole tenue', block: 'Lien', density: 'air', astre: 'Mercure' },
      { number: 17, name: 'L’Ouverture', block: 'Passage', density: 'air', astre: 'Vénus' },
      { number: 9, name: 'Le Détachement juste', block: 'Libération', density: 'terre', astre: 'Saturne' },
    ],
    peak: {
      start: '2026-10-01',
      peak: '2026-10-05',
      end: '2026-10-09',
      aspects: [{ transitPlanet: 'Mercure', aspect: 'sextile', natalPlanet: 'Vénus', orb: 0.7 }],
      alternatives: [{ start: '2026-10-14', peak: '2026-10-18', end: '2026-10-22', aspects: [{ transitPlanet: 'Vénus', aspect: 'trigone', natalPlanet: 'Mercure', orb: 1.4 }] }],
      caution: { start: '2026-10-28', peak: '2026-10-30', end: '2026-11-02', aspects: [{ transitPlanet: 'Mars', aspect: 'opposition', natalPlanet: 'Vénus', orb: 2.1 }] },
    },
    summary30s: 'La Ligne de Temps sort de l’attente pure : le point central devient une parole précise, puis la capacité à accepter ce qu’elle révèle.',
    closure: {
      stillOpen: 'La réponse relationnelle reste ouverte.',
      mainLock: 'La peur qu’une clarification ferme définitivement la porte.',
      opensAfterClosure: 'Une liberté plus grande, que la relation reprenne ou se clôture.',
    },
    sections: {
      'La question que Chronosphère vous renvoie': 'Quelle vérité relationnelle peux-tu accueillir sans perdre ton axe ?',
      'Vos leviers concrets': 'À faire maintenant : formuler une demande courte et datée.\nÀ préparer : décider ce que tu feras si la réponse reste floue.\nÀ ne pas forcer : transformer la clarification en ultimatum émotionnel.',
    },
    whyNow: [
      {
        calculated: 'Mercure sextile Vénus natal dans la fenêtre prioritaire.',
        interpretation: 'La période soutient symboliquement une clarification relationnelle par la parole.',
      },
      {
        calculated: 'Maison VII activée dans le contexte de lecture.',
        interpretation: 'Le lien direct à l’autre reste le domaine principal à observer.',
      },
    ],
  }),
]

export const chronosphereMaxDemoEntries = chronosphereMaxDemoResults.map((item, index) => ({
  id: `demo-entry-${index + 1}`,
  timelineTitle: 'Relation / séparation',
  sequenceNumber: index + 1,
  readAt: item.createdAt,
  snapshot: buildChronosphereMaxSnapshot(item, {
    sourceDrawTable: index === 0 ? 'chronosphere_paid_draws' : 'chronosphere_pack_draws',
    sourceDrawId: `00000000-0000-4000-8000-00000000000${index + 1}`,
  }),
}))

export const chronosphereMaxDemoComparison = compareChronosphereSnapshots(
  chronosphereMaxDemoEntries[1].snapshot,
  chronosphereMaxDemoEntries[2].snapshot,
  { previousSequence: 2, currentSequence: 3, comparedAt: '2026-09-23T08:06:00.000Z' },
)

export const chronosphereMaxDemoTimeline = {
  id: 'demo-timeline-relation-separation',
  title: 'Relation / séparation',
  theme: 'amour',
  status: 'active',
  followedSinceDays: 47,
  lastReadingLabel: '23 septembre 2026',
  entries: chronosphereMaxDemoEntries,
  comparison: chronosphereMaxDemoComparison,
  finalSynthesis: summarizeChronosphereLine(chronosphereMaxDemoEntries),
}

export const chronosphereMaxDemoTimelines = [
  chronosphereMaxDemoTimeline,
  {
    id: 'demo-timeline-projet',
    title: 'Projet professionnel',
    theme: 'travail',
    status: 'active',
    followedSinceDays: 21,
    lastReadingLabel: '18 septembre 2026',
    entries: chronosphereMaxDemoEntries.slice(0, 2),
    comparison: compareChronosphereSnapshots(chronosphereMaxDemoEntries[0].snapshot, chronosphereMaxDemoEntries[1].snapshot, { previousSequence: 1, currentSequence: 2 }),
    finalSynthesis: null,
  },
]
