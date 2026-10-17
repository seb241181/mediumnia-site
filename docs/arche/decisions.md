# L’Arche — Décisions du fondateur et limites de la maquette

Mise à jour : 10 octobre 2026. **Document de travail**, pas un ordre d’ouverture publique. Les accords consignés proviennent des échanges de Sébastien et de son retour de revue avec Claude.

## Vision
- Communauté sociale gratuite liée à l’écosystème MediumIA, mais distincte d’une plateforme de consultations.
- Accueillir personnes croyantes, curieuses et sceptiques ; ne pas classer les personnes selon un degré d’éveil.
- Trouver l’esprit convivial de MSN Messenger et la facilité d’usage de Facebook, sans reprendre leurs marques, ressources graphiques, sons ou animations.
- Nom « L’Arche » **provisoire**. Recherche de disponibilité du nom (INPI, EUIPO, associations, domaines) avant une communication publique d’envergure ; symbole / logo propre encore en réflexion.
- Entretien téléphonique ABC Talk **12 novembre 2026**, simple prise de contact, pas un passage à l’antenne.

## Architecture produit approuvée pour la conception
1. Page publique discrète de découverte : explications + petite sélection de contenus volontairement publics, jamais le contenu des conversations privées ni les profils des membres.
2. Connexion MediumIA gratuite (compte existant ou nouveau), adhésion *distincte et facultative* à L’Arche avec acceptation de la charte.
3. Application après la connexion, distincte visuellement de la page vitrine : **Le Fil** (publications / réponses), **Le Grand Salon** (chat en direct), **Les Cercles** (thèmes), **Mes Rencontres** (contacts et messages privés), **Mon profil**.
4. Profil sous pseudonyme ; bio et centres d’intérêt facultatifs ; photo personnelle **facultative**, avatar proposé par défaut.
5. Fiches personnelles visibles uniquement par les membres ayant adhéré à L’Arche, pas par tout utilisateur MediumIA ; pas d’indexation des profils.
6. Demandes de contact ouvertes entre membres, mais conversation privée **uniquement après acceptation**, avec limites anti-spam, blocage et signalement.
7. Présence sociale façon MSN : disponible, absent, occupé, invisible. **Invisible par défaut**, aucune obligation d’afficher dernière activité.
8. « Toc toc » : clin d’œil original, opt-in / réglage désactivable, uniquement entre contacts acceptés, avec limitation stricte et animation compatible réduction des mouvements. Vibration matérielle seulement si supportée par le navigateur et l’appareil. Le nom / l’effet ne copient pas les marques MSN.
9. Cercles proposés par les membres, modérés et validés par l’équipe avant création (proposition produit à confirmer avec Sébastien ; non présumée approuvée définitivement).
10. Aucun système de compétition d’éveil, faux membres, compteurs artificiels ni démarchage de services spirituels.

## Sécurité et lancement — décisions discutées avec Claude
- Pilote réservé aux **adultes de 18 ans et plus** avec déclaration de majorité, traitement des signalements de minorité.
- **Premier pilote de 4 à 6 semaines sans messagerie privée réelle** ; le salon et le fil passent en premier. Les démonstrations de MP ne comptent pas comme ouverture.
- IA modératrice **assistante**, pas décideur autonome d’exclusion : tri des publications, alerte et mise en attente des cas manifestement graves, droit au recours et décision humaine documentée. Ne pas lire les MP par défaut ; uniquement les messages explicitement signalés selon une procédure contrôlée.
- Signalement facile, bouton de blocage, protocole de crise et dispositifs de prévention de démarchage / fraude ; bénévoles formés ou modération humaine effective avant le pilote.
- Les praticiens de l’annuaire peuvent participer sous conditions de non-démarchage ; leur éventuelle mention professionnelle reste discrète sur la fiche et jamais un avantage dans le fil.
- Photo si activée : stockage privé, suppression des EXIF/GPS, revue appropriée, liens temporaires, signalement d’image ; aucune publication automatique.
- Après blocage : conversation fermée et masquée pour les deux parties ; preuve de modération séparée avec accès restreint et délai de conservation à justifier.
- Supabase : schéma communautaire dédié avec protections RLS, fonctions serveur contrôlées, modération auditée, tests multi-comptes uniquement en TEST avant toute migration réelle.
- Avant toute ouverture : gouvernance RGPD, conditions d’utilisation, politique de confidentialité, éventuelle AIPD selon analyse du risque, obligations légales plateformes à confirmer.

## État du code
- PR #146 **DRAFT**, noindex, prévisualisation Vercel seulement. Aucune fusion ni mise en production autorisée.
- La connexion affichée et l’application sociale sont des **simulations locales**. Aucun compte MediumIA n’est authentifié ni créé via L’Arche, les actions n’atteignent pas Supabase, aucune publication ou MP réelle.
- Les profils et messages affichés sont des exemples fictifs ; les saisies ne sont pas conservées après fermeture.
- Le « Toc toc » peut déclencher un appel navigateur à navigator.vibrate() **uniquement après clic**, mais sa prise en charge n’est pas garantie, notamment sur iOS.

## Non décidé / garde-fous
- Nom et symbole définitifs, dates de pilote et sortie publique.
- Qui assure effectivement les plages de modération et l’escalade de crise.
- Coût, fournisseur et contrat de sous-traitance pour le modèle de modération IA.
- Mentions RGPD détaillées, politique de conservation et contrôle des contenus sensibles.
- Activation d’un vrai compte connecté ou d’un vrai chat en dehors de TEST.

**Aucun GO PROD, aucune migration Supabase et aucun lancement public ne sont inclus dans ces décisions.**
