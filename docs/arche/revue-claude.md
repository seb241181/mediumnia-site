# L'Arche — revue indépendante à confier à Claude Code
**Statut : PR #146, maquette protégée en Preview uniquement.**
**Drive :** https://drive.google.com/drive/folders/11xMRsV8oTFn9csf92plb_PHU0ousw5p9
**Brief fondateur :** https://docs.google.com/document/d/1iP25gJ6GDBlXWRA8oYAgEc3Fwz6hoWLfGX2Bw8Yh47Q/edit

## Vision exprimée par le fondateur
Sébastien Seguin veut bâtir un réseau social spirituel GRATUIT, où les personnes qui se sentent seules dans leur sensibilité, leurs pratiques ou leurs questions puissent s'exprimer sans jugement. Il souhaite être reconnu pour avoir créé un lieu utile, sans faire dépendre la vie de la communauté de ses consultations payantes. Croire, chercher et douter ont la même place.

## Contraintes déjà validées
- Un compte MediumIA existant ou créé gratuitement; aucune formation à acheter.
- Une adhésion explicite à L'Arche et un **profil communautaire séparé** (pseudo requis pour publier; photo, présentation et pratiques facultatives), sans republication de données commerciales/personnelles MediumIA.
- Salon public pour les membres, puis DM seulement après acceptation de la demande de contact.
- Démarchage commercial privé interdit, avec blocage, signalement et modération.
- Identité visuelle cohérente avec MediumIA: #FAFAF7 crème, #1A1535 bleu nuit, #C9A84C or, #4A3F6B secondaire; interface sobre et lisible, sans faux membres ni métriques factices.
- Le code de la PR #146 **est une maquette interactive sans authentification ni persistance**, non publiée, et doit le rester jusqu'à tests et revue.
- Ne pas toucher aux paiements PayPal, aux réservations ni aux données des clients/élèves.
- Préparer une présentation honnête pour ABC Talk : un projet en construction, pas un réseau déjà fréquenté.

## Travail attendu de Claude (REVUE UNIQUEMENT, aucune fusion ni déploiement sans GO)
1. Vérifie la PR #146 et la structure actuelle de MediumIA (vite/react/supabase-js2).
2. Propose **cinq améliorations UX concrètes** pour comptes, profils, salon et DM, adaptées au mobile et au design MediumIA.
3. Conçois le modèle d'identité : un compte MediumIA, un profil Arche choisi et séparé; cas d'un élève existant, d'un nouveau gratuit, et d'un utilisateur qui refuse l'adhésion. Ne jamais exposer les champs de mediumia_profiles (date, heure, lieu de naissance, nom complet).
4. Propose les tables et migrations isolées : profils, publications/réponses, demandes DM, conversations, messages, blocs, signalements, audit modération. Pour chaque table, précise les politiques RLS : visibilité, INSERT/UPDATE/DELETE propriétaire, DM uniquement participants, empêcher l'accès des tiers et les invitations lorsque blocage.
5. Propose la modération minimum viable, rate-limits, prévention du harcèlement, erreurs et suppression/export RGPD. Traite le fait que certaines données révèlent convictions religieuses/philosophiques.
6. Définis **l'ordre sûr des PR**, avec tests automatisés (RLS multi-utilisateurs réels en TEST), rollback, critères GO/NO-GO; commencer par profil+salon modéré avant les DM.
7. Challenge le modèle de lancement : pilote fermé 20–30 majeurs volontaires, capacité humaine de modération, conditions d'ouverture publique. Quelles métriques qualitatives regarder sans sacrifier le gratuit ?
8. Vérifie si le nom de travail « L'Arche » expose à des risques de confusion avec des marques/associations existantes; proposer une méthode de vérification, pas de conclusion juridique non étayée.

**Livrable demandé :** une proposition hiérarchisée priorités P0/P1/P2 avec idées, risques, hypothèses et questions à Sébastien, **sans écrire ni lancer de migration PROD** et sans modifier cette PR avant revue de la proposition. Pour toute action technique, limiter à lecture et tests sans effet; demander un GO explicite avant modification.

**Valeur fondatrice à préserver :** « Je souhaite rendre confiance à celui qui n'y croit plus, alors qu'il est juste différent. »
