# Essai artistique du Fil — carnet de liens

Une seule direction : une page de conversation avec un rythme éditorial, plutôt qu’une suite de panneaux pastel. Fond blanc chaud, titre en Georgia déjà disponible sur l’appareil, détails ocre et bleu nuit. Pas de police ou dépendance ajoutée, de photographie, ni de génération d’image.

Le grand bandeau a disparu. La rédaction tient sur une ligne, avec les quatre ambiances et les formats accessibles. À 390 px, la première publication commence à 311 px et la seconde est déjà visible dans le premier écran. Les ambiances sont des aplats : Clair blanc, Doux pêche, Brume gris bleuté, Nuit bleu nuit. Les questions gardent un filet ocre et les sujets sensibles restent repliés sur fond clair. Les publications courtes ont une typographie plus expressive, les questions une lecture plus directe.

Les contacts fictifs du Fil et de sa colonne de proches ont des monogrammes distincts, avec des formes et couleurs sobres. L’avatar personnalisé du membre reste conservé. Les statuts restent réservés aux proches.

Périmètre : Fil et apparence de sa navigation/colonne de proches seulement. Le logo Lueur partagée, Messages, Salon, Cercles et Profil conservent leur design. Aucun travail sur Rencontres, aucune fusion de sa branche, backend, Supabase, donnée réelle ou production.

Validation : build, 805 tests existants, ESLint ; navigateur 390 et 1440 px. Cibles tactiles au moins 44 px, aucun débordement horizontal, réactions, signalement simulé, blocage, sujets sensibles, création Nuit et retour à Clair pour les textes longs, noindex/nofollow. Comparaison avec le commit précédent : composants Messages, Profil, Salon et Cercles strictement inchangés ; protections de Messages couvertes par les tests existants.

Captures du build local correspondant au code publié : `captures/fil-carnet-390.png` et `captures/fil-carnet-1440.png`. Versions complètes également conservées. La Preview conserve l’authentification Vercel.
