# Préparation TEST — Pass Conférence MediumIA à 499 € en cinq mensualités

**Statut : brouillon technique. Aucun paiement actif, aucun e-mail et aucune ouverture de droits.**
**Portée : invitation individuelle à une participante identifiée de la conférence du 22 octobre 2026 ; pas de diffusion aux 61 inscrits.**

## Proposition commerciale

- Prix conférence confirmé comme hypothèse métier : **499 € TTC**, prix public de comparaison 597 €, réduction de 98 €.
- Paiement souhaité : **5 × 99,80 €** (cinq échéances mensuelles, première à l'adhésion, quatre suivantes chaque mois).
- Devise : EUR ; aucun supplément.
- Pass personnel rattaché à l'e-mail d'inscription vérifié ; pas de possibilité d'acheter plusieurs fois ni de transférer l'invitation.
- Date de fin du Pass : à définir contractuellement ; ne pas consommer le Pass au seul paiement du premier mois.

## Constat technique

- `lib/conferencePassPayPal.js` : le Pass actuel encaisse **une seule commande PayPal**, puis ouvre la formation complète.
- `lib/formationPath.js` : le parcours progressif est plafonné à **597 €** et n'est pas interchangeable avec ce tarif conférence à 499 €.
- Le SDK actuel de `src/components/ConferencePassPage.jsx` utilise **Orders/CAPTURE**, pas un abonnement à cinq échéances.
- `lib/conferenceFiveInstallments.js` prépare seulement les constantes, le calendrier informatif et le calcul d'un relevé de paiements **déjà vérifiés côté serveur**.
- **Aucun nouveau bouton de paiement n'a été ajouté. Aucun webhook n'a été activé.**

## Conditions bloquantes avant un éventuel TEST PayPal Sandbox

1. **Revue du contrat, des CGV et du droit applicable** : au-delà de trois mois, un achat intégral immédiat payé à crédit sans frais peut relever des règles de crédit à la consommation. Préférer, si validé juridiquement, cinq périodes de prestation réellement progressives et correctement décrites ; sinon recourir à un prestataire de financement habilité. Sources de vérification : https://www.service-public.gouv.fr/particuliers/vosdroits/F2438 ; https://www.banque-france.fr/fr/a-votre-service/particuliers/connaitre-pratiques-bancaires-assurance/credit/credit-consommation .
2. **Définir l'accès pédagogique de chaque échéance** (pas d'accès intégral gratuit dès la première) et les conditions de résiliation/remboursement. Ne pas modifier le plafond de 597 € du parcours existant.
3. **Rencontres visio — décision propriétaire du 23/10/2026** : la participante de cette offre individuelle **peut réserver et suivre dès le 16 janvier 2027**, même avant la cinquième mensualité, **si toutes ses échéances déjà exigibles sont réglées**. Ce droit est strictement **visio seulement** : ne pas lui ouvrir d'office les 25 modules ni ouvrir les visios au parcours progressif à 597 €. Le propriétaire doit approuver explicitement ce Pass, l'identité élève et l'éligibilité aux rencontres. Le serveur vérifie l'abonnement actif, le paiement initial et chaque échéance échue, les remboursements et le solde de droits à chaque réservation, avant l'envoi du lien privé, et avant l'entrée en visio. En cas de mensualité en retard ou remboursée, suspendre l'accès aux futures rencontres et examiner les réservations déjà effectuées, sans les effacer silencieusement. Exemple avec un premier paiement le 23 octobre 2026 : au 16 janvier 2027, **3 échéances** (octobre, novembre et décembre) doivent être effectivement payées ; les deux dernières seraient exigibles en janvier et février 2027, suivant l'échéancier réel du prestataire. La portée et les conséquences de cette offre restent à valider juridiquement.
4. **Créer une souscription PayPal finie, à cinq cycles, uniquement en Sandbox** : https://developer.paypal.com/platforms/subscriptions/customize/billing-cycles/ . Assurer l'arrêt après le cinquième versement et distinguer abonnement de crédit. N'envoyer aucune demande d'achat avant validation.
5. **Créer un état durable dédié** : table de contrats/échéances distincte, contrainte d'unicité par paiement et remboursement PayPal, association forte Pass + inscription + élève + environnement ; journal d'audit sans secrets. Validation transactionnelle avec contraintes SQL.
6. **Webhooks** : revérifier les paiements auprès de PayPal (ne pas faire confiance aux champs webhook seuls), conserver chaque capture une seule fois, traiter remboursement, échec, retard, annulation, rejeu, concurrence et correction manuelle auditée.
7. **Accès et sécurité** : strict cloisonnement de Supabase TEST et PayPal Sandbox ; aucune clé serveur côté navigateur ; aucune possibilité de s'auto-attribuer la réduction ou l'accès complet. Réviser les autorisations RLS/RPC et la durée d'accès.
8. **Pass et e-mails** : émission individuelle après vérification de la présence / de la décision commerciale ; consentement clair pour prélèvements récurrents et informations obligatoires avant tout paiement. Envoi idempotent seulement sur demande explicite du propriétaire.
9. **Tests obligatoires** : parcours de souscription sur deux comptes de test, échéances 1→5, double webhook, échec du troisième mois, remboursement d'une mensualité, paiement excessif, séparation PROD/TEST, droits avant/après solde, annulation et expiration.
10. **Activation** : aucune fusion ni déploiement Production sans autorisation explicite du propriétaire.

## Acceptation fonctionnelle souhaitée

- Une seule participante peut accéder à une offre personnalisée de 499 €.
- Les cinq paiements valent exactement 499 € TTC et le contrat s'arrête après la cinquième échéance.
- Pas de déblocage intégral si une échéance manque ou est remboursée ; l'accès pédagogique intermédiaire doit être explicitement choisi.
- **Visios en avance autorisées** : après premier paiement réellement capturé et si toutes les mensualités exigibles sont réglées, sous approbation explicite pour cette offre personnelle. Cette règle doit être réévaluée à la réservation et juste avant toute communication du lien Zoom ; elle n'altère pas les droits de l'offre progressive à 597 €.
- L'accès intégral aux modules et l'e-mail de bienvenue de la formation complète ne sont déclenchés qu'aux conditions métier finalisées et une fois le règlement complet effectué.
- Les offres existantes (597 €, Découverte 29 €, parcours 48 €/mois et Pass conférence comptant) continuent inchangées.

## Réalisé le 23 octobre 2026 — TEST seulement

- Prix et échéancier `499 € = 5 × 99,80 €`, calculs purs, règles de paiements vérifiés, remboursements et tests.
- Création de `conference_five_contracts`, `conference_five_transactions` et `conference_five_audit` **dans Supabase TEST uniquement** ; RLS activé et lecture/écriture client révoquées. Tables encore vides.
- Handler `lib/conferenceFiveSandboxPayPal.js` : recherche d'une invitation personnelle approuvée par le propriétaire, compte élève existant associé à un participant réellement marqué présent, création d'un plan Sandbox fini (cinq cycles), consentement d'essai explicite, et relecture des transactions PayPal par le serveur.
- API derrière la fonction **existante** `/api/rdv-config?conferenceFiveAction=…` ; ne crée pas une treizième fonction Vercel, limite du forfait Hobby.
- Prévisualisation `/formation/conference-5x-test` : accueil, connexion élève, simulation d'abonnement Sandbox, synchronisation et suivi, masqués hors du domaine TEST.
- Vérification des environnements : activation du handler **uniquement** si Vercel n'est pas en Production, que `SUPABASE_URL` vaut exactement le projet TEST et que `CONFERENCE_FIVE_SANDBOX_ENABLED=true` (non activé ici).
- Aucun appel PayPal réel, aucune invitation de cliente réelle, aucun e-mail commercial, aucun droit de formation modifié et aucun changement de Production.
- Les tests statiques et les tests unitaires sont exécutés lors des builds Vercel ; le parcours Sandbox réel reste à vérifier après configuration isolée.

## Encore bloquant avant une vente

1. Examen juridique et CGV de l'offre en cinq mensualités sur plus de trois mois.
2. Accès progressif au contenu de formation à définir et à implémenter. **Aucun accès intégral au premier paiement.**
3. Intégration transactionnelle des droits de visio `conferenceFiveMeetingEligibility` à la PR #169 : aujourd'hui, la règle est pure et testée, **non branchée à l'API de réservation**. La réservation existante reste limitée aux droits formation complète ; ne prétendre aucune admission temporaire validée.
4. Vérification en PayPal Sandbox par compte test uniquement, sans secret au frontend, avec approbation et réconciliation réelles, remboursements/échecs.
5. Validation d'un chemin d'invitation individuel pour la cliente concernée, qui doit être réellement présente dans la conférence et posséder un compte élève.

**NO-GO Production, NO-GO paiement réel, NO-GO envoi client** en attendant la revue juridique et les tests complets.
