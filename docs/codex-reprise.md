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
- Suite complète finale : 854 réussis, 0 échec.
- ESLint ciblé : réussi.
- Build de production : réussi ; contrôle ChronoSphère V2 réussi.
- Les sorties étrangères générées par `pretest`/`prebuild` ont été retirées du diff.
- Correctif principal poussé : `4db54de3107354bb8d3d60e9c03827b43fc7566e`.
- Durcissement du rejet non signé poussé : `8cf8855bbbb0b27104ba6e889ae72acc10859343`.
- Preview Vercel `dpl_A37aUmWWWVvH7Fap5ntPWkafRsoa` : READY, contrôle GitHub réussi.
- `/question` : rendu client fonctionnel en environnement Sandbox Preview.
- POST webhook non signé sur le Preview : HTTP 401 `paypal_signature_headers_missing`.
- Test ciblé après le dernier durcissement : 11 réussis, 0 échec ; ESLint ciblé réussi.

## Restant

- Retirer du worktree local les sorties sans rapport avec la PR générées par le dernier
  `pretest` ; elles ne sont ni indexées, ni committées, ni poussées.
- Une validation Sandbox signée sur Preview exige la migration dans un environnement TEST
  isolé et la variable de webhook Sandbox ; aucune migration distante n'est autorisée ici.

## Blocages

- Aucun blocage local.
- La migration n'est appliquée sur aucun environnement distant.
- Le Preview Sandbox expose volontairement le parcours d'achat Sandbox ; aucune vente Live
  ni variable Production n'a été modifiée.
- Un projet Vercel vide `mediumia-pr156`, sans domaine ni déploiement, a été créé par
  l'auto-liaison de Vercel CLI pendant le test protégé. Sa suppression demande une autorisation
  destructive distincte et n'affecte pas `mediumia-site`.

## Décisions

- Développement et tests isolés : GO.
- Paiement réel, commandes Live, remboursement, migration distante, fusion et production :
  NO-GO.
- Les ventes restent suspendues ; aucun interrupteur n'est réactivé.

## Prochaine action exacte

Conserver la PR en brouillon et attendre une autorisation distincte avant migration TEST
signée, fusion, production, nettoyage du projet Vercel vide ou suppression des sorties locales
générées par `pretest`.
