# Base de connaissance Mediumia — mode d'emploi

Ce dossier contient le **contenu pédagogique à jour** de la formation MEDIUMIA, découpé **un fichier par module**, pour que Mediumia ne charge que ce dont elle a besoin.

## Contenu
- `_STRUCTURE.md` — la carte de la formation (légère, à charger en permanence).
- `module-01.md` … `module-25.md` — le texte intégral de chaque module.
- `introduction.md`, `lexique.md` — l'avant-propos et le glossaire.
- `modules.json` — le même index sous forme structurée (id, module, niveau, titre, sous-titre, fichier, nb de mots), pratique pour charger les fichiers par programme.

## Comment l'utiliser (chargement sélectif)
L'idée que tu as eue est la bonne : **ne pas tout relire à chaque fois**.

1. Mediumia garde toujours en contexte `_STRUCTURE.md` (≈ 1 page).
2. Quand l'élève pose une question ou mentionne un module, Mediumia identifie le bon `module-NN.md` via la structure, et **ne charge que celui-là** (plus, au besoin, les modules voisins).
3. Pour une recherche transversale (« où parle-t-on de l'ancrage ? »), indexer chaque `.md` séparément dans un petit moteur de recherche / RAG : chaque module devient un document récupérable indépendamment.

Concrètement, dans l'app : place ces fichiers dans le dossier de connaissance (ex. `src/knowledge/` ou `public/modules/`), et fais pointer le chargeur vers `modules.json` pour ouvrir le bon `.md` à la demande.

## ⚠ Important — l'ancienne structure était périmée
La structure précédente de Mediumia (anciens titres type « L'éthique du médium », « La médiumnité de plateau », niveaux « L'Éveil / La Pratique / La Maîtrise », découpage 7-12 / 13-19 / 20-25) **ne correspond plus à la formation**. Elle doit être **remplacée** par `_STRUCTURE.md`. Sinon Mediumia renverra l'élève vers de mauvais numéros de module.

Les vrais niveaux sont : **N1 Les Fondations (1-6) · N2 La Technique du Canal (7-13) · N3 Maîtrise et Autonomie (14-20) · N4 L'Art du Médium Maître (21-25).**

## Format
Markdown propre (texte seul, sans images, titres et exercices ✦ / encarts ⚠ préservés). Universel : exploitable tel quel pour du prompt, du RAG, ou converti en JSON. Si ton app attend un autre format précis (objet JS, base vectorielle, etc.), dis-le-moi et je l'adapte.
