# L’Arche — proposition artistique de la messagerie

Base : PR #146, commit `e73df1a1deccb77cd7d4069e4688b30339970557`.
Branche locale : `codex/arche-visuel-humain`.
Statut : proposition à valider par Sébastien. Ne pas généraliser aux autres espaces avant son GO. Aucun merge, push ou déploiement effectué.

## Le langage proposé

Une messagerie sociale contemporaine qui retrouve le plaisir des contacts et des couleurs : panneau de rencontres bleu ciel, en-tête lavande, avatars illustrés originaux, humeur et présence discrètes. Les bulles reçues sont menthe ; la personne choisit la couleur de ses propres bulles parmi lavande, ciel, rose et menthe. La Lueur occupe une place dans l’en-tête, avec un accent or doux.

Les icônes de navigation existantes restent en place. Les coins arrondis, les séparateurs et les ombres donnent du relief aux panneaux. L’apparition des bulles est discrète et respecte la préférence de réduction des animations. Aucun élément propriétaire MSN/Facebook, aucune photographie, aucune ambiance florale.

Sur ordinateur, la barre supérieure, le menu gauche et les contacts à droite sont conservés. La messagerie montre les rencontres à gauche et une conversation plus large à droite. Sur mobile, la liste et la conversation occupent successivement la largeur de l’écran ; le bouton retour ramène aux rencontres et la navigation inférieure reste accessible.

## Périmètre et garde-fous

Seule `MessagesView` est retravaillée, avec un composant d’avatar propre à cet écran et une feuille CSS ciblée. Le Fil, le profil, le Salon, les Cercles, la vitrine et la connexion conservent leur version validée. Un deuxième message explicitement fictif complète le scénario de démonstration ; aucun compteur ni timestamp d’activité prétendument réel n’est ajouté.

L’invitation doit toujours être acceptée avant d’écrire ou d’envoyer une Lueur. Le consentement du destinataire, la réception désactivée par défaut, le délai entre les Lueurs, le blocage et le signalement conservent leur logique. Les contrôles sont regroupés dans « Consentement et protections », accessible sous le fil de conversation. Les interactions et le choix de couleur restent en mémoire locale et disparaissent au rechargement.

Aucune dépendance ajoutée, aucune donnée réelle, aucun stockage navigateur, aucune migration, aucun appel à Supabase. La route garde `noindex,nofollow` et l’exclusion du compte flottant et du Guardian.

## Vérification

- Build Vite réussi après les scripts de préparation habituels du dépôt ; aucun déploiement.
- Suite existante : 805 tests réussis, 0 échec. Exécutée sur une copie temporaire sans espace dans le chemin, car deux tests existants utilisent une URL de fichier non décodée et échouent sinon sur « New project ».
- ESLint du composant modifié : réussi.
- Chrome automatisé, 390 × 844 et 1440 × 1000 : aucune erreur JavaScript, aucun débordement horizontal, boutons visibles de la messagerie ≥ 44 × 44 px.
- Vérification réelle des invitations, du changement de palette, de la persistance entre onglets, de la Lueur, de la réception désactivée et du blocage/signalement.
- Requêtes externes et API bloquées avant navigation ; seule une tentative de chargement de police Google a été interceptée, aucun appel à Supabase observé.

Les scripts de préparation produisent des modifications de sources sur plusieurs routes : ces changements générés ont été retirés du diff final. Seule la passe de messagerie et sa documentation restent dans la proposition.

## Captures

- `captures/messagerie-1440.png` : conversation ouverte sur ordinateur.
- `captures/messagerie-390.png` : conversation ouverte, format iPhone 390 × 844.
- `captures/contacts-390.png` : liste des rencontres sur iPhone.
- `captures/invitation-1440.png` et `captures/invitation-390.png` : consentement avant ouverture de la conversation.

La conversation montrée est un scénario fictif accepté dans le navigateur de test. L’état initial du prototype reste une invitation en attente.
