# Coulisses RDV - synthese technique publique

## Confidentialite et perimetre

Branche codex/rdv-coulisses-followup depuis main 2465ba06, independante de #156.
Le depot est PUBLIC. Aucun montant, volume d'activite Production, identifiant de
transaction ou contenu client ne doit etre publie dans cette PR.
Le rapport d'audit detaille est conserve dans le dossier local prive
Documents/MediumIA-audits-prives, fichier rdv-encaissements-2026-10-15.md.
Les captures et fixtures versionnees sont exclusivement fictives.

## Audit realise en lecture seule

SELECT de schema et agregats seulement : paiements complets, arrhes, soldes,
remboursements, transferts, rapprochement des captures et du grand livre, unicite
des ordres/captures/references, TTC/HT/TVA, soldes et ecritures non rattachees.
Le rapport prive distingue ce qui est enregistre dans MediumIA de ce qui est
independamment verifie chez le prestataire. Aucune nouvelle verification PayPal
Live effectuee ici et aucun ancien controle des huit ordres recommence.
L'absence de capture locale ne prouve jamais l'absence de debit chez PayPal.
Aucune correction, recapture, annulation ou decision financiere automatique.

## Changements prepares

- Acces direct aux demandes par statut, compteurs HEAD exacts independants de la
  liste limitee a 100 ; liste filtree rechargee cote serveur, etat inconnu explicite.
- RDV du jour et des prochains jours : non regles dans la liste principale ;
  integralement regles dans details ferme par defaut. Solde inconnu, remboursement,
  prix nul ou trop-percu restent visibles ; totaux comptables inchanges.
- Annulation : fiche GET proprietaire, controle arrhes/soldes/ecritures/remboursements/
  transferts, confirmation locale explicite, plan Google et preservation de l'historique.
  execution_enabled=false en dur ; POST/PUT/DELETE refuses, aucune mutation ni reseau.
  La confirmation signifie seulement que le controle a ete examine, pas une annulation.

## Etape d'annulation future - non implementee/non activee

Une phase distincte devra ajouter l'executeur transactionnel proprietaire : verrouiller
reservation et paiements, relire statuts/montants et version apres confirmation,
refuser les etats incertains, conserver la reservation en cancelled, journaliser
acteur/motif/cle idempotente et traiter les demandes liees sans perdre l'historique.
Creer dans la meme transaction un job durable pour l'evenement Google deja lie,
sans suppression de booking ni ecriture financiere ; reutiliser le modele de job
Lumia existant apres revue de son ownership et de ses effets, jamais l'activer ici.
Le worker devra confirmer la suppression de la seule projection Google, traiter
404/410 comme idempotents et timeout comme incertain/reessayable ; aucun envoi client.
Tant que cette phase n'est pas validee en TEST, le bouton ne peut annuler aucun RDV.
Les cas payes gardent une decision financiere separee ; aucun reset de capture.

## Validation et decision

13 nouveaux tests cibles ; npm test final : 848/848, aucun echec/skip.
Build complet et bundle V2 valides. ESLint cible reussi sur nouveaux modules,
fixtures, tests et script adapte.
Chrome neuf : 20/20 controles sur desktop 1440 et mobile 390, composants reels avec
donnees fictives et toutes les requetes externes bloquees. Captures dans docs/captures.
Fermeture initiale des deux groupes payes, ouverture, filtre Contacte, confirmation
locale obligatoire, aucun POST ni exception et aucun debordement de page/dialogue.
Ces captures ne prouvent pas un login Production ni un changement dans le site public.
Le prebuild preserve le composant natif et ses controles d'encaissement ; son ancien
chemin reste disponible pour les anciennes vues. Sorties generees exclues du commit.
Aucune migration distante, ecriture Production, annulation reelle, remboursement,
notification client ni fusion. PR independante a conserver en brouillon.
Production : NO-GO.
