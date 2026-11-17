# Correctif MediumIA — incidents Resend et accès client

Suivi : #219. Branche isolée `fix/mediumia-resend-otp-delivery`.

## Constat confirmé
- `api/rdv-config.js` route `accountAction` vers `lib/accountApiHandler.js`.
- `requireVerifiedAccount` vérifie le bearer token Supabase et `email_confirmed_at` avant toute lecture de rendez-vous.
- Les e-mails Resend rejetés peuvent placer des adresses en suppression; un rendez-vous confirmé n'implique pas une connexion réussie.
- Treize suppressions ont été retirées par intervention autorisée le 17 novembre 2026. Ne pas automatiser cette suppression.

## Ordre d'implémentation
1. Localiser le formulaire d'inscription/connexion et ses appels Supabase Auth OTP. Identifier le chemin de livraison (Supabase SMTP personnalisé ou Resend API), les réponses et les états UI.
2. Ajouter des erreurs utilisateur non trompeuses (envoi impossible, adresse à vérifier, réessayer), sans fuite sur l'existence d'un compte; limiter les demandes OTP.
3. Journaliser les erreurs d'envoi et corréler aux événements Resend par ID de message; éviter de journaliser OTP, tokens ou données privées.
4. Ajouter un webhook Resend vérifiant la signature et l'idempotence pour `email.bounced`, `email.failed`, `email.suppressed`, `suppression.added`. La gestion de la plainte et des bounces doit rester protectrice.
5. Afficher les incidents au praticien avec une action de résolution manuelle et des conseils de correction d'adresse.
6. Tester en TEST avec des événements simulés, un compte non vérifié et un compte vérifié. Ne pas modifier les réservations ni les paiements en Production.
7. Revoir les résultats, puis déployer avec contrôle de bon fonctionnement et plan de retour arrière.

## Critères bloquants
- Aucune donnée client lisible sans adresse vérifiée.
- Un OTP non livré ne doit jamais être présenté comme reçu.
- Aucun déblocage automatique des plaintes ni désactivation globale de la protection Resend.
- Aucun webhook public accepté sans signature valide.
