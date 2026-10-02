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

Préversion : `https://mediumia-site-git-feat-arrhes-aa5694-seguins-projects-a1d4673f.vercel.app`
(base TEST, PayPal Sandbox, calendrier TEST `dqigmitrta6nsllgaikm7dqvuc@group.calendar.google.com`).

**Ne pas toucher l'ancienne arrhe TEST annulée du 17 septembre** : elle date d'avant
ces développements (autre version du code, peut-être une autre application PayPal
Sandbox). On la laisse « À traiter » et on fait un scénario neuf, identifié par une
adresse dédiée, par exemple `<votre adresse>+arrhes1001@…`.

| # | Action | Attendu |
|---|---|---|
| 1 | Navigation privée, `/rdv/sebastien-seguin` → « TEST Guidance » (70 €) → un créneau **au moins 7 jours plus tard** (ex. jeudi 8 octobre 2026, 10:00) → coordonnées avec l'adresse dédiée → option **arrhes 20 €** (pas le paiement intégral) → cases de consentement → PayPal → compte **acheteur Sandbox** | Page « Rendez-vous confirmé », arrhes 20,00 €, solde 50,00 € ; événement créé dans le calendrier TEST |
| 2 | Requête **A** | 1 RDV `confirmed`, paiement `sandbox` `captured` 2000, `settlement_status = open` ; requête C : 1 ligne `arrhes` +2000 |
| 3 | E-mail de confirmation (adresse dédiée) → lien « annuler » → confirmer | Page d'annulation OK ; requête A : RDV `cancelled`, `cancel_reason = client_self_service`, paiement toujours `open`, **aucune ligne** en requête B ; événement retiré du calendrier TEST |
| 3 bis | *Seulement si l'e-mail n'arrive pas* : annulation équivalente sur la base TEST (`11-annulation-secours.sql`) | Même état qu'à l'étape 3 |
| 4 | Navigation normale, connecté admin : `/rdv` → Comptabilité → « Arrhes des rendez-vous annulés » | Nouvelle fiche « TEST Guidance · 8 octobre… », état « À traiter », réf. PayPal Sandbox, boutons Rembourser / Transférer / Conserver |
| 5 | Ouvrir `/rdv` dans un **2e onglet**, descendre jusqu'à la même fiche, **ne rien cliquer** | — |
| 6 | Onglet 1 : « Rembourser 20,00 € » → montant 20,00 → **double-clic rapide** sur « Confirmer » | « Remboursement confirmé par PayPal. » ; fiche « Remboursées le 1er octobre 2026 », ligne « Remboursé 20,00 € … réf. <id> » |
| 7 | Onglet 2 (périmé) : « Rembourser 20,00 € » → « Confirmer » | Message « Ces arrhes sont déjà remboursées. » ; aucun nouvel appel PayPal |
| 8 | Recharger les deux onglets | Plus aucun bouton sur la fiche ; l'ancienne arrhe du 17/09 reste inchangée |
| 9 | sandbox.paypal.com, compte **marchand** Sandbox → Activité → le paiement de 20,00 € | **Un seul** remboursement de 20,00 €, même id qu'à l'étape 6 |
| 10 | Requêtes **B**, **C**, **D** | B : 1 seule ligne `completed`, `attempt_count = 1` ; C : `arrhes` +2000 et `refund` −2000, total 0 ; D : `refund_requested` → `refund_paypal_call` → `refund_completed` |

**`kdp_lookup_error` dans la comptabilité TEST** : la table `kdp_income_reports`
(revenus livres) n'existe pas sur la base TEST. Seul le tableau mensuel est en
erreur ; l'encart « Arrhes des rendez-vous annulés » a son propre appel et le
remboursement ne lit jamais cette table. Indépendant du test : la contre-écriture
se vérifie avec la requête C.

**PENDING / unknown** : PayPal Sandbox ne produit pas ces états sans « negative
testing » (en-tête `PayPal-Mock-Response`), ce qui reviendrait à modifier le code
envoyé à PayPal. Ces cas restent couverts par les tests automatisés
(`tests/rdvDepositSettlements.test.js`) et le kit PostgreSQL ; ils ne sont pas
simulés ici.

## 2. Vérifications SQL (base de TEST, lecture seule)

Remplacer `ADRESSE_DE_TEST` par l'adresse utilisée à l'étape 1. Voir `10-verification.sql`.
