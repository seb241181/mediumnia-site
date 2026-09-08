import fs from 'node:fs'

const file = 'src/data/reseauPractitioners.js'
const source = fs.readFileSync(file, 'utf8')

const startMarker = "  {\n    id: 'clara-sidler',"
const endMarker = "  {\n    id: 'gilda',"
const start = source.indexOf(startMarker)
const end = source.indexOf(endMarker, start)

if (start === -1 || end === -1 || end <= start) {
  throw new Error('Profil Clara introuvable dans reseauPractitioners.js')
}

const replacement = `  {
    id: 'clara-sidler',
    name: 'Clara Sidler',
    role: 'Médium · Soins énergétiques · Tarot évolutif',
    city: '',
    audience: 'À distance · domicile sur demande',
    practical: {
      audience: 'Particuliers',
      modalities: ['À distance', 'À domicile sur demande'],
      startingPrice: 'À partir de 110 €',
      email: 'contact@clarasidler.com',
    },
    services: [
      { name: 'Soin énergétique', duration: '45 min', price: '110 €' },
      { name: 'Médiumnité', price: '120 €' },
      { name: 'Tarot évolutif blanc', duration: '45 min', price: '110 €' },
    ],
    portrait: 'https://static.wixstatic.com/media/da39b6_caaaa74f390c4eedb10001d200269b23~mv2.jpg/v1/fill/w_490,h_701,al_c,q_80,enc_avif,quality_auto/da39b6_caaaa74f390c4eedb10001d200269b23~mv2.jpg',
    portraitAlt: 'Portrait de Clara Sidler, médium et praticienne holistique',
    founder: true,
    founderNumber: 4,
    membership: 'Clara Sidler · Bien-être holistique',
    introduction: "Clara Sidler vous accompagne à travers une approche holistique et intuitive, grâce aux soins énergétiques avec lecture d’aura, à la médiumnité et au tarot évolutif. Elle vous aide à libérer vos blocages, retrouver plus de sérénité, éclairer votre chemin et entrer en lien avec vos défunts ou vos guides.",
    approachTitle: 'Une approche holistique et intuitive',
    approach: "Son accompagnement associe les soins énergétiques avec lecture d’aura, la médiumnité et le tarot évolutif, dans une démarche centrée sur l’écoute, l’apaisement et la compréhension de ce qui se présente.",
    spiritualityTitle: 'Médiumnité et lien subtil',
    spirituality: "Clara propose également un accompagnement autour du lien avec les défunts ou les guides, dans une démarche intuitive et personnelle. La médiumnité, le tarot et les soins énergétiques relèvent du bien-être et de l’exploration personnelle et ne se substituent pas à un diagnostic, un traitement ou un suivi médical.",
    specialties: [
      'Médiumnité',
      'Soin énergétique',
      'Lecture d’aura',
      'Tarot évolutif',
      'Nutrition holistique',
      'Yoga',
      'Méditation pleine conscience',
      'Séances à distance',
      'Bien-être holistique',
    ],
    bookingUrl: 'https://calendly.com/clarasidler',
    externalLabel: 'Voir ses consultations',
  },
`

const next = source.slice(0, start) + replacement + source.slice(end)

if (next !== source) {
  fs.writeFileSync(file, next)
}
