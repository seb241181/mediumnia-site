# Création Rencontres simplifiée

Examen initial : cinq intentions détaillées, trois encadrés introductifs et plusieurs paragraphes avant activation. Remplacement par une fiche courte, uniquement dans Rencontres.

Avatar libre parmi quatre symboles intégrés ou photo simulée (icône, aucun fichier). Pseudo L’Arche prérempli, modifiable dans le profil Rencontres avec les mêmes règles de la maquette : non vide, 32 caractères maximum. Bio facultative 300 caractères, ville/région facultative 80 caractères, aucune géolocalisation. Un bouton principal « Créer mon profil ». Centres d’intérêt et cinq intentions détaillées accessibles via « Compléter mon profil ».

Correspondance : Amitié → amitié / échanges / binôme ; Amour → affinités de cœur / relation amoureuse ; Les deux → les cinq. Les réglages détaillés mettent aussi à jour le choix court. Les filtres et invitations conservent les identifiants historiques. L’intention relation amoureuse reste affichée uniquement après choix explicite.

Profil invisible avant création et confirmation 18+. Participation volontaire, masquage et départ conservés. Les photos des autres profils restent conditionnées à l’acceptation. Aucune image privée ni upload. Tout reste dans la mémoire de l’onglet, perdu au rechargement. Le Fil et Messages ne sont pas modifiés.

Vérification : 823 tests unitaires, 25 Playwright ; 5 tests de création rejoués après compacité mobile, puis 2 captures finales revérifiées après simplification du titre. Build, lint ciblé et diff --check réussis. Couverture des trois choix, limites de champs, pseudo/bio/région, absence d’upload, masquage, remise à zéro au rechargement, invitations, filtres, blocages et messagerie commune. Capture 390 px : bouton de création entièrement au-dessus de la navigation fixe.
