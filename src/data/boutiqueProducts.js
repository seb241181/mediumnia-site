/**
 * Données du module Boutique.
 * Les prix, descriptions détaillées et produits futurs sont provisoires.
 * L'Écho des Fées — boutique d'Aurélie Seguin — logo à intégrer (fichier en attente).
 */
export const boutiqueCategories = [
  { id: 'all', label: 'Tout' },
  { id: 'oracles', label: 'Oracles' },
  { id: 'livres', label: 'Livres' },
  { id: 'echo-des-fees', label: "L'Écho des Fées" },
  { id: 'formations', label: 'Formations' },
]

export const boutiqueProducts = [
  { id:'oracle-lignes-temps', name:'Oracle des Lignes de Temps', category:'oracles', categoryLabel:'Oracles', eyebrow:'Création MediumIA', priceLabel:'Prix à confirmer', summary:"Un oracle pour éclairer les possibles, retrouver son axe et dialoguer avec son intuition.", description:"Présentation provisoire : un jeu pensé comme un espace de reconnexion et de lecture intuitive des chemins possibles.", highlights:["Jeu de cartes","Livret d'accompagnement","Pistes de tirages intuitifs"], artwork:'oracle', featured:true, availability:'preview' },
  { id:'le-codex', name:'Le Codex', category:'livres', categoryLabel:'Livres', eyebrow:'Livre · MediumIA', priceLabel:'Prix à confirmer', summary:"Un livre-passerelle pour approfondir la médiumnité consciente et poser des repères solides.", description:"Présentation provisoire : enseignements, clés de compréhension et pratiques accessibles réunis dans un ouvrage de référence.", highlights:["Format à confirmer","Contenu éditorial","Ressources complémentaires"], artwork:'codex', availability:'preview' },
  { id:'formation-mediumia', name:'Formation MediumIA', category:'formations', categoryLabel:'Formations', eyebrow:'Parcours en ligne', priceLabel:'Prix à confirmer', summary:"Un parcours progressif pour explorer ses perceptions et développer une pratique consciente.", description:"Présentation provisoire : une expérience pédagogique structurée réunissant transmission, expérimentation et intégration.", highlights:["Parcours progressif","Pratiques guidées","Espace de formation"], artwork:'formation', availability:'preview' },
  { id:'echo-des-fees-objet', name:'Objet de la sélection', category:'echo-des-fees', categoryLabel:"L'Écho des Fées", eyebrow:"L'Écho des Fées · Aurélie Seguin", priceLabel:'À venir', summary:"Une pièce choisie avec soin pour accompagner les espaces et les pratiques — sélectionnée selon sa qualité, son histoire et sa provenance.", description:"Emplacement éditorial provisoire pour une future pièce de la boutique L'Écho des Fées, sélectionnée par Aurélie Seguin.", highlights:["Sélection raisonnée","Histoire de l'objet","Conseils d'utilisation"], artwork:'ritual', availability:'coming-soon' },
  { id:'echo-des-fees-collection', name:"Collection L'Écho des Fées", category:'echo-des-fees', categoryLabel:"L'Écho des Fées", eyebrow:"L'Écho des Fées · Aurélie Seguin", priceLabel:'À venir', summary:"Des objets singuliers, retenus pour leur beauté, leur présence et leur sens — des choix qui résonnent vraiment.", description:"Emplacement éditorial provisoire : la sélection finale et les informations produit de la boutique L'Écho des Fées seront fournies ultérieurement.", highlights:["Pièces choisies","Quantités raisonnées","Présentation détaillée"], artwork:'aurelie', availability:'coming-soon' },
]
