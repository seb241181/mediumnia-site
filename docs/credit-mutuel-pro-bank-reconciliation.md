# Crédit Mutuel PRO — rapprochement bancaire MediumIA (préparation)

État au 22/11/2026 : **socle de rapprochement uniquement**. Pas de compte lié, aucune lecture bancaire, aucune tâche planifiée ni action automatique sur les réservations. Ne pas confondre le moteur `lib/rdvBankReconciliation.js` avec une intégration bancaire activée.

## Fournisseur candidat

Enable Banking (AIS seulement) : https://enablebanking.com/docs/api/quick-start/ et https://enablebanking.com/docs/markets/fr/ .
Le Crédit Mutuel est documenté avec redirection d’authentification. Une application de production restreinte peut être activée avec ses propres comptes après ouverture d’un compte Enable Banking ; les conditions tarifaires de l’usage professionnel doivent être vérifiées directement auprès du fournisseur.

## À faire par le titulaire du compte (hors ChatGPT / hors dépôt Git)

1. Ouvrir https://enablebanking.com/sign-in/ avec son adresse professionnelle.
2. Créer une application **Sandbox**, puis demander/activer une application **Production restreinte** si nécessaire, liée uniquement au compte professionnel autorisé.
3. Choisir Crédit Mutuel (FR) et **accès aux informations sur les comptes (AIS / lecture seule)** ; ne pas autoriser de paiement initié (PIS).
4. S’authentifier uniquement sur la page officielle du fournisseur/de la banque. Ne jamais communiquer ici un mot de passe bancaire, code de validation, clé privée RSA, jeton ou relevé complet.
5. Confirmer les frais éventuels et les modalités de renouvellement du consentement.

## Prochaine phase de développement (non livrée)

- API serveur de connexion, callback avec vérification stricte du `state` anti-CSRF, création de session bancaire. JWT RSA signé uniquement côté serveur ; clé privée en secret Vercel, jamais dans Git ni dans le navigateur.
- Stocker les identifiants de session/compte chiffrés, les dates d’expiration, les consentements et les mouvements strictement nécessaires à la réconciliation dans une base privée, limitée au propriétaire du profil. Éviter le stockage des identifiants bancaires complets.
- Planifier une récupération quotidienne de transactions avec reprise sur pagination (`continuation_key`), gestion des erreurs, vérification des nouveaux identifiants d’un compte après renouvellement et dédoublonnage.
- Réutiliser les routes et la tâche cron Vercel existantes : vérifier la limite actuelle de fonctions serverless et ne pas créer de fonction supplémentaire sans audit.
- Faire correspondre les virements crédités et comptabilisés (`BOOK`, `CRDT`, EUR) aux références `MDIA-xxxxxxxxxxxx` **et** montants attendus, uniquement pour des demandes `pending` non expirées.
- Étape initiale : afficher « Virement identifié sur le compte — à confirmer » dans `BankTransferAdminPanel`. Aucune confirmation de réservation, écriture financière, e-mail ou événement Google automatique tant que le flux et le comportement sur des paiements réels n’ont pas été validés.
- Une demande de virement expirée, un virement sans référence, deux encaissements possibles, un montant différent ou un versement PayPal groupé exigent une vérification humaine.
- Assurer l’idempotence et l’absence de double comptabilisation entre PayPal, chèques, espèces, saisie manuelle et virements.
- Activer seulement après validation en environnement de test (TEST distinct de PRODUCTION), revue des accès, protection du flux de consentement, et tests de sécurité.

## Limites métier

La simple réception de virements bancaires n’identifie pas les paiements PayPal (virements souvent groupés) ni le détail des chèques/espèces. Les relevés bancaires ne doivent jamais servir à marquer automatiquement tous les rendez-vous comme soldés.
