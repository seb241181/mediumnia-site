# MediumIA — Pass conférence individuel 5 × 99,80 € : garde-fous avant mise en ligne

**Statut 23/10/2026 : brouillon TEST. NO-GO paiement réel / NO-GO Production.**
Références chantiers : #169 « Mes rencontres », #175 Pass 5×, #176 droit visio, #177 prévisualisation intégrée.

## 1. Règles financières et calendrier

- Offre uniquement après approbation individuelle du propriétaire, pour un participant réellement présent à la conférence, et au total de **499 € TTC** (cinq paiements de **99,80 € TTC**).
- PayPal Subscription à **5 cycles mensuels finis**, et non abonnement illimité.
- Chaque rapprochement PayPal vérifie le plan, l'identité du contrat, les captures uniques, les remboursements, les échecs de paiement, l'absence de solde restant dû, et l'environnement Sandbox.
- **Pas d'accès visio sur le seul statut ACTIVE**. Il faut un premier paiement confirmé et toutes les échéances exigibles payées.
- Référence des échéances : dates `start_time`, `next_billing_time` et `cycle_executions` **du contrat PayPal**, jamais la date d'une capture choisie par l'élève. Un calendrier absent ou contradictoire doit bloquer les réservations et demander un examen humain.
- Le solde final de **499 €** n'est confirmé qu'après **cinq captures distinctes de 99,80 €** et **cinq cycles PayPal réguliers achevés**. Pas de déblocage intégral si paiement en retard, remboursé ou en attente.
- La synchronisation automatique par webhooks reste **à concevoir** ; la synchronisation manuelle TEST ne garantit pas la mise à jour continue du compte.
- Ne pas réinterpréter cette formule comme le parcours progressif normal de 597 €.

## 2. Visios de janvier à mai 2027

Dates Paris : 16/01, 13/02, 13/03 à **10h–12h UTC+1**, 10/04 et 22/05 à **10h–12h UTC+2**.

1. Le participant réserve sur MediumIA ; le serveur interroge PayPal Sandbox en temps réel avant d'accepter.
2. Si l'élève a un impayé, un remboursement, un abonnement suspendu ou si PayPal ne répond pas : nouvelle réservation **refusée**.
3. Avant l'envoi d'une invitation Zoom **individuelle**, le propriétaire utilise `Vérifier accès visio`, puis vérifie à nouveau la situation à l'approche de la rencontre. Une vérification passée n'est pas une garantie future.
4. **Aucun lien Zoom partagé, public, intégré dans le navigateur ou divulgué dans les logs.** Les routes de test ne retournent jamais `join_url` ou le mot de passe de la réunion.
5. Si une réservation existe mais que les paiements sont interrompus, elle n'est **pas supprimée automatiquement** : informer l'élève et laisser au propriétaire le soin de statuer. Le lien Zoom ne doit pas être transmis tant que les droits ne sont pas confirmés.
6. Pour l'admission en réunion, utiliser **salle d'attente activée et code de réunion** ; comparer l'identité/inscription à la liste autorisée et refuser les personnes non confirmées.
7. Une inscription Zoom **avec approbation manuelle** peut renforcer la confidentialité ; ne pas imposer l'authentification obligatoire Zoom sans en informer les participants, car certains n'ont pas de compte Zoom. Les liens d'inscription ou déjà communiqués ne peuvent pas être révoqués simplement par MediumIA.
8. À terme, intégrer un mécanisme Zoom d'invitations individuelles, à tester séparément ; ne pas envoyer automatiquement de liens à partir de la seule création d'une réservation.
9. En cas de défaillance du contrôle le jour de la visio, l'opérateur peut vérifier PayPal manuellement avant admission, mais aucune automatisation ne doit transformer un contrôle échoué en permission.

Références Zoom :
- https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0059862
- https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0063837

## 3. Point de droit impératif

**L'encaissement d'une formation entière payée en cinq mensualités sur plus de trois mois peut entrer dans le régime français du crédit gratuit à la consommation**, et son traitement est différent d'une prestation réellement délivrée progressivement.

Avant de vendre, demander la revue d'un professionnel compétent du **contrat et des CGV**, de la nature de la prestation échelonnée, des informations précontractuelles, du droit de rétractation, des défauts de paiement, des remboursements, de la TVA et des dates d'accès aux modules. Ne pas supposer que le seul fait d'utiliser PayPal Subscriptions dispense du droit du crédit.
Source publique : https://www.service-public.fr/particuliers/vosdroits/F2438

## 4. Validation TEST attendue

- [x] Inscription Sandbox active, première capture 99,80 € enregistrée ; réservation puis annulation de la rencontre du 16 janvier réussies en TEST.
- [x] Création des champs de calendrier de l'abonnement dans Supabase TEST.
- [ ] **Dernier code PayPal/calendrier/Zoom** : tests automatiques et build Vercel à confirmer après la limite de fréquence du plan Hobby.
- [ ] Réexécuter le bouton `Vérifier les mensualités Sandbox` pour renseigner les nouveaux champs fournisseur ; valider `billingScheduleVerified`.
- [ ] Vérifier une réservation avec un élève distinct du propriétaire, sans droit à la formation complète.
- [ ] Simuler un cycle impayé, un remboursement partiel et une panne PayPal ; contrôler refus des réservations et du check-in, sans facturer ni modifier un véritable contrat client.
- [ ] Contrôler que l'interface ne divulgue ni URL Zoom ni secret.
- [ ] Définir la délivrance réelle des modules au cours des cinq mois.
- [ ] Obtenir une validation juridique et des CGV, puis l'autorisation **explicite** de mise en Production.

**Aucune réunion Zoom réelle, aucun e-mail, aucun changement de Production ou prélèvement réel n'est déclenché par cette documentation ou ce chantier.**
