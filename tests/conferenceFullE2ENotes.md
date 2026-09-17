# Conférence MediumIA — contrôle E2E du 17/09/2026

Test contrôlé autorisé avant mise en Production.

- Inscription réelle sur un événement de test isolé : OK.
- E-mail transactionnel reçu : OK.
- Lien LIVE personnel généré : OK.
- Lien Zoom présent : OK.
- Carnet PDF signé généré ; objet Storage PDF présent : OK.
- Heartbeat LIVE / présence : OK.
- Envoi d'une question : OK.
- Entrée au tirage : OK.
- Tirage et rejeu idempotent : OK.
- Copilote de répétition en Preview : fallback local sécurisé exercé (aucun secret fournisseur IA attaché à Preview).
- Pass : le test E2E a découvert puis corrigé le routage `conferencePassAction` dans `rdv-config` ; test de non-régression ajouté.
- PayPal Sandbox : bloqué par la configuration d'environnement actuelle. Preview expose le même client PayPal que Production, puis l'authentification contre l'API Sandbox échoue (`paypal_auth_failed`). Aucun paiement n'a été créé ou capturé.

Nettoyage effectué après test : événement/inscription/question/tirage temporaires supprimés, jeton de répétition supprimé, fonction smoke Production remise en mode 410 disabled, bridges smoke retirés de la branche.

La vraie conférence reste en `draft`; aucune inscription publique ni aucun paiement Live n'a été déclenché.
