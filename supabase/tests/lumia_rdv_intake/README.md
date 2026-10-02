# Lumia Intake : demandes de RDV importées depuis des messages

À rejouer sur un PostgreSQL 16 **local et jetable** (jamais la production) :

```bash
PGHOST=… PGPORT=… bash run.sh
```

`run.sh` crée une base `lumia`, charge `schema.sql` (tables minimales), puis les
**vrais** fichiers `docs/rdv-requests-migration.sql` et
`docs/rdv-confirm-request-migration.sql`, et applique **deux fois** la migration
`20261002090000_lumia_rdv_intake.sql` (rejouable).

- `scenarios.sql` : 28 vérifications séquentielles + 2 contraintes :
  - demande vague (cas A) ;
  - même message relu ;
  - rapprochement client par téléphone, par e-mail, numéro partagé, autre prénom, autre adresse, nom seul, autre praticien, demande d'agent jamais prise comme référence ;
  - conversation mise à jour (cas B) ;
  - créneau précis (cas C) puis confirmation par la vraie fonction `confirm_booking_request` ;
  - le formulaire du site garde ses champs obligatoires ;
  - canal inconnu refusé.
- **Concurrence** : 5 appels simultanés du même message donnent 1 demande et 1 événement ; 2 messages simultanés d'une même conversation donnent 1 demande.
- **Droits** : `anon` et `authenticated` ne peuvent ni appeler la fonction ni lire le journal.

Résultat attendu (validé le 02/10/2026) : « TOUS LES SCÉNARIOS SÉQUENTIELS SONT PASSÉS ».
