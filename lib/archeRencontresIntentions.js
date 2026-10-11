// Choix courts de la maquette, reliés aux intentions historiques sans stockage.
export function intentionsForChoice(choice) {
  const friendship = ['amitie', 'echanges', 'binome']
  const love = ['coeur', 'amour']
  return choice === 'amitie' ? friendship : choice === 'amour' ? love : choice === 'both' ? [...friendship, ...love] : []
}
