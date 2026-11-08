# Terminer le rattrapage TEST depuis un Mac (une commande)

Projet concerné : **MediumIA RDV PayPal Test** (`wnbwhnqiulsdjcvkuwos`), et lui seul.
État de départ vérifié le 08/11/2026 : B2-00 contrôlé, blocs 1 et 2 appliqués par le
connecteur Supabase, 84 tables, 28 rendez-vous et 4 comptes d'essai.

## Ce que fait `rattrapage-test.sh`

1. **Vérification préalable** : l'adresse doit désigner TEST (celle de la Production est
   refusée), le contenu doit être celui de TEST, les blocs 1 et 2 doivent être inscrits
   dans l'historique, et il doit y avoir 84 tables si rien d'autre n'a encore été fait.
2. **Sauvegarde** (`pg_dump`) des schémas `public`, `mediumia_private` et `supabase_migrations`,
   relue et chiffrée par empreinte avant toute modification.
3. **Confirmation** : il faut taper `TEST`.
4. **Exécution** des 3 fichiers de `sql-editor/`, chacun en **une seule transaction** :
   - `1-b2-10-fin-migrations-du-depot.sql` : les 11 migrations restantes du dépôt ;
   - `2-b2-20-b2-30-alignement.sql` : les objets hors dépôt et les 29 fonctions alignées ;
   - `3-garde-environnement-et-signalements.sql` : la garde TEST/PROD, le marqueur « test »
     et les signalements de paiement.
5. **Contrôles** : 6 étapes inscrites dans l'historique, `90-verification.sql` sans aucun
   écart, marqueur « test », données d'essai inchangées et 106 tables.

**Suivi et reprise.** Chaque fichier s'inscrit dans `supabase_migrations.schema_migrations`
dans la même transaction que ses changements. Un fichier déjà inscrit est ignoré, et un
fichier qui échoue est entièrement annulé. Après une coupure ou une erreur, il suffit de
relancer la même commande : le script reprend au premier fichier non appliqué. Chaque
fichier refuse aussi de s'exécuter si l'étape précédente manque.

**Secret.** Le mot de passe est demandé sans affichage. Il n'est écrit ni sur le disque ni
dans le journal, et ne doit jamais être collé dans une conversation.

## Procédure

1. **Outils PostgreSQL**, une seule fois. Dans Terminal : `brew install libpq`.
   Sans Homebrew, installez Postgres.app : le script le trouve tout seul.
2. **Récupérer les fichiers**, au choix :
   - `git clone --depth 1 --branch payment-issue-report https://github.com/seb241181/mediumnia-site.git ~/mediumia-rattrapage`
   - ou télécharger le ZIP de la branche `payment-issue-report` depuis GitHub
     (Code > Download ZIP), puis le décompresser dans `~/mediumia-rattrapage`.
3. **Adresse de connexion.** Dans Supabase, ouvrez le projet *MediumIA RDV PayPal Test*,
   cliquez sur **Connect**, choisissez **Session pooler**, puis copiez l'URI. Elle commence
   par `postgresql://postgres.wnbwhnqiulsdjcvkuwos:[YOUR-PASSWORD]@aws-…pooler.supabase.com:5432/postgres`.
   Si vous avez oublié le mot de passe de la base TEST, il se réinitialise dans
   Project Settings > Database. Ne le faites que si aucun outil n'utilise déjà ce mot de passe.
4. **Lancer :**
   `bash ~/mediumia-rattrapage/supabase/runbooks/20261108-environment-separation/test-rattrapage/rattrapage-test.sh`
   Collez l'URI (sans remplacer `[YOUR-PASSWORD]`), saisissez le mot de passe, puis tapez `TEST`.
   Comptez quelques minutes.
5. **Fin.** Le script affiche « RATTRAPAGE TEST TERMINÉ ». Le journal et la sauvegarde
   se trouvent dans `~/mediumia-rattrapage-test/`. Prévenez Claude, qui revérifie TEST en
   lecture seule.

## En cas d'arrêt

| Message | Signification | Que faire |
|---|---|---|
| « cette adresse est celle de la PRODUCTION » ou « ne désigne pas le projet TEST » | Mauvaise URI, rien n'a été fait | Reprendre l'URI du projet TEST |
| « connexion impossible » | Mot de passe, réseau ou URI | Vérifier, puis relancer |
| « … a échoué : sa transaction est annulée » | Ce fichier n'a rien laissé | Transmettre le journal à Claude, puis relancer une fois corrigé |
| « 90-verification : N écart(s) » | Les changements sont faits, mais un objet diffère | Ne rien relancer, transmettre `ecarts-….txt` |

## Sauvegarde et retour arrière

- **Sauvegarde vérifiée.** Lors de la répétition, elle a été restaurée dans une base vide :
  schéma identique, à un droit par défaut près sur le schéma `public`, et données identiques
  sur toutes les tables.
- **Échec en cours de route.** Aucun retour arrière n'est nécessaire : la transaction du
  fichier fautif est annulée et les fichiers déjà réussis restent cohérents.
- **Retour en arrière après un succès.** `99-retour-arriere-test.sql` restaure les définitions
  de fonctions d'avant l'alignement, et `../retour-arriere.sql` retire la garde. Une
  restauration complète de TEST à partir de la sauvegarde sera préparée au cas par cas si
  elle devient nécessaire.

## Répétition à blanc (08/11/2026, réplique fidèle de TEST, état « blocs 1 et 2 »)

- **Exécution complète :** 84 → 106 tables, 6 étapes inscrites, 0 écart, marqueur « test »,
  données inchangées.
- **Relance après réussite :** tout est ignoré et les contrôles sont de nouveau OK.
- **Échec simulé dans le fichier 2 :** le fichier 2 est annulé, le fichier 1 est conservé.
  La relance reprend au fichier 2 et se termine avec 0 écart.
- **Mauvaise adresse :** l'URI de la Production et l'URI d'un autre projet sont refusées
  sans aucune connexion.
