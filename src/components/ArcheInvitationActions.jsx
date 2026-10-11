// Réponses à une invitation, communes à tout L’Arche (Rencontres aujourd’hui, Messages à l’intégration).
// Aucune de ces actions ne communique de motif à l’autre personne, et aucune n’ouvre de message libre.
// - Accepter : la conversation s’ouvre.
// - Ignorer : rien n’est envoyé ; l’invitation reste consultable plus tard.
// - Refuser : l’autre voit seulement que l’invitation n’a pas abouti et ne peut pas relancer ;
//   seule la personne qui a refusé peut revenir sur sa décision.
// - Bloquer et signaler : ouvre le choix du motif de signalement, blocage coché par défaut.
const primary = 'min-h-11 rounded-full bg-[#1A1535] px-5 py-2 text-sm font-semibold text-white transition hover:bg-[#2B254D]'
const secondary = 'min-h-11 rounded-full border border-[#ECEAF2] bg-white px-4 py-2 text-sm font-semibold text-[#1A1535] transition hover:bg-[#FAFAF7]'

export default function ArcheInvitationActions({ name, onViewProfile, onAccept, onIgnore, onRefuse, onBlockAndReport }) {
  return <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label={'Répondre à l’invitation de '+name}>
    {onViewProfile && <button type="button" className={secondary} onClick={onViewProfile}>Voir son profil</button>}
    <button type="button" className={primary} onClick={onAccept}>Accepter</button>
    <button type="button" className={secondary} onClick={onIgnore}>Ignorer</button>
    <button type="button" className={secondary} onClick={onRefuse}>Refuser</button>
    <button type="button" className={secondary} onClick={onBlockAndReport}>Bloquer et signaler</button>
  </div>
}
