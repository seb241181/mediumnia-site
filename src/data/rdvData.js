/**
 * MediumIA Rendez-vous — données des praticiens et services.
 * Les tarifs ne sont pas inventés : chaque praticien devra les configurer.
 * Les horaires réels seront lus depuis Google Agenda après connexion OAuth.
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
        duration: 60,
        price: null,
        priceLabel: 'Tarif à configurer',
        modality: ['video', 'phone'],
        modalityLabel: 'Visio ou Téléphone',
        description: 'Une séance pour explorer les ressentis, recevoir des messages et avancer avec davantage de clarté.',
      },
      {
        id: 'guidance-intuitive',
        title: 'Guidance intuitive',
        duration: 45,
        price: null,
        priceLabel: 'Tarif à configurer',
        modality: ['video', 'phone'],
        modalityLabel: 'Visio ou Téléphone',
        description: 'Un espace pour éclairer une situation, prendre du recul et écouter ce qui cherche à se dire.',
      },
    ],
    settings: {
      timezone: 'Europe/Paris',
      bufferMinutes: 15,
      minAdvanceHours: 24,
      weeksOpen: 6,
      note: 'Horaires à définir dans les paramètres',
    },
  },

  'aurelie-seguin': {
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
        duration: 60,
        price: null,
        priceLabel: 'Tarif à configurer',
        modality: ['in-person'],
        modalityLabel: 'Présentiel',
        description: "Une pratique de bien-être orientée vers la détente, la présence à soi et l'écoute fine des ressentis du corps.",
        provisional: true,
      },
      {
        id: 'eft',
        title: 'EFT',
        duration: 60,
        price: null,
        priceLabel: 'Tarif à configurer',
        modality: ['in-person', 'video'],
        modalityLabel: 'Présentiel ou Visio',
        description: "Une approche d'accompagnement émotionnel qui utilise des points de stimulation corporelle pour libérer les tensions et retrouver l'équilibre.",
        provisional: true,
      },
      {
        id: 'reflexologie',
        title: 'Réflexologie',
        duration: 60,
        price: null,
        priceLabel: 'Tarif à configurer',
        modality: ['in-person'],
        modalityLabel: 'Présentiel',
        description: 'Une pratique manuelle de bien-être qui favorise un temps de relâchement profond et de reconnexion au corps.',
        provisional: true,
      },
    ],
    settings: {
      timezone: 'Europe/Paris',
      bufferMinutes: 15,
      minAdvanceHours: 24,
      weeksOpen: 4,
      note: 'Prestations et horaires à finaliser',
    },
  },
}

export function getPractitioner(slug) {
  return rdvPractitioners[slug] || null
}

/**
 * Génère des créneaux de démonstration — déterministes par date.
 * Remplacer par un appel à /api/rdv-availability une fois Google Agenda configuré.
 */
export function generateDemoSlots(date) {
  const d = new Date(date)
  const dayOfWeek = d.getDay()
  if (dayOfWeek === 0 || dayOfWeek === 6) return []
  const seed = d.getDate() + d.getMonth() * 31
  const hours = [9, 10, 11, 14, 15, 16, 17]
  return hours.map((h, i) => ({
    time: `${String(h).padStart(2, '0')}:00`,
    available: (seed + i * 7) % 3 !== 0,
  }))
}
