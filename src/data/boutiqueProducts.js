/**
 * Données de démonstration du module Boutique.
 * Les prix, descriptions détaillées et produits futurs sont provisoires.
 */
export const boutiqueCategories = [
  { id: 'all', label: 'Tout' },
  { id: 'oracles', label: 'Oracles' },
  { id: 'livres', label: 'Livres' },
  { id: 'esoterique', label: 'Produits ésotériques' },
  { id: 'formations', label: 'Formations' },
]

export const boutiqueProducts = [
  { id:'oracle-lignes-temps', name:'Oracle des Lignes de Temps', category:'oracles', categoryLabel:'Oracles', eyebrow:'Création MediumIA', priceLabel:'Prix à confirmer', summary:'Un oracle pour éclairer les possibles, retrouver son axe et dialoguer avec son intuition.', description:'Présentation provisoire : un jeu pensé comme un espace de reconnexion et de lecture intuitive des chemins possibles.', highlights:['Jeu de cartes','Livret d’accompagnement','Pistes de tirages intuitifs'], artwork:'oracle', featured:true, availability:'preview' },
  { id:'le-codex', name:'Le Codex', category:'livres', categoryLabel:'Livres', eyebrow:'Livre', priceLabel:'Prix à confirmer', summary:'Un livre-passerelle pour approfondir la médiumnité consciente et poser des repères solides.', description:'Présentation provisoire : enseignements, clés de compréhension et pratiques accessibles réunis dans un ouvrage de référence.', highlights:['Format à confirmer','Contenu éditorial','Ressources complémentaires'], artwork:'codex', availability:'preview' },
  { id:'formation-mediumia', name:'Formation MediumIA', category:'formations', categoryLabel:'Formations', eyebrow:'Parcours en ligne', priceLabel:'Prix à confirmer', summary:'Un parcours progressif pour explorer ses perceptions et développer une pratique consciente.', description:'Présentation provisoire : une expérience pédagogique structurée réunissant transmission, expérimentation et intégration.', highlights:['Parcours progressif','Pratiques guidées','Espace de formation'], artwork:'formation', availability:'preview' },
  { id:'selection-aurelie-objet', name:'Objet rituel à venir', category:'esoterique', categoryLabel:'Produits ésotériques', eyebrow:'Sélection d’Aurélie', priceLabel:'À venir', summary:'Une sélection choisie avec soin pour accompagner les espaces et les pratiques.', description:'Emplacement éditorial provisoire pour une future pièce sélectionnée par Aurélie selon sa qualité, son histoire et sa provenance.', highlights:['Sélection raisonnée','Histoire de l’objet','Conseils d’utilisation'], artwork:'ritual', availability:'coming-soon' },
  { id:'selection-aurelie-collection', name:'Collection d’Aurélie', category:'esoterique', categoryLabel:'Produits ésotériques', eyebrow:'Future collection', priceLabel:'À venir', summary:'Des objets singuliers, retenus pour leur beauté, leur présence et leur sens.', description:'Emplacement éditorial provisoire : la sélection finale et les informations produit seront fournies ultérieurement.', highlights:['Pièces choisies','Quantités raisonnées','Présentation détaillée'], artwork:'aurelie', availability:'coming-soon' },
]
