# MediumIA — Pass conférence individuel 5 × 99,80 € : garde-fous avant mise en ligne

**Statut 23/10/2026 : parcours technique prêt en TEST, vente toujours NO-GO juridique/Zoom/CGV. PR DRAFT.**
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
7. Créer le moment venu des réunions Zoom **avec inscription obligatoire et approbation manuelle**. N'approuver un élève qu'après une vérification positive contemporaine de ses droits : Zoom lui enverra alors lui-même un **e-mail automatique contenant son lien individuel**. Cette conséquence doit être comprise avant tout clic d'approbation. Il est possible de **révoquer une inscription approuvée depuis Zoom**, mais un lien déjà copié/transmis ne constitue pas une autorisation indéfinie ; la salle d'attente et le contrôle humain restent nécessaires. Ne pas exiger un compte Zoom sans informer l'élève.
8. À terme, intégrer un mécanisme Zoom d'invitations individuelles, à tester séparément ; ne pas envoyer automatiquement de liens à partir de la seule création d'une réservation.
9. En cas de défaillance du contrôle le jour de la visio, l'opérateur peut vérifier PayPal manuellement avant admission, mais aucune automatisation ne doit transformer un contrôle échoué en permission.

Références Zoom vérifiées le 23/10/2026 :
- Gestion manuelle des inscriptions, révocation et e-mail automatique après approbation : https://support.zoom.com/hc/fr/article?id=zm_kb&sysparm_article=KB0083052
- Inscription obligatoire et approbation manuelle : https://support.zoom.com/hc/fr/article?id=zm_kb&sysparm_article=KB0065035
- Salle d'attente et admission individuelle : https://support.zoom.com/hc/fr/article?id=zm_kb&sysparm_article=KB0063340

## 3. Point de droit impératif

**L'encaissement d'une formation entière payée en cinq mensualités sur plus de trois mois peut entrer dans le régime français du crédit gratuit à la consommation**, et son traitement est différent d'une prestation réellement délivrée progressivement.

Avant de vendre, demander la revue d'un professionnel compétent du **contrat et des CGV**, de la nature de la prestation échelonnée, des informations précontractuelles, du droit de rétractation, des défauts de paiement, des remboursements, de la TVA et des dates d'accès aux modules. Ne pas supposer que le seul fait d'utiliser PayPal Subscriptions dispense du droit du crédit.
Le **crédit gratuit à la consommation sur plus de trois mois** est documenté sur Service-Public (mis à jour le 05/12/2025) : https://www.service-public.fr/particuliers/vosdroits/F2438

**Vérification supplémentaire de la qualification d'action de formation professionnelle** : si le régime des contrats de formation souscrits et financés individuellement par une personne physique s'applique à MediumIA, les articles **L6353-3 à L6353-7 du Code du travail** imposent notamment un contrat préalablement à tout règlement, la rétractation de 10 jours, **aucune somme avant la fin de ce délai**, au plus **30 %** du prix à ce stade, puis un paiement du solde selon le déroulement réel de la formation et des modalités de cessation/force majeure :
https://www.legifrance.gouv.fr/codes/id/LEGISCTA000006189927/

La qualification de la formation ésotérique/sous forme de cours numériques comme action de formation professionnelle n'est **pas établie**. Ces régimes peuvent varier selon l'offre effectivement vendue et le contrat : **avocat en droit consommation/formation + expert-comptable** avant lancement. Ne jamais supprimer une information précontractuelle ni modifier les délais légaux sur la base d'une supposition.

**Note au conseil** : « MediumIA propose à une participante identifiée à une conférence une offre exceptionnelle de formation en ligne à 499 € au lieu de 597 €, avec cinq paiements mensuels de 99,80 €. Les contenus comprennent 25 modules et des rencontres pédagogiques en visio le samedi. Les droits aux visios pourraient être provisoires dès la première échéance confirmée, avec contrôle des impayés avant la séance ; l'accès intégral aux modules n'est pas donné avant règlement complet. Pouvez-vous qualifier juridiquement l'opération (prestation échelonnée, crédit gratuit, formation professionnelle éventuelle), vérifier les règles de rétractation et de mise à disposition des contenus numériques, les CGV/mentions obligatoires, les défauts de paiement et les modalités d'annulation/force majeure ? Nous maintenons l'option fermée au public dans l'attente de votre validation écrite. »

## 4. Validation TEST attendue

- [x] Inscription Sandbox active, première capture 99,80 € enregistrée ; réservation puis annulation de la rencontre du 16 janvier réussies en TEST.
- [x] Création des champs de calendrier de l'abonnement dans Supabase TEST.
- [x] **Dernier code PayPal/calendrier/rencontres** : 982/982 tests automatiques, 0 échec, compilation Vercel et déploiement Preview READY au commit `7451c959b3e2b4e5c787c4c943484e76c5c8ed0c` (`dpl_3UVRV9YTZvmKVND7Hvy1mXnPJ8sV`).
- [x] Synchronisation PayPal Sandbox du calendrier fournisseur : 1 cycle de 5 confirmé, prochaine échéance 23/11/2026.
- [ ] Vérifier une réservation avec un élève distinct du propriétaire, sans droit à la formation complète.
- [x] Scénarios négatifs **simulés côté API et logique** : impayé, remboursement partiel, suspension, abonnement tiers, panne PayPal, contrôle en Production refusé (tests automatiques) ; aucun encaissement ni remboursement fictif ou réel exécuté chez PayPal.
- [x] Le contrôle d'accès administrateur ne retourne ni `join_url` ni mot de passe (testé côté API) ; aucune invitation Zoom créée.
- [ ] Définir contractuellement la délivrance réelle des modules au cours des cinq mois, puis implémenter l'accès pédagogique conforme.
- [ ] Configurer de vraies réunions Zoom à inscription/approbation manuelle et tester révocation/salle d'attente, **sans envoyer d'invitation à des clients pendant TEST**.
- [ ] Obtenir une validation juridique et des CGV, puis l'autorisation **explicite** de mise en Production.

**Aucune réunion Zoom réelle, aucun e-mail, aucun changement de Production ou prélèvement réel n'est déclenché par cette documentation ou ce chantier.**
