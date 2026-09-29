# Test de course : annulation d'un lien d'urgence ↔ capture PayPal

À rejouer sur un PostgreSQL 16 **local et jetable** (jamais la production) :

```bash
createdb race
psql -d race -f schema.sql                                   # tables minimales + rôles
psql -d race -f ../../migrations/20260929090000_rdv_slot_offers.sql   # deux fois : idempotente
psql -d race -f ../../migrations/20260929090000_rdv_slot_offers.sql
# + la vraie fonction claim_rdv_deposit_capture extraite de 20260916193000_rdv_arrhes_paypal_checkout.sql
bash run.sh
```

Résultat attendu (validé le 29/09/2026) :

- A. capture d'abord → `{"ok": true}` ; annulation pendant → `offer_payment_in_progress`
- B. annulation d'abord → `{"ok": true}` ; capture pendant → `hold_not_capturable`, hold et paiement `expired`
- C. ordre créé avant expiration, approuvé après → `slot_offer_expired` (transaction annulée, pas de /capture) ; `release_slot_offer_hold` → `offer_expired`, hold et paiement `expired`
- D. lien valable → capture OK ; annulation ensuite → `offer_payment_in_progress`
- E. `anon` → permission refusée sur les deux fonctions
