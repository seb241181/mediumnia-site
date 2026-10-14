# Reprise Codex — MediumIA

## Projet

- Dépôt : `seb241181/mediumnia-site`
- Branche : `fix/guidance-paypal-repair-isolated`
- Pull request : `#156`
- Périmètre : sécurisation PayPal des Guidances par e-mail uniquement.

## Objectif

Corriger les six blocages P0 de la revue GitHub : signature webhook, charge utile Sandbox,
déduplication persistante, réponses temporaires rejouables, timeouts de capture et tests
comportementaux.

## Terminé et preuves

- Vérification de signature par l'API PayPal `verify-webhook-signature` ; en-têtes absents
  ou signature invalide rejetés.
- Corrélation du webhook par `resource.supplementary_data.related_ids.order_id`, puis
  relecture GET de la commande PayPal. Le code ne dépend plus de `resource.custom_id`.
- Registre SQL privé des événements et claim atomique par `event_id` et `capture_id`.
- Échec temporaire PayPal ou claim occupé : réponse HTTP 503, événement rejouable.
- Timeout et 5xx du POST de capture : relecture GET avant toute conclusion, sans second POST.
- Tests avec fixtures Sandbox : demande visible comme payée en administration, questions
  conservées, notification cliente et propriétaire ciblée une seule fois.
- Test PostgreSQL Docker avec huit connexions simultanées : un seul claim gagne.
- Tests ciblés : 32 réussis, 0 échec.
- Suite complète : 853 réussis, 0 échec.
- ESLint ciblé : réussi.
- Build de production : réussi ; contrôle ChronoSphère V2 réussi.
- Les sorties étrangères générées par `pretest`/`prebuild` ont été retirées du diff.

## Restant

- Committer et pousser la branche de la PR #156.
- Attendre le Preview Vercel, puis tester l'endpoint non signé et la page `/question`.
- Une validation Sandbox signée sur Preview exige la migration dans un environnement TEST
  isolé et la variable de webhook Sandbox ; aucune migration distante n'est autorisée ici.

## Blocages

- Aucun blocage local.
- La migration n'est appliquée sur aucun environnement distant.

## Décisions

- Développement et tests isolés : GO.
- Paiement réel, commandes Live, remboursement, migration distante, fusion et production :
  NO-GO.
- Les ventes restent suspendues ; aucun interrupteur n'est réactivé.

## Prochaine action exacte

Créer le commit de la PR #156, pousser la branche, attendre le déploiement Preview puis
vérifier `/question` et le rejet d'un webhook non signé.
