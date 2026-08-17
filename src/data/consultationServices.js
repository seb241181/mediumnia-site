/**
 * Contenus du module Consulter.
 * Portraits et tarifs définitifs à confirmer avant publication.
 */
export const consultationPractitioners = [
  {
    id: 'sebastien-seguin',
    firstName: 'Sébastien',
    name: 'Sébastien Seguin',
    role: 'Médium professionnel · Fondateur de MediumIA',
    eyebrow: 'Médiumnité & guidance',
    portrait: '/sebastien.jpg',
    portraitAlt: 'Portrait de Sébastien Seguin',
    introduction: "Médium professionnel depuis plus de douze ans, Sébastien Seguin a construit MediumIA à partir de milliers de séances, de rencontres et de ressentis confrontés au réel. Ses consultations offrent une présence attentive pour explorer les perceptions, mettre en lumière ce qui se présente et avancer avec davantage de clarté.",
    intention: 'Médiumnité, guidance intuitive et accompagnement autour des perceptions.',
    detailsLabel: 'Découvrir les consultations',
    statusLabel: 'Tarifs et modalités à confirmer · Réservation bientôt disponible en ligne',
    reservationUrl: 'https://sebastien-seguin.reservio.com',
    accent: 'deep',
    services: [
      {
        id: 'consultation-mediumnite',
        title: 'Consultation de médiumnité',
        description: "Un temps d'échange autour des ressentis, des perceptions et des messages qui émergent — une pratique de plus de douze ans au service de votre chemin.",
      },
      {
        id: 'guidance-intuitive',
        title: 'Guidance intuitive',
        description: "Un espace pour éclairer une situation, prendre du recul et écouter ce qui cherche à se dire.",
      },
      {
        id: 'accompagnement-a-preciser',
        title: 'Autres accompagnements',
        description: "Des formats complémentaires pourront être proposés après finalisation de l'offre.",
        provisional: true,
      },
    ],
  },
  {
    id: 'aurelie-seguin',
    firstName: 'Aurélie',
    name: 'Aurélie Seguin',
    role: "Praticienne bien-être · L'Écho des Fées",
    eyebrow: 'Corps & équilibre émotionnel',
    portrait: null,
    portraitAlt: 'Portrait d\'Aurélie Seguin à venir',
    introduction: "Aurélie Seguin propose une approche chaleureuse qui relie l'écoute du corps, l'équilibre émotionnel, la détente et l'accompagnement intuitif dans un cadre dédié au bien-être — au travers de sa boutique et univers L'Écho des Fées.",
    intention: "Des pratiques complémentaires réunies par une même qualité d'écoute et de présence.",
    detailsLabel: "Découvrir l'univers d'Aurélie Seguin",
    statusLabel: 'Prestations et modalités en cours de finalisation',
    accent: 'gold',
    services: [
      {
        id: 'soin-energetique-intuitif',
        title: 'Soin énergétique intuitif',
        description: "Une pratique de bien-être orientée vers la détente, la présence à soi et l'écoute des ressentis.",
        provisional: true,
      },
      {
        id: 'eft',
        title: 'EFT',
        description: 'Une approche d\'accompagnement émotionnel utilisant des points de stimulation corporelle.',
        provisional: true,
      },
      {
        id: 'reflexologie',
        title: 'Réflexologie',
        description: 'Une pratique de bien-être manuelle favorisant un temps de relâchement et de reconnexion au corps.',
        provisional: true,
      },
    ],
  },
]
