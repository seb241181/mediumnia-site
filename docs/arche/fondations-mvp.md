# L'Arche — fondation du réseau communautaire

**Statut (10 octobre 2026) : prototype privé, aucune inscription ouverte, aucune donnée de membre enregistrée.**

## Intention du fondateur

L'Arche est un réseau social spirituel gratuit imaginé par Sébastien Seguin. Sa mission est de réunir des personnes qui se sentent isolées dans leurs questionnements, pratiques ou sensibilités, sans les obliger à se définir comme « éveillées » ni à adhérer à une croyance.

> « Je souhaite rendre confiance à celui qui n'y croit plus, alors qu'il est juste différent. » — intention exprimée par Sébastien Seguin

**Positionnement :** les membres peuvent découvrir MediumIA et les activités du créateur librement, mais le réseau ne doit ni servir de tunnel commercial forcé ni exploiter la solitude pour vendre des consultations.

## Périmètre du premier MVP réel

1. **Comptes :** authentification Supabase séparée logiquement de l'activité commerciale (réutilisation possible d'un compte, mais aucune publication automatique des informations de MediumIA). Choix explicite de participer à L'Arche et acceptation de sa charte.
2. **Profils communautaires :** pseudonyme requis, photo facultative (avec contrôle d'upload), description et centres d'intérêt entièrement facultatifs, visibilité paramétrable. **Jamais** de récupération ou de publication automatique de `mediumia_profiles.full_name`, `birth_date`, `birth_time`, `birth_place`.
3. **Salon commun :** fil chronologique minimal, messages courts, signalements, limitation de débit, suppression de son contenu, filtrage anti-spam non intrusif. Pas d'indicateur trompeur de « membres en ligne ».
4. **Demandes de message privé :** demande d'autorisation et acceptation explicite avant ouverture de la conversation. Blocage utilisable à tout moment; plus aucune possibilité d'envoyer entre personnes bloquées; signalement disponible.
5. **Modération :** file de signalements, traitement humain, journal d'audit des interventions, processus d'appel/contestations, sanctions proportionnées, suspension/désactivation de compte; mesures adaptées au droit applicable.
6. **Vie privée :** politique spécifique au réseau, consentement libre et explicite pour informations de croyances ou pratiques spirituelles facultatives si nécessaire selon l'analyse RGPD, minimisation, accès, export et suppression, calendrier de rétention, pas d'indexation des profils privés ni des conversations.
7. **Sécurité :** tests RLS réels sur Supabase TEST avant toute migration en production, tests multi-comptes et isolation des messages privés, vérification des fichiers et de la capacité à signaler les abus. Aucun secret en frontend.
8. **Périmètre d'ouverture :** déterminer l'âge minimum et les vérifications adaptées avant lancement (une première ouverture aux majeurs serait plus prudente), établir les règles pour situations de détresse et les interdictions de conseil médical, psychologique ou financier de substitution.

## Architecture proposée

- **Frontend :** une route `/arche` distincte de `/reseau` (annuaire professionnel). La maquette `ArchePage.jsx` ne lit ni n'écrit dans Supabase; les exemples sont explicitement fictifs.
- **BDD (à créer en migrations revues) :** `arche_profiles`, `arche_public_posts`, `arche_dm_requests`, `arche_dm_threads`, `arche_dm_messages`, `arche_blocks`, `arche_reports`, `arche_moderation_audit`. À ce stade, ce sont des **noms proposés**, pas des tables existantes.
- **Séparation :** pas de lecture de données MediumIA/clients/RDV par le réseau. Les personnes peuvent avoir un compte MediumIA sans jamais créer de profil Arche.
- **RLS :** lecture d'un profil uniquement s'il est visible; mise à jour uniquement par son propriétaire; posts publiés accessibles aux membres autorisés; DM lisibles par les deux participants seulement si la demande a été acceptée; refus si blocage; report autorisé à l'auteur du signalement + modérateurs; pas d'injection de `user_id` contrôlée par le client; RPC backend pour les opérations sensibles.
- **Anti-abus :** limites de création des profils et des messages, protection contre le spam et le harcèlement, ralentissement des invitations, pièces jointes désactivées dans la v1.
- **Prévisualisation :** Vercel Preview. Le prototype contient des messages fictifs, des actions locales en mémoire uniquement, aucune inscription et aucun paiement. La route porte `noindex,nofollow` tant que le lancement n'est pas approuvé.

## Validation de lancement (bloquants)

- [ ] Maquette validée par Sébastien sur mobile et ordinateur
- [ ] Charte, confidentialité réseau et conditions d'utilisation adaptées revues
- [ ] Décision sur l'âge minimum et l'usage des photographies
- [ ] RLS et tests de deux utilisateurs, y compris tentative d'accès au DM d'un tiers
- [ ] Blocage, signalement, suspension et suppression opérationnels
- [ ] Limites d'envoi, contrôle anti-spam, sauvegarde et récupération des incidents
- [ ] Validation des abonnements realtime, aucune fuite des messages privés
- [ ] Pilote fermé avec quelques membres volontaires et modération active
- [ ] Autorisation explicite avant toute ouverture au public

## Préparation ABC Talk

**Message simple :** « Je prépare L'Arche, un futur réseau social spirituel gratuit. L'idée vient de personnes rencontrées au cabinet qui se sentent seules parce qu'elles n'osent pas parler de leurs expériences. Je veux leur permettre de créer un profil, de participer à un salon commun et d'échanger librement, sans jugement ni pression commerciale. Le projet est encore en construction : ma priorité est la qualité des liens et la sécurité des membres. »

Ne pas présenter la maquette comme une communauté ouverte ou déjà fréquentée.
