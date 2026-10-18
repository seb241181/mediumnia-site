# Agenda unifie - audit et plan

## Perimetre

Cahier des charges : seb241181/mediumia#1. Implementation uniquement dans
seb241181/mediumnia-site, branche codex/admin-unified-agenda, base
23a5df6f06d73984312695e8d3727bcba9d6d694. Aucun acces aux donnees Production.

## Audit des sources

- RdvDashboard.jsx : portail authentifie, demandes, prochaines reservations,
  caisse DailyPayments et comptabilite. Les listes existantes ne constituent pas
  un agenda complet (limitation et selection des prochaines reservations).
- api/rdv-admin.js : requireAuth puis controle owner par operation. Etendre
  ce point d'entree, sans ajouter de chemin d'administration anonyme.
- bookings : source metier des reservations MediumIA. google_event_id est le
  lien avec leur projection Google, pas une preuve de paiement.
- rdvDayPayments.js : registre rdv_financial_entries et remboursements signes.
  Les montants MediumIA ne prouvent pas une verification actuelle chez PayPal.
- googleCalendarEvents.js : connexion chiffree existante, rafraichissement OAuth.
  syncBookingToGoogleCalendar retourne already_synced lorsqu'un lien existe :
  ne convient PAS au deplacement d'une reservation existante.
- lumiaBookingCancelApi.js / lumiaCalendarSync.js : intentions humaines,
  execution atomique, journal et file de synchronisation. Ne pas contourner ces
  protections par un DELETE Google ou une mise a jour directe de bookings.
- La politique Lumia actuelle autorise mediumia.booking.cancel sous conditions ;
  le commentaire dormant de rdv-admin est ancien. Ne pas ajouter d'autorisation.
- Les evenements exclusivement Google n'ont ni paiement ni client MediumIA connus.
- pretest/prebuild appliquent des scripts qui reecrivent les sources : verifier
  le diff genere separement et ne pas le confondre avec les changements manuels.

## Etapes

1. Consultation serveur bornee, owner-only, pagination explicite et erreurs
   partielles visibles. Lecture Google via la connexion existante, sans mutation
   d'evenement. Deduplication par identifiant lie, jamais titre/date/client.
2. Interface jour/semaine/mois, filtres et detail, donnees fictives pour captures.
   Employer un moteur calendrier maintenu, sans fonctionnalite premium payante.
3. Mutations : extraire/reutiliser les protections metier sans detourner une
   conversation Lumia. Pour le deplacement, preparer une transaction avec verrou,
   controle de version/conflit et outbox durable Google avant d'activer le bouton.
   Annulation distincte du remboursement ; aucune suppression d'historique.
4. Tests comportementaux, tests SQL locaux si nouvelle transaction, suite complete,
   build et controles desktop/mobile ; PR en brouillon, aucune fusion.

## Migrations / risques / decisions

Aucune migration necessaire pour la consultation. Une migration additive locale
sera probablement necessaire pour la replanification et son outbox ; son contenu
doit etre examine avant toute application distante. Ne rien appliquer a distance.
Risques : donnees partielles, changement d'heure Paris, recurrence Google,
evenement lie hors fenetre, timeout ambigu et course entre paiement/annulation.
Refuser les actions plutot que degrader silencieusement les controles.

GO : developpement et tests isoles. NO-GO : Production, remboursement reel,
notification client, mutation Google reelle, fusion. La lecture du code ne vaut
pas validation d'une synchronisation distante ni d'un schema deploye.

## Lot 1 implemente et verifie

- GET rdv-admin?action=agenda : owner-only, fenetre UTC de 62 jours maximum,
  reservations chevauchantes (pas seulement debutant dans la fenetre), pagination
  bornee, liens Google recherches hors filtre de date/statut et montants repris
  depuis le registre existant. Echec financier = montant inconnu, jamais zero.
- Lecture Google uniquement GET, recurrence deployee par Google, pagination,
  budget reseau global 8 s, redirections refusees, jetons jamais retournes.
- Calendrier FullCalendar standard 6.1.20, fuseau Paris explicite via Luxon : jour,
  semaine, mois, heures 00-24 accessibles par defilement, filtres origine/statut/
  paiement/recherche. Evenements Google seuls sans client ni paiement inventes.
- Integration dans les Coulisses : listes, caisse et operations existantes conservees.
- 15/15 nouveaux tests serveur avec doubles de test, notamment owner, panne,
  pagination, doublon Google, lien hors fenetre et paiement inconnu.
- npm test : 896/896, zero echec/skip. npm run build : reussi, 896 tests prebuild,
  verification bundle V2 et 30 pages HTML (URL TEST et cle factice).
- ESLint cible : reussi. 18 controles navigateur desktop 1440 et mobile 390,
  fuseau navigateur New York pour ne pas dependre du fuseau du Mac ; donnees
  fictives, routes API interceptees, requetes externes bloquees. Captures dans
  docs/agenda-captures/. Ce n'est PAS une validation distante Google/Supabase.
- Sorties des scripts apply-* retirees du diff depuis l'index du checkout isole.
- npm audit : 14 alertes (11 hautes, 2 moderees, 1 faible), aucune dans les paquets
  FullCalendar/Luxon ajoutes. Pas de correction globale hors perimetre.
- Avertissement build : chunk administrateur ~512 ko ; envisager chargement
  differe du calendrier lors du lot suivant, sans refonte du site.

## Restant avant PR prete a fusionner

Cette PR est un premier lot de CONSULTATION, pas l'agenda complet livre.
Aucune commande de modification, annulation, suppression ou remboursement n'est
ajoutee. permissions.move/cancel/refund restent fausses cote serveur.

1. Concevoir le contrat de replanification atomique (version, conflits incluant
   buffers, verrous financiers, idempotence) et son outbox Google durable. Presenter
   la migration additive avant application ; aucun DDL distant dans ce lot.
2. Reutiliser le noyau d'annulation protege sans fabriquer une conversation Lumia
   ni ajouter une action autorisee ; relire l'intention et les paiements a execution.
3. Ajouter historique/journal et filtres de modalite lorsque la source exacte de
   la modalite choisie est resolue (booking_services.modality = choix proposes,
   pas preuve du choix reel). Google uniquement reste inconnu.
4. Tests transactionnels locaux des mutations, conflits, >48 h, doubles demandes,
   panne et reprise Google ; verification authentifiee contre un environnement TEST
   isole explicitement, jamais une Preview heritant des secrets Production.
5. Revue finale distincte avant tout GO Production. Aucun deplacement/annulation
   reel, aucun remboursement, aucun e-mail et aucun deploiement lance ici.
