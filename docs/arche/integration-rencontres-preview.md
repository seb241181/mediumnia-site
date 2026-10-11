# Intégration Rencontres — Preview privée

Branche : `integ/arche-rencontres-preview`, créée depuis le commit visuel `b6a34395`. Travail Rencontres intégré depuis `40051cb6` (`feat/arche-rencontres-20261011`). Le conflit dans ArcheSocialPrototype a été résolu en conservant les composants et styles visuels validés, puis en raccordant Rencontres explicitement. Aucun changement esthétique supplémentaire.

## Parcours

- iPhone : Fil, Cercles, Rencontres, Messages, Moi. Le Grand Salon est accessible directement par le bouton « Ouvrir le Grand Salon » dans Cercles. Sur ordinateur, les six rubriques restent distinctes.
- Rencontres reste volontaire, avec confirmation fictive de majorité et choix explicite des cinq intentions. Découverte, fiches, demandes, acceptation, ignorance, refus, signalement, blocage, masquage du profil et départ restent disponibles.
- Une acceptation rend la personne accessible dans « Mes conversations ». Les fiches redirigent vers Messages ; aucun champ de mini-messagerie subsiste dans Rencontres.
- Consentements, historiques et blocages sont partagés en mémoire React, par identifiant stable. Les publications et messages collectifs portent aussi l’identifiant de leur auteur : un pseudonyme identique ne détourne pas les règles.
- Aucune rencontre ne devient automatiquement proche. Sa présence reste privée, l’humeur personnelle n’est pas partagée avec elle et aucune Lueur n’est possible, même si l’autorisation globale des proches est activée.
- Bloquer révoque le consentement, retire le lien de la messagerie et efface son historique privé. Débloquer ne restaure ni lien ni historique. Masquer le profil Rencontres ou quitter l’espace conserve les conversations précédemment acceptées, accessibles dans Messages.
- Aucun stockage distant ou navigateur ; le rechargement efface la simulation. Aucune vraie inscription, aucun échange réel, aucune migration, aucun backend ou appel Supabase. Le logo et noindex/nofollow restent conservés.

## Vérifications

- 822 tests unitaires réussis (815 existants intégrés + 7 tests comportementaux du modèle social partagé).
- 20 tests Playwright réussis : les 10 parcours existants adaptés à la navigation et à la messagerie commune, plus 10 vérifications/captures d’intégration. Chrome local, largeurs 390 et 1440 px ; aucun appel backend/Supabase ni erreur React. Les appels distants sont bloqués dans les fixtures.
- Build Vite, vérifications de bundle et métadonnées réussis ; ESLint sur les composants, le modèle, les données et tous les tests modifiés ; diff sans erreur d’espacement.
- Vérifications spécifiques : entrée volontaire, intentions adultes explicites, demandes entrantes/sortantes, ignorer/refuser/revenir sur sa décision, signaler avec ou sans blocage, navigation tactile, accès au Salon, messagerie partagée, présence/humeur privées, absence de Lueurs pour les rencontres, révocation après blocage et pseudonymes identiques.
- Personnalisations et Lueur des proches vérifiées : avatar, couleur, consentement entrant, limitation locale de 10 secondes et prefers-reduced-motion.

Playwright reste facultatif comme auparavant : aucune dépendance ajoutée au projet. Les tests ont utilisé le runtime Playwright déjà disponible, avec un fichier de configuration temporaire hors dépôt. Pour les reproduire avec une installation locale de @playwright/test, lancer les trois fichiers `tests/e2e/arche-*.spec.mjs` avec `ARCHE_BASE_URL` pointant sur le build local.

Captures du build local du même code publié : `captures/integration-rencontres-{390,1440}.png` et `captures/integration-messages-{390,1440}.png`. La Preview conserve l’authentification Vercel ; aucun lien de contournement. Aucun changement dans main, la PR #146 ou la production.
