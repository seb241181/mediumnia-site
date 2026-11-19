# Règlements hors PayPal — procédure de mise en Production

Rien n'est appliqué sans GO explicite du propriétaire.

## Ordre

1. **Contrôle avant** (lecture seule) : `controle-avant.sql`. Les trois empreintes doivent être conformes ; sinon, arrêter.
2. **Migration** : `supabase/migrations/20261108120000_rdv_offline_payments.sql` (une transaction ; additive).
3. **Déploiement du code** de la branche `rdv-offline-payments`. Le code tolère une base sans la migration (affichage historique), mais la migration doit précéder le code pour que les écritures passent par la fonction atomique.
4. **Contrôle après** (lecture seule) :
   - `SELECT count(*) FROM public.rdv_offline_payments;` → 0 ;
   - relancer `controle-avant.sql` : les empreintes changent (gardes ajoutées), c'est attendu ;
   - `SELECT has_function_privilege('authenticated', 'public.confirm_rdv_offline_payment(uuid,uuid,text,integer,date,text,text,text,uuid)', 'execute');` → false.

## Retour arrière

`retour-arriere.sql` rétablit les trois fonctions à l'identique (empreintes vérifiées sur une base locale) et retire les fonctions de règlement hors PayPal. Les tables et l'historique sont conservés ; une écriture comptable déjà confirmée reste valable.

## Tests (base PostgreSQL locale jetable)

```
psql -f supabase/tests/rdv_offline_payments/00_schema.sql
psql -f supabase/runbooks/20261108-rdv-offline-payments/retour-arriere.sql   # = fonctions de Production
psql -f supabase/migrations/20261108120000_rdv_offline_payments.sql
psql -f supabase/tests/rdv_offline_payments/01_scenarios.sql
PSQL="psql …" supabase/tests/rdv_offline_payments/02_concurrency.sh
```
