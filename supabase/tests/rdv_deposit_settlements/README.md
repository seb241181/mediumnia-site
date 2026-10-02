# Arrhes des rendez-vous annulés : remboursement, transfert, conservation

À rejouer sur un PostgreSQL 16 **local et jetable** (jamais la production) :

```bash
PGHOST=… PGPORT=… bash run.sh
```

`run.sh` crée une base `settle`, charge `schema.sql` (colonnes réellement utilisées,
grand livre et `rdv_booking_paid_cents` à l'identique), applique **deux fois** la
migration `20260930230000_rdv_deposit_settlements.sql` (rejouable), puis :

- `scenarios.sql` : 64 vérifications séquentielles (chacune lève une erreur si le
  résultat diffère) : RDV sans arrhes, RDV non annulé, séparation sandbox/live,
  remboursement total, double clic, rejeu, délai réseau ambigu (`unknown`),
  PayPal `PENDING`, échec, remboursements partiels, transfert (et refus : autre
  client, RDV passé/annulé, solde engagé chez PayPal), transfert d'arrhes
  remboursées, remboursement d'arrhes transférées, conservation, absence de
  double comptage, contraintes ;
- deux tests de concurrence (deux clics simultanés ; transfert et remboursement
  simultanés) ;
- droits : `anon` et `authenticated` ne peuvent ni appeler les fonctions ni lire
  les tables.

Résultat attendu (validé le 01/10/2026) : « TOUS LES SCÉNARIOS SÉQUENTIELS SONT
PASSÉS », un seul clic gagnant (`refund_in_progress` pour l'autre), transfert
gagnant puis remboursement refusé (`settlement_not_open`), et « permission denied »
pour `anon` et `authenticated`.
