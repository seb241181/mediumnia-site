# État réel Production — 15 novembre 2026

**Le calendrier secondaire est activé.** Cette section remplace la procédure
préparatoire et l'exemple de Cron Vercel historique ci-dessous.

- Source de lecture : calendrier professionnel `seb` (rendez-vous automatiques **et manuels**)
- Cible d'écriture : calendrier distinct `Disponibilités MediumIA` (pas TEST)
- Moteur : `/api/rdv-config?availabilityCalendarAction=sync&days=31`
- Variables Vercel Production : `MEDIUMIA_ENV=production`,
  `AVAILABILITY_CALENDAR_SYNC_ENABLED=true` et secret manuel sensible
  `AVAILABILITY_CALENDAR_SYNC_MANUAL_SECRET`
- Configuration Supabase Production : `availability_calendar_sync_config`,
  `environment=production`, `enabled=true` avec deux identifiants Google différents
- Planificateur **actuel : Supabase `pg_cron`**, tâche
  `mediumia-availability-calendar-prod` (job ID 3), cadence `*/15 * * * *`
- Secret de l'appel périodique conservé chiffré dans Supabase Vault ;
  `pg_net` appelle l'API avec un en-tête privé. Ne jamais inscrire la valeur
  du secret dans les migrations, le code ou les journaux

**Ne pas ajouter le Cron Vercel proposé plus bas tant que cette tâche
Supabase est active**, sinon deux planificateurs appelleraient le même moteur
(qui dispose néanmoins d'un verrou de concurrence).

### Contrôles réalisés

- Première synchronisation sur 31 jours : 37 événements créés, aucun échec
- Second passage identique : 37 inchangés, 0 nouveau, 0 supprimé
- Dans Google, 37 événements privés et transparents ; FreeBusy de la cible vide
- Aucun chevauchement détecté avec les événements occupés du calendrier `seb`
- Aucune modification des réservations, ni de l'agenda source
- Les tables et les RPC internes ont RLS / privilèges limités au service
  (les droits EXECUTE de `anon` et `authenticated` sur les fonctions de verrouillage
  ont été révoqués explicitement)

### Contrôle et suspension

Contrôler `cron.job` (nom, état, cadence), `cron.job_run_details`,
`availability_calendar_sync_runs` (succès/erreurs) et
`availability_calendar_sync_config.last_success_at` / `last_error_code`.

Pour **suspendre rapidement** la planification, depuis un accès administrateur
Supabase Production :

```sql
select cron.unschedule('mediumia-availability-calendar-prod');
update public.availability_calendar_sync_config
set enabled = false, updated_at = now()
where environment = 'production';
```

Ne pas supprimer automatiquement les événements Google : ils sont
informatifs et reconnaissables à `mediumia_source=mediumia-availability-v1`.
Pour relancer, revalider les IDs source/cible, remettre `enabled=true`
et recréer un seul planificateur après contrôle.

---

# Calendrier secondaire « Disponibilités MediumIA » — mise en route Production

## État après livraison du code

Le code livré ne peut pas synchroniser Google par défaut : il n'y a ni Cron
supplémentaire, ni configuration Production, ni variable d'activation. La route
reste dans la fonction existante `api/rdv-config.js`, à l'adresse future
`/api/rdv-config?availabilityCalendarAction=sync` ; cela évite d'augmenter le
nombre de fonctions Vercel.

Les événements projetés restent privés et transparents (`visibility: private`,
`transparency: transparent`), sans donnée client. L'exécuteur lit les règles,
exceptions, réservations confirmées, réservations temporaires et les blocages du
calendrier source ; il n'écrit jamais dans ce calendrier source ni dans une
réservation MediumIA.

## Activation : GO distinct requis

1. Créer dans Google un calendrier secondaire dédié Production, puis relever son
   identifiant. Il doit être différent de l'identifiant du calendrier `seb` et
   ne doit jamais être `primary`.
2. Appliquer les migrations dans Supabase Production et vérifier RLS, les rôles
   `anon`/`authenticated` et les droits `service_role`. Cette étape ne doit pas
   créer de ligne active.
3. Insérer, après relecture, une unique configuration `environment=production`,
   `enabled=false`, avec l'identifiant de `seb` comme source et celui du nouveau
   calendrier comme cible. Vérifier explicitement que les deux valeurs diffèrent.
4. Vérifier les variables Production sans afficher leur valeur :
   `MEDIUMIA_ENV=production`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, les
   OAuth Google existantes, `CRON_SECRET` et un nouveau secret serveur
   `AVAILABILITY_CALENDAR_SYNC_MANUAL_SECRET`. Conserver
   `AVAILABILITY_CALENDAR_SYNC_ENABLED` absent ou différent de `true`.
5. Tester une exécution manuelle authentifiée à horizon réduit, avec
   `enabled=false` puis le mécanisme encore désactivé : elle doit répondre 404 et
   ne joindre ni Supabase ni Google.
6. Avec un GO d'activation distinct, basculer simultanément la configuration
   `enabled=true` et `AVAILABILITY_CALENDAR_SYNC_ENABLED=true`, exécuter une
   unique synchronisation manuelle, puis vérifier les événements, FreeBusy et
   le journal.
7. Ajouter seulement après cette vérification le Cron Vercel vers le chemin
   dédié. Vercel envoie `Authorization: Bearer $CRON_SECRET`; le handler le
   vérifie et le verrou SQL rend les exécutions simultanées inoffensives.

## Cron à ajouter après validation manuelle

Ajouter une réécriture vers `rdv-config` et un seul Cron, à une fréquence
compatible avec le forfait Vercel. Une cadence de cinq minutes exige un forfait
Pro ou Enterprise ; Hobby n'offre qu'une exécution quotidienne. Ne pas ajouter
ces entrées avant la validation manuelle : leur présence active le déclencheur
en Production.

```json
{
  "rewrites": [
    {
      "source": "/api/availability-calendar-sync",
      "destination": "/api/rdv-config?availabilityCalendarAction=sync"
    }
  ],
  "crons": [
    {
      "path": "/api/availability-calendar-sync",
      "schedule": "*/5 * * * *"
    }
  ]
}
```

## Contrôles et retour arrière

- Avant activation : confirmer qu'aucune entrée `crons` ne vise le calendrier de
  disponibilités et que la variable d'activation est absente.
- Après chaque passage : inspecter `availability_calendar_sync_runs`,
  `last_success_at` et `last_error_code`. Une erreur Google bloque les
  suppressions restantes afin de ne pas faire disparaître les disponibilités.
- Retour arrière immédiat : définir
  `AVAILABILITY_CALENDAR_SYNC_ENABLED=false` puis retirer le Cron. Les futurs
  appels deviennent des 404 sans lecture ni écriture Google. Ne pas supprimer
  les événements existants en urgence ; réconcilier ou supprimer uniquement les
  événements portant le marqueur privé `mediumia_source=mediumia-availability-v1`.
