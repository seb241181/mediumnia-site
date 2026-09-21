export const ORACLE_SPREADS = [
  {
    id: 'ombre-passage-guerison',
    name: 'Ombre · Passage · Guérison',
    shortDescription: 'Le tirage signature de l’Oracle Au-delà de l’Âme.',
    positions: [
      { label: 'Ombre', meaning: 'Ce qui demande à être vu, reconnu ou éclairé en toi.' },
      { label: 'Passage', meaning: 'Le mouvement intérieur, la bascule ou la transformation en cours.' },
      { label: 'Guérison', meaning: 'Ce qui peut être intégré, apaisé ou remis en circulation.' },
    ],
  },
  {
    id: 'situation-blocage-cle',
    name: 'Situation · Blocage · Clé',
    shortDescription: 'Pour éclairer une situation concrète sans prédire à ta place.',
    positions: [
      { label: 'Situation', meaning: 'L’énergie ou la dynamique centrale de la situation actuelle.' },
      { label: 'Blocage', meaning: 'Ce qui freine, brouille ou demande à être compris autrement.' },
      { label: 'Clé', meaning: 'Le point d’appui, le geste ou la compréhension qui peut aider à avancer.' },
    ],
  },
  {
    id: 'passe-present-ouverture',
    name: 'Passé · Présent · Ouverture',
    shortDescription: 'Pour observer un cheminement et ce qu’il rend possible maintenant.',
    positions: [
      { label: 'Passé', meaning: 'L’influence encore active de ce qui a précédé.' },
      { label: 'Présent', meaning: 'Ce qui est vivant, visible ou sensible maintenant.' },
      { label: 'Ouverture', meaning: 'La direction intérieure qui peut être explorée à partir d’ici.' },
    ],
  },
  {
    id: 'moi-autre-lien',
    name: 'Moi · L’autre · Le lien',
    shortDescription: 'Pour regarder une relation comme un miroir à trois voix.',
    positions: [
      { label: 'Moi', meaning: 'Ta posture, ton ressenti ou ce que tu apportes dans cette relation.' },
      { label: 'L’autre', meaning: 'La place symbolique de l’autre dans la dynamique, sans prétendre lire ses pensées.' },
      { label: 'Le lien', meaning: 'La dynamique relationnelle créée entre vous et ce qu’elle invite à comprendre.' },
    ],
  },
  {
    id: 'elan-defi-alignement',
    name: 'Élan · Défi · Alignement',
    shortDescription: 'Pour un projet, une décision ou une période de transition.',
    positions: [
      { label: 'Élan', meaning: 'Ce qui pousse, appelle ou veut prendre forme.' },
      { label: 'Défi', meaning: 'Le point de friction, de vigilance ou de maturation nécessaire.' },
      { label: 'Alignement', meaning: 'La manière la plus cohérente de te positionner sans forcer une réponse.' },
    ],
  },
]

export const DEFAULT_ORACLE_SPREAD_ID = ORACLE_SPREADS[0].id

export function getOracleSpread(spreadId) {
  return ORACLE_SPREADS.find((spread) => spread.id === spreadId) || ORACLE_SPREADS[0]
}
