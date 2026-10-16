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
