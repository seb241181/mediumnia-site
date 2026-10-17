# PR #158 — validation de l'annulation propriétaire : preuve TEST

Date : 16 octobre 2026. Statut : **PARTIELLEMENT VALIDÉ — NO-GO Production**.

## Portée et isolation

- Base interrogée : Supabase **TEST** `wnbwhnqiulsdjcvkuwos` (projet « MediumIA RDV PayPal Test »).
- Base Production `uotkpygeqqnekpolezts` : **aucune écriture**.
- Aucune opération PayPal, Google Agenda, Resend, WhatsApp ni client réel.
- Seuls des rendez-vous et une écriture de caisse **fictifs** ont été insérés dans des transactions SQL, terminées par `ROLLBACK`.
- Les fixtures employaient `booking_source = 'manual'` et une adresse `@example.invalid`, avec des dates fictives en 2099.
- Contrôle extérieur après ROLLBACK : **0 réservation fictive et 0 écriture fictive restantes**.

## Ce qui a effectivement été exécuté

1. **Annulation SQL d'un rendez-vous fictif confirmé** : mise à jour `confirmed → cancelled`, marqueur `cancel_reason = 'practitioner_manual'`, seconde tentative conditionnelle `WHERE status = 'confirmed'` ne modifiant aucune ligne. Assertions `DO` sans erreur. `ROLLBACK`.
2. **Préservation de l'historique financier** : création transactionnelle d'un rendez-vous fictif + d'une écriture `arrhes` en espèces de 20 € ; annulation logique, contrôle de l'écriture et de son montant toujours intacts, puis `ROLLBACK`.
3. **Absence de résidus** : après les deux transactions, requête indépendante de contrôle : `synthetic_bookings_remaining = 0`, `synthetic_payments_remaining = 0`.
4. **Inspection du vrai schéma TEST** : `bookings.status` contraint à `confirmed/cancelled/rescheduled`, FK sur praticien et prestation, triggers INSERT/UPDATE actifs. La mécanique SQL de l'annulation logique est compatible avec ces contraintes.
5. **Tests Node simulés** : intégrés à `tests/rdvOwnerCancellation.test.js`, exécutés dans le build CI Vercel : contrôle propriétaire, restriction Preview, interrupteur OFF, cas annulation/répétition, Google échoué, carte cadeau, capture/ordre PayPal incertains, rapprochement manquant, panne de lecture, e-mail échoué. Les services sont simulés et non contactés.

Les tests SQL ont été lancés à travers le connecteur Supabase sur la base TEST ; ce protocole en rapporte les résultats, sans rejouer des transactions vers un prestataire.

## Verrous de sécurité dans la PR

- `RDV_OWNER_CANCEL_ENABLED` **OFF par défaut** ; aucune annulation activable sans valeur explicite `true` côté serveur.
- Preview strictement interdite, y compris si l'interrupteur est renseigné, afin de ne pas muter une base Production dont elle pourrait partager les variables.
- L'UI reflète le verrou : mention « Annulation en préparation » à la place d'un bouton actif tant que le serveur n'a pas validé l'activation.
- Réconciliation des quatre registres nécessaires : journal financier, réservations PayPal, paiements de soldes PayPal, consommations de cartes cadeaux ; arrêt au moindre doute.
- Pas de remboursement automatique, pas d'effacement de données. Les alertes de caisse s'actualisent après annulation réussie.

## Validation **non acquise** — bloqueur Production

- **Pas de parcours HTTPS authentifié complet** relié à une base TEST isolée : la Preview Vercel est intentionnellement non mutante.
- **Pas de véritable suppression/recréation d'événement Google** (aucune autorisation de modifier un agenda réel). Seuls les scénarios de synchronisation simulés sont couverts.
- **Pas de test réel d'ordres/captures PayPal concurrents** ; ils appartiennent à un chantier de validation indépendant. Il subsiste une fenêtre de concurrence entre le contrôle du registre financier, la suppression Google et le changement de statut en base.
- La phase ultime devra assurer un verrou/claim atomique côté SQL **coordonné avec les RPC de capture** et la reprise des pannes Google. En l'état, le verrou applicatif seul ne vaut pas preuve d'absence de capture concurrente.

**Décision : PR #158 maintenue DRAFT, pas de fusion, pas de migration Production, pas d'activation du flag.** Demander un accord distinct et cadré avant tout test impliquant un vrai agenda ou un prestataire externe. Ne pas recycler les données ni les jetons de #156.
