# L’Arche — harmonisation visuelle

La messagerie validée reste la référence. Le logo « Lueur partagée » est conservé sans modification du symbole.

- Fil : en-tête pastel, avatars illustrés ou emoji, cartes arrondies, réactions douces ; ambiances Clair, Doux, Nuit et Brume conservées. Les questions et sujets sensibles restent sur fond clair ; ces derniers restent repliés jusqu’au choix du lecteur.
- Grand Salon : échanges collectifs avec avatars, bulles alternées, couleur personnelle et horaires explicitement fictifs. Les messages des contacts bloqués sont masqués.
- Cercles : cartes blanches, accents ciel, menthe, lavande et rose, icônes existantes ; aucune photographie décorative.
- Profil : avatar, couleur des bulles et humeur partagés avec Messages et repris dans les publications et échanges locaux. Photo indiquée comme indisponible, aucun upload. Présence invisible par défaut, humeur et statut réservés aux proches.
- Navigation : logo retenu, sélection pastel, boutons bleu nuit, focus visible et navigation mobile fixe.

Tous les choix restent en mémoire React et disparaissent au rechargement. Aucun stockage distant, appel Supabase, donnée réelle, migration ou nouvelle dépendance.

Validation : 805 tests existants ; ESLint ; build Vite ; contrôles navigateur à 1440 px et 390 px. Vérifications du consentement, blocage Fil/Salon/Messages, sujets sensibles, publication Brume, exploration/adhésion aux Cercles, identité partagée et noindex/nofollow. Messagerie : six palettes avec contraste AA, cinq avatars, humeur 60 caractères, photo désactivée, Lueur avec autorisation et limitation locale de 10 secondes, absence de signal après blocage, respect de prefers-reduced-motion, vibration facultative simulée.

Captures : `captures/harmonisation-{fil,salon,cercles,profil}-{1440,390}.png`, réalisées depuis le build local du code publié. La Preview Vercel conserve son authentification ; aucun lien de contournement n’est créé. Aucune fusion ni production.
