/**
 * MediumIA Rendez-vous — données des praticiens et services.
 *
 * Règle de données :
 *  - price / priceLabel : jamais inventés → null / "Tarif à configurer"
 *  - durationLabel / modalityLabel : valeur affichée → "À configurer" jusqu'à validation
 *  - duration (interne) : valeur numérique de démo pour les calculs Preview uniquement,
 *    ne pas afficher directement dans l'UI
 *  - settings._demo : valeurs inventées pour le fonctionnement Preview,
 *    à remplacer par les vraies valeurs lors de la configuration — ne pas afficher telles quelles
 *  - horaires réels : lus depuis Google Agenda après connexion OAuth, pas depuis ce fichier
 */

export const rdvPractitioners = {
  'sebastien-seguin': {
    slug: 'sebastien-seguin',
    name: 'Sébastien Seguin',
    role: 'Médium professionnel',
    photo: '/sebastien.jpg',
    tagline: 'Médiumnité & guidance intuitive',
    intro: 'Médium professionnel depuis plus de douze ans. Ses consultations explorent les perceptions, les liens avec les défunts et les messages qui cherchent à se dire — dans un espace de clarté, sans mystère inutile.',
    services: [
      {
        id: 'consultation-mediumnite',
        title: 'Consultation de médiumnité',
        duration: 60,           // demo — valeur interne pour la Preview uniquement
        durationLabel: 'Durée à configurer',
        price: null,
        priceLabel: 'Tarif à configurer',
        modality: ['video', 'phone'], // demo
        modalityLabel: 'Modalité à configurer',
        description: 'Une séance pour explorer les ressentis, recevoir des messages et avancer avec davantage de clarté.',
      },
      {
        id: 'guidance-intuitive',
        title: 'Guidance intuitive',
        duration: 45,           // demo — valeur interne pour la Preview uniquement
        durationLabel: 'Durée à configurer',
        price: null,
        priceLabel: 'Tarif à configurer',
        modality: ['video', 'phone'], // demo
        modalityLabel: 'Modalité à configurer',
        description: 'Un espace pour éclairer une situation, prendre du recul et écouter ce qui cherche à se dire.',
      },
    ],
    settings: {
      timezone: 'Europe/Paris',
      // Valeurs de démonstration — ne pas afficher comme paramètres validés
      _demo: { bufferMinutes: 15, minAdvanceHours: 24, weeksOpen: 6 },
      note: 'Tampon, délai minimum et horizon à définir lors de la configuration',
    },
  },

  'aurelie-seguin': {
    publicVisible: false,
    slug: 'aurelie-seguin',
    name: 'Aurélie Seguin',
    role: 'Praticienne bien-être',
    photo: '/aurelie.png',
    tagline: "Corps & équilibre émotionnel · L'Écho des Fées",
    intro: "Aurélie Seguin accueille avec douceur et présence. À travers le soin énergétique intuitif, l'EFT et la réflexologie, elle propose un espace de reconnexion au corps, d'écoute et de relâchement.",
    services: [
      {
        id: 'soin-energetique',
        title: 'Soin énergétique intuitif',
        duration: 60,           // demo — valeur interne pour la Preview uniquement
        durationLabel: 'Durée à configurer',
        price: null,
        priceLabel: 'Tarif à configurer',
        modality: ['in-person'], // demo
        modalityLabel: 'Modalité à configurer',
        description: "Une pratique de bien-être orientée vers la détente, la présence à soi et l'écoute fine des ressentis du corps.",
        provisional: true,
      },
      {
        id: 'eft',
        title: 'EFT',
        duration: 60,           // demo — valeur interne pour la Preview uniquement
        durationLabel: 'Durée à configurer',
        price: null,
        priceLabel: 'Tarif à configurer',
        modality: ['in-person', 'video'], // demo
        modalityLabel: 'Modalité à configurer',
        description: "Une approche d'accompagnement émotionnel qui utilise des points de stimulation corporelle pour libérer les tensions et retrouver l'équilibre.",
        provisional: true,
      },
      {
        id: 'reflexologie',
        title: 'Réflexologie',
        duration: 60,           // demo — valeur interne pour la Preview uniquement
        durationLabel: 'Durée à configurer',
        price: null,
        priceLabel: 'Tarif à configurer',
        modality: ['in-person'], // demo
        modalityLabel: 'Modalité à configurer',
        description: 'Une pratique manuelle de bien-être qui favorise un temps de relâchement profond et de reconnexion au corps.',
        provisional: true,
      },
    ],
    settings: {
      timezone: 'Europe/Paris',
      // Valeurs de démonstration — ne pas afficher comme paramètres validés
      _demo: { bufferMinutes: 15, minAdvanceHours: 24, weeksOpen: 4 },
      note: 'Prestations, tampon, délai minimum et horizon à finaliser lors de la configuration',
    },
  },
}

export function getPractitioner(slug) {
  return rdvPractitioners[slug] || null
}

/**
 * Génère des créneaux de démonstration — déterministes par date.
 * Remplacer par un appel à /api/rdv-availability une fois Google Agenda configuré.
 *
 * Comportement de démonstration uniquement :
 *  - week-ends sans créneaux (ne reflète pas les horaires réels)
 *  - horaires 9h–17h du lundi au vendredi (ne reflète pas les horaires réels)
 *  - disponibilité déterministe par seed de date (pas de vraies indisponibilités)
 */
export function generateDemoSlots(date) {
  const d = new Date(date)
  const dayOfWeek = d.getDay()
  if (dayOfWeek === 0 || dayOfWeek === 6) return [] // demo : week-ends vides
  const seed = d.getDate() + d.getMonth() * 31
  const hours = [9, 10, 11, 14, 15, 16, 17]
  return hours.map((h, i) => ({
    time: `${String(h).padStart(2, '0')}:00`,
    available: (seed + i * 7) % 3 !== 0,
  }))
}
