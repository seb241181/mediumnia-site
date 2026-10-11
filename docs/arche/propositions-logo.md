# Trois propositions pour le logo L’Arche

Exploration locale sur `codex/arche-visuel-humain`, uniquement dans l’en-tête de la messagerie. Aucun choix définitif, aucune modification de la vitrine ou des autres écrans.

1. **Passage** : arche arrondie, ouverture intérieure dorée, point de lumière. Évoque le passage et l’accueil.
2. **Refuge** : deux courbes bleu nuit entourent une silhouette dorée. Évoque la protection et la présence humaine.
3. **A habité** : A souple, traverse courbe dorée et petit point intérieur. Garde un lien direct avec le nom.

Le nom L’ARCHE reste lisible dans sa typographie actuelle. Les symboles sont des SVG originaux intégrés au composant React, sans image IA, police externe ou nouvelle dépendance. Le carré sombre est remplacé par un symbole ouvert sur fond blanc ; la pastille de démonstration est adoucie.

Cliquer le logo dans la messagerie ouvre les trois propositions. Sélection locale, sans persistance. Échap ferme le sélecteur et replace le focus sur le logo. Aucun changement de logique sociale ou de sécurité.

Vérifié : build, ESLint des composants concernés, 14 tests L’Arche existants. Revue React : état local, composants définis au niveau du module, aucune requête ou effet supplémentaire. Chrome desktop 1440 px et mobile 390 px, requêtes externes bloquées : sélection des trois variantes, fermeture au clavier, cibles ≥44 px, aucun débordement, aucune erreur JavaScript, `noindex,nofollow` et logo initial des autres onglets conservés.

`captures/logos-comparaison.png` juxtapose les agrandissements des trois en-têtes et leurs captures complètes de la même messagerie. Les captures individuelles sont `logo-passage-interface.png`, `logo-refuge-interface.png` et `logo-habite-interface.png`.

Préférence proposée : **Passage**, pour l’association immédiate à une arche ouverte et sa simplicité à petite taille. Attendre le choix de Sébastien avant d’étendre l’identité aux autres écrans. Aucun merge, push ou déploiement.
