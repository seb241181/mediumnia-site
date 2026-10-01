# Test Sandbox · arrhes d'un RDV annulé → remboursement depuis l'admin

Argent fictif uniquement (PayPal Sandbox). Aucun SQL en production, aucune fusion,
aucun déploiement production, aucun remboursement live. Les données réelles
(dont celles de Sylvie) ne sont jamais lues ni modifiées par ce test.

## 0. Prérequis (bloquants)

1. **La préversion de `feat/arrhes-annulation` doit utiliser la base de TEST**
   (`wnbwhnqiulsdjcvkuwos`), comme pour `rdv-full-payment` : variables Vercel
   *Preview* propres à la branche (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
   `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`), puis redéploiement de la
   préversion. **Ne pas faire ce test sur une préversion branchée sur la base de
   production** : la réservation Sandbox créerait un vrai rendez-vous dans
   l'agenda et une ligne de +20 € (puis −20 €) dans la vraie comptabilité
   (le grand livre n'a pas de colonne « sandbox »).
2. **Migration appliquée sur la base de TEST uniquement** :
   `supabase/migrations/20260930230000_rdv_deposit_settlements.sql`.
3. La base de TEST contient le profil `sebastien-seguin`, une prestation à arrhes,
   un agenda Google de test connecté, et le compte admin peut s'y connecter.
4. Un compte acheteur **PayPal Sandbox** (developer.paypal.com → Sandbox → Accounts).
5. Une adresse de test dédiée, par exemple `<votre adresse>+arrhes1@…`.

## 1. Scénario

| # | Action (navigateur connecté à Vercel, sur la préversion) | Attendu |
|---|---|---|
| 1 | `/rdv/sebastien-seguin` : réserver une prestation à arrhes avec l'adresse de test, payer avec le compte acheteur Sandbox | Page « Rendez-vous confirmé », arrhes 20,00 € |
| 2 | Requête **A** (ci-dessous) | 1 RDV `confirmed`, paiement `sandbox` `captured`, `settlement_status = open` |
| 3 | Annuler via le lien « annuler » de l'e-mail de confirmation (plus de 48 h avant) | Page d'annulation OK ; requête A : RDV `cancelled`, toujours `open`, **aucun remboursement** |
| 4 | `/rdv` (admin) → Comptabilité → « Arrhes des rendez-vous annulés » | Fiche du RDV de test, état « À traiter », boutons Rembourser / Transférer / Conserver |
| 5 | Ouvrir la même page dans **un 2e onglet** (ne rien cliquer) | — |
| 6 | Onglet 1 : « Rembourser 20,00 € » → montant 20,00 → **double-clic rapide** sur « Confirmer » | « Remboursement confirmé par PayPal » ; fiche « Remboursées le … » |
| 7 | Onglet 2 (resté sur l'ancien écran) : « Rembourser 20,00 € » → « Confirmer » | Refus « déjà remboursées » ; aucun appel de remboursement |
| 8 | Recharger l'onglet 1 | Plus aucun bouton ; « Remboursé 20,00 € … réf. <id PayPal> » |
| 9 | PayPal Sandbox (compte **marchand**) → Activité | Le paiement de 20,00 € apparaît **remboursé une seule fois** (20,00 €) ; même id de remboursement qu'à l'étape 8 |
| 10 | Requêtes **B**, **C**, **D** | B : 1 seule ligne `completed` ; C : +20 € arrhes et −20 € remboursement, total 0 ; D : `refund_requested`, `refund_paypal_call`, `refund_completed` |

**PENDING / unknown** : PayPal Sandbox ne produit pas ces états sans « negative
testing » (en-tête `PayPal-Mock-Response`), ce qui reviendrait à modifier le code
envoyé à PayPal. Ces cas restent couverts par les tests automatisés
(`tests/rdvDepositSettlements.test.js`) et le kit PostgreSQL ; ils ne sont pas
simulés ici.

## 2. Vérifications SQL (base de TEST, lecture seule)

Remplacer `ADRESSE_DE_TEST` par l'adresse utilisée à l'étape 1. Voir `10-verification.sql`.
