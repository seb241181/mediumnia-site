# Lumia Intake : demandes de RDV importées depuis des messages

À rejouer sur un PostgreSQL 16 **local et jetable** (jamais la production) :

```bash
PGHOST=… PGPORT=… bash run.sh
```

`run.sh` crée une base `lumia`, charge `schema.sql` (tables minimales), puis les
**vrais** fichiers `docs/rdv-requests-migration.sql` et
`docs/rdv-confirm-request-migration.sql`, et applique **deux fois** les migrations
`20261002085000_mediumia_customers.sql`, `20261002090000_lumia_rdv_intake.sql` et
`20261002093000_lumia_confirm_request_manual_source.sql` (rejouables), avec le vrai
garde-fou des arrhes `enforce_mediumia_booking_reservation_payment` (repris de
`20260916203000_rdv_full_payment_video.sql`).

- `scenarios.sql` : 55 vérifications séquentielles + 4 contraintes :
  - demande vague (cas A) ;
  - même message relu ;
  - rapprochement client par téléphone, par e-mail, numéro partagé, autre prénom, autre adresse, nom seul, autre praticien, demande d'agent jamais prise comme référence ;
  - référentiel clients (fiches fictives façon Reservio) : fiche sans identifiant externe, doublon du fichier (forte confiance), mise à jour plus récente, valeur plus ancienne ou sans date jamais appliquée, donnée MediumIA récente jamais écrasée, téléphone partagé = fiches ambiguës, homonymes jamais fusionnés, identifiant externe, consentements séparés (confidentialité ≠ marketing) ; Lumia : lien par téléphone puis e-mail, fiche ambiguë jamais reliée, nom seul = suggestion, historique renvoyé ;
  - conversation mise à jour (cas B) ;
  - visio : WhatsApp / FaceTime seulement s'ils sont dits, sinon « a_preciser », jamais un autre outil, aucun canal hors visio, mise à jour par la conversation ;
  - créneau précis (cas C) puis confirmation par la vraie fonction `confirm_booking_request` : demande Lumia sur une prestation à arrhes → booking « manual » ; demande du formulaire du site → « mediumia » (inchangé) ; réservation publique « mediumia » sans arrhes → toujours refusée ;
  - le formulaire du site garde ses champs obligatoires ;
  - canal inconnu refusé.
- **Concurrence** : 5 appels simultanés du même message donnent 1 demande et 1 événement ; 2 messages simultanés d'une même conversation donnent 1 demande.
- **Droits** : `anon` et `authenticated` ne peuvent ni appeler les fonctions, ni lire le journal, ni lire le référentiel clients ou les consentements.

Résultat attendu (validé le 02/10/2026) : « TOUS LES SCÉNARIOS SÉQUENTIELS SONT PASSÉS ».
