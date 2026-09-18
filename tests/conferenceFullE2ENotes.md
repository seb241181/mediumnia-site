# Conférence MediumIA — contrôle E2E final du 18/09/2026

Validation contrôlée sur la base TEST et la Preview Vercel avant toute mise en Production.

- Inscription participant : OK.
- E-mail transactionnel et lien LIVE personnel : OK.
- Heartbeat LIVE / présence : OK.
- Envoi des questions : OK.
- Cockpit administrateur : OK.
- Sélection « À prendre » puis « Répondue · suivante » : OK.
- Recalcul de la shortlist : OK.
- Tirage au sort et persistance du gagnant : OK.
- Pass post-conférence personnel, valable 30 jours : OK.
- PayPal Sandbox : authentification, création de commande, paiement TEST à 1 €, capture et validation : OK.
- Provisioning automatique Espace élève : accès complet, 25 modules, 365 jours : OK.
- Idempotence : rejeu de la finalisation avec le même paiement renvoie un accès déjà provisionné, sans nouvelle capture ni nouvel entitlement : OK.
- Routage `conferencePassAction` via `rdv-config` : OK.
- Contrôle administrateur d’émission des Pass après-conférence : ajouté ensuite, couvert par tests statiques/prebuild ; le paiement/provisioning qu’il alimente a déjà été validé E2E séparément.
- Schéma Pass TEST et garde concurrence/idempotence : OK.

Nettoyage final effectué :

- bypass cockpit Preview supprimé ;
- fenêtres LIVE/questions forcées en TEST supprimées ;
- raccourcis LIVE TEST supprimés ;
- endpoints et bootstrap Pass réservés aux essais supprimés ;
- endpoint de diagnostic Preview supprimé ;
- fonctions Edge TEST redéployées avec les règles normales ;
- inscription E2E courante, Pass, questions, participation au tirage et entitlement Sandbox du test final supprimés ;
- tirage TEST remis au statut `scheduled` avec sa fenêtre officielle ;
- offre Pass TEST remise désactivée.

État Production après GO explicite du 18/09/2026 :

- PR #29 fusionnée sur `main` ;
- déploiement Vercel Production validé `READY` après correction du test dépendant de `VERCEL_ENV` ;
- migrations Pass checkout + concurrence/idempotence appliquées sur Supabase Production ;
- Edge Functions `conference-public` et `conference-live` redéployées avec les règles normales ;
- offre conférence configurée à 399 € TTC, prix normal 597 €, Pass valable 30 jours ;
- la conférence Production reste en `draft` et les inscriptions restent fermées ;
- aucun paiement PayPal Live n’a été effectué.
