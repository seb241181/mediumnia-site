# MediumIA × Crédit Mutuel PRO — procédure d'activation et sécurité

État au 22/11/2026 : **préparation sur branche GitHub / PR brouillon**. Aucun compte bancaire relié à MediumIA, aucune donnée bancaire importée, aucune transaction ni comptabilité modifiée, aucun cron quotidien installé. Ne pas fusionner en l'état.

## Ce qui est préparé en code

- Endpoint de retour : `https://mediumia.fr/api/banking/callback`, réécrit vers la fonction Vercel existante `api/rdv-config.js` (pas de nouvelle fonction).
- Démarrage réservé au propriétaire connecté : `POST /api/rdv-admin?action=bank-connection`. Récupération de statut : `GET` sur la même route.
- Fournisseur AIS seulement : `POST https://api.enablebanking.com/auth` pour démarrer, puis `POST /sessions` à l'arrivée du code.
- État aléatoire à usage unique, valable 10 minutes, consommé atomiquement côté Supabase ; code jamais affiché dans l'URL de retour du site.
- JWT signé en RS256 côté serveur, session bancaire et identifiant de compte chiffrés en AES-256-GCM avec une autre clé. Un compte professionnel uniquement, toute sélection multiple renvoyée à un examen manuel.
- Retour `review_required` : aucun encaissement confirmé, aucune écriture dans `rdv_financial_entries`, aucun événement Google modifié et aucune synchronisation bancaire en service.
- Le panneau « Virements bancaires » ne propose la connexion que si toutes les variables sont configurées et l'interrupteur est activé ; les prévisualisations Vercel sont toujours bloquées.
- Moteur de rapprochement déterministe `lib/rdvBankReconciliation.js` avec ses tests, sans appel bancaire ni mutation.
- Schéma de tables à examiner dans `docs/enable-banking-connection-schema-review.sql` (**brouillon SQL, non appliqué**). Générer ensuite la migration réelle via Supabase CLI et la tester sur TEST.

## Étapes avant activation

1. **Révoquer la clé RSA initialement partagée** dans la conversation : supprimer ou renouveler l'application Enable Banking initiale puis générer une nouvelle paire de clés. Supprimer une conversation/placer l'ancien PEM sur une clé USB ne révoque pas l'ancien secret.
2. Créer une application Enable Banking Production restreinte de remplacement, avec le **retour exact** `https://mediumia.fr/api/banking/callback`, seulement APRÈS publication du code final. Ne plus utiliser `https://example.com/callback`.
3. Mettre à jour les conditions MediumIA pour couvrir précisément la connexion bancaire et la confidentialité pour les transactions (période de conservation, destinataires, sécurité, exercice des droits). Les `/conditions-rdv` actuelles concernent les consultations, pas l'agrégation bancaire. Obtenir une revue juridique appropriée.
4. Faire valider le tarif / contrat et le cadre « Production restreinte » par Enable Banking. Ce mode sert aux comptes propres du titulaire, sous les conditions contractuelles du fournisseur. Ne pas confondre lien de compte via le panneau Enable Banking et consentement au sein de MediumIA : les deux sont requis.
5. Appliquer le schéma SQL sur la base **TEST** distincte ; vérifier RLS, privilèges, contrôle de propriété, expirations, états réutilisés et écriture après autorisation ; ne pas l'appliquer à la Production sans tests.
6. Configurer les secrets **directement dans Vercel**, jamais dans GitHub, dans le chat, dans une capture ou en pièce jointe :
   - `ENABLE_BANKING_APP_ID` — UUID de la NOUVELLE application.
   - `ENABLE_BANKING_PRIVATE_KEY_B64` — nouvelle clé RSA privée au format PEM encodée en base64 ; seulement côté serveur.
   - `ENABLE_BANKING_DATA_KEY` — nouvelle clé indépendante de 32 octets encodée en hexadécimal (64 caractères).
   - `ENABLE_BANKING_ASPSP_NAME` — nom exact de l'institution disponible dans `GET /aspsps?country=FR&psu_type=business&service=AIS`. Ne pas deviner sa chaîne.
   - `ENABLE_BANKING_CONNECT_ENABLED` et `ENABLE_BANKING_SYNC_ENABLED` — laisser `false` jusqu'au contrôle final ; jamais dans Preview.
7. Après validation complète du code déployé sur `mediumia.fr`, remplacer l'URL `https://example.com/callback` dans Enable Banking par l'URL définitive. Configurer les secrets sans les divulguer à un tiers.
8. Tester la liaison en lecture seule avec un compte professionnel réel, en mode Production restreinte et après consentement sur le portail bancaire officiel, sans donner d'identifiants à MediumIA. Vérifier que seul le compte autorisé est lié et qu'il n'y a **aucune confirmation de rendez-vous automatique**.

## Synchronisation quotidienne préparée — désactivée tant que la connexion n'est pas approuvée

- Récupération quotidienne des écritures bancaires `BOOK/CRDT` en EUR et pagination bornée `continuation_key` **implémentées dans le code**. Le cron est programmé pour 06:00 UTC mais refuse toute synchronisation sans autorisation et les variables de Production. Le renouvellement du consentement et les alertes d'échec nécessitent encore une validation opérationnelle.
- Affichage des virements identifiés et activation volontaire dans le panneau administrateur implémentés. Un crédit identifié reste **à confirmer manuellement** avant toute écriture financière ou réservation.
- Examen des chèques, virements non identifiables et versements PayPal groupés séparément.
- Distinguer le compte **PRO** des autres comptes ; le système doit refuser un doute de correspondance.
- Tests de bout en bout et audit de sécurité, puis autorisation explicite du titulaire avant mise en service.


## Deux étapes d'autorisation distinctes — confirmé par Enable Banking

1. **Activer en associant des comptes** dans le Control Panel Enable Banking : cette étape autorise le fournisseur à reconnaître/whitelister le compte propre de l'utilisateur et change l'application de `Inactive` à `Active (restricted)`. Elle ne nécessite pas encore que le callback MediumIA soit déployé. Elle **ne crée pas** de session bancaire accessible à MediumIA.
2. **Consentement à la connexion MediumIA** après publication et configuration : lancement `POST /auth` par la fonction serveur MediumIA, authentification auprès de la banque, retour sur `/api/banking/callback`, échange du `code` contre un `session_id` via `POST /sessions`. La connexion ne doit jamais être considérée comme établie seulement à l'étape 1.

Cette séparation est documentée : https://enablebanking.com/docs/api/linked-accounts .

**Conditions commerciales :** une application Production restreinte utilisée par une entreprise est réservée à l'évaluation, pas à un usage professionnel permanent. Pour un usage de comptabilité récurrente sous licence commerciale, prévoir l'accord contractuel du fournisseur ; voir https://enablebanking.com/terms/ .

**Clés et sécurité :** l'application actuelle reste conservée à la demande du titulaire, mais la clé RSA précédemment partagée ne doit pas être copiée depuis le chat vers un serveur. Toute mise en service technique reste désactivée et exige un secret sain configuré directement par le propriétaire, sans divulgation dans cette discussion.

## Documents officiels

- https://enablebanking.com/docs/api/reference/
- https://enablebanking.com/docs/api/control-panel/
- https://enablebanking.com/docs/api/linked-accounts

**Consigne permanente : ne jamais réutiliser la première clé .pem partagée dans ChatGPT.**
