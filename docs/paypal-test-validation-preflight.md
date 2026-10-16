# PR #156 - synchronisation et controle prealable TEST

## Synchronisation

Correctif preserve : 6dd3a7e1169cf4d54825172bbbe05247df64b529.
Main integre : 2465ba068d7935e9bcb33d8fc4deb6e92e7681fa, fusion PR #157.
Aucun conflit. Les cinq fichiers de #157 sont identiques a main avant generation npm :
RdvDashboard.jsx, DailyPayments.jsx, AccountingSection.jsx,
apply-rdv-manual-payment-ui.mjs, apply-lumia-assistant-console.mjs.
La synchronisation ne fusionne pas #156 vers main. Aucun deploiement manuel.

## Controle prealable de migration (lecture seule, 15 octobre 2026)

Cible exclusive : Supabase TEST wnbwhnqiulsdjcvkuwos.
Fichier : supabase/migrations/20261015173755_email_question_capture_claim.sql.

- La table mediumia_email_questions existe ; id UUID, status texte contraint,
  paypal_order_id et paypal_capture_id uniques. Questions JSONB conservees.
- capture_started_at est absent du catalogue information_schema.columns.
- RLS et FORCE RLS actifs ; aucun trigger utilisateur sur cette table.
- La version 20261015173755 est absente de l'historique des migrations.
  La version historique 20261014210000 n'y figure pas non plus, mais le catalogue
  confirme la table du registre webhook et les RPC claim/finish presentes :
  aucun ancien script ne doit etre reapplique automatiquement.
- ADD COLUMN IF NOT EXISTS TIMESTAMPTZ, nullable et sans DEFAULT : aucune mise a
  jour des statuts, montants, captures, questions ou contextes historiques.
- COMMENT ON est rejouable. Les essais PostgreSQL du correctif ont deja applique
  deux fois le fichier et valide le claim concurrent ; pas de repetition inutile ici.
- Aucun changement de droits, de politique RLS, d'index ni de trigger.
- Limite : ALTER TABLE prend un verrou de schema ; ce n'est pas une operation
  sans verrou. Prevoir transaction courte et lock_timeout court, puis abandon
  propre si la table est occupee. Ne jamais forcer ni boucler automatiquement.

Verdict prealable : compatible avec le schema observe, additive et idempotente.
NON APPLIQUEE. Attendre un GO explicite migration TEST.

### Procedure apres GO migration TEST seulement

1. Reconfirmer le project_id TEST et l'absence/type de la colonne.
2. Executer uniquement ce fichier, dans une transaction avec lock_timeout court.
3. Verifier colonne timestamptz nullable sans default, politiques/droits inchanges,
   aucune modification metier et historique de migration coherent.
4. Ne pas supprimer la colonne en retour arriere : conserver l'ajout sans utiliser
   le code capture tant que le resultat n'est pas valide. Ne jamais effacer un claim.
5. Arreter et demander le GO separe pour les transactions Sandbox.

## Prochain essai Sandbox propose - NON EXECUTE

Preflight obligatoire : credentials Sandbox verifies par OAuth Sandbox ; Supabase
TEST uniquement ; aucun webhook pouvant envoyer vers Production ; transport email
reel interdit et collecteur local seulement ; ventes publiques toujours suspendues.
Ne charger aucune variable ou cle du projet de production.

Une seule nouvelle commande fictive avec question(s) et contexte(s) obligatoires.
Approbation acheteur Sandbox, puis deux confirmations simultanees sur le MEME ordre.
Injecter la perte de la reponse du seul POST de capture apres execution fournisseur ;
si necessaire simuler un premier GET APPROVED en etiquetant cette observation comme
injection (et non comme etat reel constate chez PayPal).

Assertions et preuves minimales :

- Un seul POST capture sortant ; marqueur capture_started_at durable en TEST.
- GET ordre et GET capture Sandbox confirment une seule capture fictive reelle.
- Aucune reponse 409 liee a l'incertitude : 200 apres reconciliation, sinon
  503 retryable puis nouvelle confirmation en lecture GET uniquement.
- Une seule transition payment_pending -> paid et aucune nouvelle capture sur replay.
- Une seule invocation applicative de notification ; collecteur local avec cles
  stables, aucun envoi fournisseur ni contact client. Ne pas confondre cette preuve
  avec une livraison email exactement une fois apres crash.
- Questions/contextes compares avant/apres sans publier leur contenu dans le rapport.
- Demande visible dans l'administration TEST ; distinguer lecture handler et parcours
  authentifie reel si ce dernier reste bloque.
- Conserver les identifiants techniques Sandbox, compteurs et statuts sans secrets.
- A la fin, arreter le banc et effacer les secrets en memoire. Aucun relais ni bypass.

La verification d'un webhook reellement signe reste distincte et NON VALIDEE.
Les lignes historiques payment_pending ne prouvent pas l'absence d'une ancienne
capture : ne jamais les utiliser pour cet essai ni reinitialiser leurs marqueurs.

## Validation de synchronisation

npm test final : 868 reussis, 0 echec, 0 skip. Build complet reussi, comprenant
egalement les 868 tests prebuild, verification du bundle V2 et 30 pages prerendues.
Compilation avec URL Supabase TEST et cle factice, aucun secret charge ni acces metier.
Premier lancement : 866/868, deux ENOENT dus au chemin New project encode en %20.
Relance dans /private/tmp/mediumia-pr156-test-validation sans modification des tests.
Le warning de taille du bundle (>500 kB) est non bloquant et sans rapport avec PayPal.
Les scripts npm reecrivent des sources ; exclure leurs sorties du commit dans le seul
checkout isole. Aucun changement aux sources Coulisses par rapport a main n'est autorise.

Production : NO-GO. Migration TEST et transactions Sandbox : en attente de GO separes.

## Actualisation TEST du 16 octobre 2026

- Migration `email_question_capture_claim_test` appliquee sur Supabase TEST `wnbwhnqiulsdjcvkuwos`, version `20261016053730` ; aucun changement Production.
- Colonne `capture_started_at` verifiee : `timestamptz`, nullable, sans valeur par defaut.
- Test reel TEST : insertion d'une commande strictement fictive dans une transaction, premier claim acquis, deuxieme claim refuse, `ROLLBACK` reussi, controle independant : 0 residu.
- Script versionne : `tests/sql/email_question_capture_claim_rollback_test.sql`.
- Nouveau garde-fou applicatif et trois tests : plusieurs unites d'achat ou captures dans la meme commande PayPal ne peuvent pas etre validees comme une vente ordinaire.
- Staging Vercel `mediumia-pr156` exclusivement. Aucun achat PayPal Sandbox veritablement approuve lors de cette reprise, aucun webhook signe reel, aucun email client, aucune migration ou fusion Production.
- **NO-GO Production et reouverture** avant preuve du paiement Sandbox, du webhook signe, de la notification, du rapprochement historique et de la revalidation du build.

## Test Sandbox manuel via Staging protegé - 16 octobre 2026

Environnement isolé : projet Vercel `mediumia-pr156` ID `prj_o2q8ZuXcy1ilVbVbgoasAzH4Gbzx`; Supabase serveur et front pointent vers `wnbwhnqiulsdjcvkuwos`. `PAYPAL_ENV=sandbox`. Vercel Authentication reste activée ; les ventes Production restent suspendues. Le flag `EMAIL_QUESTIONS_PURCHASES_SUSPENDED=false` ne s'applique qu'à la Preview du projet dédié.

Staging vérifié READY sur `f35af2e9b65c1daa45b29b096ff3d859070b28b2` :
`https://mediumia-pr156-abuqoegva-seguins-projects-a1d4673f.vercel.app/question`

### Parcours avec un acheteur PayPal Sandbox (jamais réel)

1. Ouvrir le Staging connecté au compte Vercel autorisé ; vérifier que l'offre indique le mode d'essai avant toute approbation PayPal. Utiliser seulement une identité de démonstration, une adresse `example.invalid`, une question et un contexte fictifs.
2. Cliquer sur PayPal et utiliser exclusivement le **compte personnel acheteur Sandbox** depuis PayPal Developer > Sandbox Accounts. Ne jamais entrer ses identifiants PayPal réels.
3. Ne confirmer qu'une commande fictive ; relever l'identifiant technique d'ordre via les outils de test privés, jamais les mots de passe.
4. Vérifier que la commande est `COMPLETED` chez PayPal Sandbox, avec une seule capture et le montant attendu, puis `paid` dans Supabase TEST avec un `paypal_capture_id` unique et questions/contextes inchangés.
5. Vérifier la relecture idempotente de la confirmation (HTTP 200 sans nouveau POST) et la concurrence contrôlée uniquement avec le même ordre Sandbox. Ne jamais redemander un paiement si l'état reste incertain : rapprocher en GET.
6. Contrôler le registre `mediumia_email_question_paypal_events` et la réception d'un **véritable** webhook PayPal Sandbox avec signature vérifiable. Attention : le Webhooks Simulator PayPal génère de faux événements **non vérifiables** par `verify-webhook-signature` et ne prouve pas cette étape. Le Staging est protégé par Vercel Authentication ; configurer un accès de livraison webhook strictement réservé au TEST avant le test de réception (sans désactiver la protection de tout le projet).
7. En Sandbox, `sendPurchaseEmails` ne contacte aucun destinataire réel (`sandbox_skipped`). L'écran a été corrigé pour ne pas promettre l'envoi d'un courriel de test.

**Bloqueur actuel :** l'approbation acheteur Sandbox et le webhook signé ne sont pas encore observés. L'état READY de Vercel et la présence des secrets (masqués) ne prouvent pas un paiement de bout en bout.

**Avant Production :** rapprochement PayPal Live des cinq commandes historiques `payment_pending` en lecture seule ; les deux migrations nécessaires et la configuration du vrai webhook ; approbation explicite distincte pour migration, fusion, déploiement et réouverture.

**Question commerciale indépendante :** les tarifs du code sont actuellement 19,90 € (q1) et 29,90 € (q2). Les confronter aux tarifs voulus par Sébastien avant ouverture.

## Constats du 16 octobre 2026 — approbation Sandbox confirmée

- Le navigateur de test a rencontré l'erreur de confirmation après paiement ; deux commandes q1 Sandbox, toutes deux `payment_pending` mais `capture_started_at` non nul, ont été observées dans Supabase TEST.
- Un diagnostic **PayPal GET order + GET capture** (sans mutation) transmis par l'utilisateur confirme sur **une** des commandes : order COMPLETED, 1 purchase unit, 1 capture COMPLETED, détail capture COMPLETED et `capture_confirmed_readonly` / `capture_consistent`. Le diagnostic provenait de l'ancienne version sans indice de commande ; le statut de l'autre commande n'est **pas encore confirmé**.
- La cause exacte de l'erreur initiale n'est pas prouvée. Une propagation PayPal différée est une explication plausible ; l'avertissement Node `url.parse` n'est pas causalement établi.
- Correctif **GET-only** ajouté à `lib/emailQuestions.js` : endpoint `questionAction=reconcile`, validation fournisseur de la commande ET de la capture, unicité des purchase units et captures, montant / devise / corrélation, transition DB `payment_pending -> paid` conditionnelle et notification émise seulement par le gagnant. Ne contient **aucun POST PayPal capture**, même avec une réponse réseau perdue.
- `QuestionPage.jsx` exécute une unique tentative initiale `capture`, puis uniquement `reconcile` sur les erreurs explicitement retryables. Il ne recrée aucune commande et affiche de ne pas recommencer à payer.
- Trois tests simulés du rapprochement et un test de sécurité d'interface ajoutés (confirmation puis replay idempotent, état APPROVED, montant divergent, un seul appel `capture`).
- **Aucune commande Sandbox existante n'a été modifiée ou marquée payée pendant cette correction.** Test du nouveau commit Staging requis avant d'envisager toute opération de rapprochement en TEST et GO explicite distinct.
- **PROD NO-GO** ; tester séparément le vrai webhook PayPal signé et rapprocher les 5 commandes historiques Production.
