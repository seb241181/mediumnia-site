# PR #165 — Préparation finale de l'agenda

Date : 21 octobre 2026

## Correctifs

- Les onglets de praticien affichent le nom complet et le slug, au lieu du seul
  premier mot. Cela distingue visuellement les profils qui partageaient un premier
  mot, sans modifier leurs connexions, profils ou données.
- La confirmation de réservation sépare maintenant l'état du rendez-vous de celui
  de l'e-mail. Elle ne dit que le service d'envoi a accepté le message lorsque le
  serveur confirme cet état; en cas d'absence ou d'incertitude, elle indique que le
  rendez-vous reste confirmé et que l'e-mail n'est pas vérifié.

## Validation

- Six tests ciblés : PASS.
- `npm test` sur clone isolé, hooks `pretest` inclus : 915/915 PASS (909 existants
  et 6 tests ajoutés).
- `npm run build` sur un clone propre : hooks `prebuild`, suite 915/915, build Vite,
  vérification bundle ChronoSphère et pré-rendu des 30 pages : PASS.
- Avertissement Vite non bloquant : chunks `index` et `RdvDashboard` supérieurs à
  500 kB minifiés.
- Le premier enchaînement `npm test` puis `npm run build` dans le même clone a échoué
  car un script `apply-*` refuse une seconde réécriture. Le build validant a été lancé
  depuis un clone propre afin que chaque préparation ne s'exécute qu'une fois.

## Vulnérabilités de développement

Le dernier rapport `npm audit` en ligne précédemment consigné indiquait 7 avis
(5 high, 2 moderate), tous dans la chaîne de développement : `tailwindcss@3.4.19`,
puis `braces`, `chokidar`, `fast-glob`, `micromatch`, `postcss-nested` et
`postcss-selector-parser`. L'ancien audit `npm audit --omit=dev` était à zéro.

Pendant cette reprise, le registre npm était inaccessible par DNS. Un audit hors ligne
qui retourne zéro sans pouvoir interroger les avis actuels ne constitue pas une preuve
de résolution. Les risques runtime sont limités par le caractère dev-only, mais les
dépendances interviennent dans les builds et doivent rester dans le périmètre de la
sécurité de chaîne d'approvisionnement.

Les avis amont actuels confirment deux limites à traiter avec prudence : `braces` <=
3.0.3 est concerné par un débordement de pile et l'advisory ne donne aucun numéro de
version corrigé; `postcss-selector-parser` avant 7.1.6 a un chemin de complexité
quadratique, corrigé en 7.1.6. La version 6.x tirée par `postcss-nested` ne doit pas
être forcée vers 7.x sans validation de compatibilité. L'exposition décrite est un
risque de disponibilité si des motifs/ sélecteurs contrôlés par un attaquant sont
traités; ici ces outils servent au build sur le code du dépôt, pas aux requêtes client.

Plan proportionné : relancer `npm audit` frais lorsque le registre est accessible;
appliquer les seuls patchs semver non majeurs que l'audit confirme pour PostCSS/Vite;
garder Tailwind 3, ne pas forcer les deux dépendances ci-dessus et isoler le build à
des sources de confiance. Réévaluer après publication d'un correctif `braces` ou d'une
chaîne Tailwind 3 compatible avec `postcss-selector-parser` >= 7.1.6. Une migration
Tailwind 4 n'est pas démontrée nécessaire. Aucun correctif de dépendances n'est inclus.

## Périmètre et état

Aucun secret ni donnée de réservation TEST n'est ajouté. Aucun envoi d'e-mail,
paiement, opération Google, migration ou changement Production n'est effectué. Ce
rapport et le commit préparé ne valent ni fusion ni autorisation de Production.

Avant la décision de fusion : revue du diff final et validation du Preview TEST
construit depuis le commit exact. La PR #165 reste en brouillon; Production NO-GO.
