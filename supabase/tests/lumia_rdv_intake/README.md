# Lumia Intake : demandes de RDV importées depuis des messages

À rejouer sur un PostgreSQL 16 **local et jetable** (jamais la production) :

```bash
PGHOST=… PGPORT=… bash run.sh
```

`run.sh` crée une base `lumia`, charge `schema.sql` (tables minimales), puis les
**vrais** fichiers `docs/rdv-requests-migration.sql` et
`docs/rdv-confirm-request-migration.sql`, et applique **deux fois** les migrations
`20261002085000_mediumia_customers.sql` et `20261002090000_lumia_rdv_intake.sql`
(rejouables).

- `scenarios.sql` : 39 vérifications séquentielles + 2 contraintes :
  - demande vague (cas A) ;
  - même message relu ;
  - rapprochement client par téléphone, par e-mail, numéro partagé, autre prénom, autre adresse, nom seul, autre praticien, demande d'agent jamais prise comme référence ;
  - référentiel clients (fiches fictives façon Reservio) : création, ré-import plus ancien ignoré, ré-import plus récent sans rien vider, identifiant externe unique, lien par téléphone puis e-mail, fiche sans e-mail, nom seul = simple suggestion, homonymes = rien, autre prénom = ambigu ;
  - conversation mise à jour (cas B) ;
  - créneau précis (cas C) puis confirmation par la vraie fonction `confirm_booking_request` ;
  - le formulaire du site garde ses champs obligatoires ;
  - canal inconnu refusé.
- **Concurrence** : 5 appels simultanés du même message donnent 1 demande et 1 événement ; 2 messages simultanés d'une même conversation donnent 1 demande.
- **Droits** : `anon` et `authenticated` ne peuvent ni appeler les fonctions, ni lire le journal, ni lire le référentiel clients.

Résultat attendu (validé le 02/10/2026) : « TOUS LES SCÉNARIOS SÉQUENTIELS SONT PASSÉS ».
