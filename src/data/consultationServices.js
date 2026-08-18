/**
 * Contenus du module Consulter.
 * Portraits et tarifs définitifs à confirmer avant publication.
 */
export const consultationPractitioners = [
  {
    id: 'sebastien-seguin',
    firstName: 'Sébastien',
    name: 'Sébastien Seguin',
    role: 'Médium professionnel',
    eyebrow: 'Médiumnité & guidance',
    rdvSlug: 'sebastien-seguin',
    portrait: '/sebastien.jpg',
    portraitAlt: 'Portrait de Sébastien Seguin',
    introduction: "Médium professionnel depuis plus de douze ans, Sébastien accompagne avec une présence attentive et directe. Ses consultations explorent les perceptions, les liens avec les défunts et les messages qui cherchent à se dire — dans un espace de clarté, sans mystère inutile.",
    intention: 'Médiumnité, guidance intuitive et accompagnement autour des perceptions.',
    detailsLabel: 'Découvrir les consultations',
    statusLabel: null,
    reservationUrl: 'https://sebastien-seguin.reservio.com',
    accent: 'deep',
    services: [
      {
        id: 'consultation-mediumnite',
        title: 'Consultation de médiumnité',
        description: "Une séance pour explorer les ressentis, recevoir des messages et avancer avec davantage de clarté — une pratique de plus de douze ans, au service de votre chemin.",
      },
      {
        id: 'guidance-intuitive',
        title: 'Guidance intuitive',
        description: "Un espace pour éclairer une situation, prendre du recul et écouter ce qui cherche à se dire.",
      },
    ],
  },
  {
    id: 'aurelie-seguin',
    firstName: 'Aurélie',
    name: 'Aurélie Seguin',
    role: "Praticienne bien-être · L'Écho des Fées",
    eyebrow: 'Corps & équilibre émotionnel',
    rdvSlug: 'aurelie-seguin',
    portrait: '/aurelie.png',
    portraitAlt: 'Portrait d\'Aurélie Seguin',
    introduction: "Aurélie Seguin accueille avec douceur et présence. À travers le soin énergétique intuitif, l'EFT et la réflexologie, elle propose un espace de reconnexion au corps, d'écoute et de relâchement — au sein de son univers L'Écho des Fées.",
    intention: "Soin énergétique, EFT, réflexologie — des pratiques réunies par une même qualité d'écoute.",
    detailsLabel: "Découvrir les soins d'Aurélie",
    statusLabel: 'Prestations en cours de finalisation — disponible prochainement',
    accent: 'gold',
    services: [
      {
        id: 'soin-energetique-intuitif',
        title: 'Soin énergétique intuitif',
        description: "Une pratique de bien-être orientée vers la détente, la présence à soi et l'écoute fine des ressentis du corps.",
        provisional: true,
      },
      {
        id: 'eft',
        title: 'EFT',
        description: "Une approche d'accompagnement émotionnel qui utilise des points de stimulation corporelle pour libérer les tensions et retrouver l'équilibre.",
        provisional: true,
      },
      {
        id: 'reflexologie',
        title: 'Réflexologie',
        description: "Une pratique manuelle de bien-être qui favorise un temps de relâchement profond et de reconnexion au corps.",
        provisional: true,
      },
    ],
  },
]
