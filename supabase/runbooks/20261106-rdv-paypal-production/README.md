# Mise en Production — fiabilité du paiement PayPal des rendez-vous

À exécuter uniquement après le GO Production explicite de Sébastien.
La migration de permissions `20261106130000` a déjà été appliquée en Production
séparément ; le précontrôle vérifie ses quatre fonctions avant tout changement.

1. `00-controles-avant.sql` (lecture seule) : chaque ligne doit afficher `ok`.
2. `01-migration-atomique.sql`, qui contient `BEGIN` / `COMMIT` et refait le
   contrôle des signatures et droits dans sa transaction. Avec `psql`, utiliser
   `psql -X -v ON_ERROR_STOP=1 -f 01-migration-atomique.sql` : toute erreur
   arrête le script et la connexion ferme la transaction non validée.
   Ordre : protection des rendez-vous → paiement intégral toutes modalités →
   fiabilité, y compris réclamation de capture sans rejeu après expiration.
3. `02-controles-apres.sql` : essais dans des blocs annulés (réservation et
   création d'un paiement intégral en présentiel acceptées, montant faux refusé),
   droits réservés au serveur, aucune donnée d'essai persistée. Toute divergence
   produit une erreur SQL et arrête `psql` avec `ON_ERROR_STOP=1`.
4. Fusion de la branche `rdv-paypal-production` dans `main`, déploiement Vercel Production.
5. Contrôles du site : configuration PayPal Live, disponibilités, journaux Vercel,
   rapprochement en mode rapport pour les paiements du 14/10 et du 03/11 (aucune réparation
   sans décision).

Retour arrière : arrêter les nouvelles créations, puis attendre ou résoudre toutes
les captures en cours avant tout retour du code. La restauration Vercel ne doit pas
faire perdre la capacité de finaliser un ordre PayPal déjà approuvé. Le schéma
et la fonction de réclamation durcie peuvent rester en place avec l'ancien code :
c'est le retour normal.
`03-retour-arriere.sql` est facultatif et interdit dès qu'une tentative de
paiement intégral en présentiel existe, quel que soit son état. Ce fichier
contient `BEGIN` / `COMMIT`, verrouille les tables concernées et vérifie cette
condition dans la même transaction. L'exécuter, si admissible, avec
`psql -X -v ON_ERROR_STOP=1 -f 03-retour-arriere.sql`.

Le cron et les demandes de statut ne font que lire les captures incertaines.
Les captures historiques (`capture_attempts = 0`) ne sont jamais modifiées par
le rapprochement de cette version, même si un opérateur demande `apply`.
Les migrations déjà exécutées via ce runbook doivent être inscrites dans le
suivi des versions avant un futur `supabase db push`, pour éviter un rejeu
involontaire. Ne jamais utiliser `db push` comme étape automatique de ce plan.

Le runbook `01` est volontairement à application unique : une seconde exécution
échoue au contrôle de signature avant toute modification. Le retour arrière SQL
restaure les deux fonctions « visio seule », mais ne restaure jamais la
réclamation de capture dangereuse.
