# Personnalisation de la messagerie — proposition à valider

Sur la branche locale `codex/arche-visuel-humain`, base validée `e73df1a`. Seule la messagerie et son avatar intégré sont modifiés. Aucun autre écran redessiné, aucun service distant, aucune migration, aucun push, merge ou déploiement.

## Interactions

- Six choix via les pastilles : Ciel, Rose, Lavande, Menthe, Pêche et Nuit. Chaque choix change réellement la couleur de ses propres bulles et la teinte du panneau. Le cadre rose–lavande–ciel validé reste en place ; Nuit utilise une bulle bleu nuit, sans assombrir toute l’application.
- « Mon style » : deux avatars illustrés et trois avatars emoji, avec aperçu immédiat sur ses messages et sa signature. Aucun visuel IA ni dépendance ajouté.
- Humeur limitée à 60 caractères, visible dans sa signature de messagerie. État React partagé avec le réglage existant, sans modifier le profil général.
- « Photo de profil · bientôt » est désactivé ; aucun champ fichier, lecture locale, upload ou stockage.
- Tous les choix disparaissent au rechargement ; aucune persistance navigateur ni distante.
- Le menu « ··· » conserve les actions de signalement/blocage et permet d’autoriser les Lueurs de ses proches, désactivées par défaut.

## Lueur

Secousse de 2 pixels, 380 ms, et halo doré de 600 ms. Le texte de confirmation reste utilisable lorsque les mouvements sont réduits. Dans ce mode, aucune secousse, aucun halo animé ni vibration.

L’envoi exige une conversation acceptée et le consentement du destinataire fictif. La réception simulée exige son propre consentement. Aucun signal après blocage ; retirer le consentement coupe l’effet en cours. Une limite de 10 secondes par sens est contrôlée par référence synchrone, évitant le double clic ; l’envoi est également désactivé visuellement pendant ce délai. Changer de contact ne réinitialise pas cette limite.

Sur mobile, une vibration facultative de 40 ms accompagne uniquement la réception autorisée lorsque l’API existe. Son indisponibilité ou une exception n’empêchent pas l’animation visuelle. Aucun son.

## Vérifications réalisées

- Build Vite et ESLint : réussis. Suite existante : **805/805** tests réussis, inchangés.
- Chrome automatisé en 390 × 844 et 1440 × 1000, appels externes/API bloqués : aucune erreur JavaScript, aucune requête à Supabase observée.
- Six couleurs et six teintes de panneau distinctes. Contraste des textes de ses bulles : **6,68 à 8,60:1**, supérieur au seuil AA de 4,5:1.
- Cinq avatars sélectionnables ; humeur de 80 caractères ramenée à 60 ; option photo désactivée, aucun champ fichier.
- Invitation obligatoire ; réception impossible sans consentement ; effet autorisé ensuite ; répétition immédiate et avant 10 secondes refusée ; nouvel effet possible après le délai.
- Retrait du consentement : effet interrompu. Blocage/signalement : plus d’effet ni de saisie ni de bouton Lueur.
- Mode de mouvement réduit : aucun halo visible ni animation, aucun appel à la vibration.
- Vibration mobile vérifiée avec une API simulée, sans validation sur un appareil physique ; aucun appel sur desktop.
- Personnalisation conservée entre onglets, puis réinitialisée après rechargement.
- Aucun débordement horizontal ; boutons visibles de la messagerie ≥ 44 × 44 px ; `noindex,nofollow` conservé.

Captures : `captures/messagerie-personnalisation-1440.png` et `captures/messagerie-personnalisation-390.png`. Scénario et heures explicitement fictifs. Attendre la validation avant toute extension au Fil, aux Cercles ou au profil général.
