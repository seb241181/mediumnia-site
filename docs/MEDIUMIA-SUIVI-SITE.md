# MEDIUMIA — SUIVI DU SITE

Document de référence pour les décisions produit, commerciales et techniques validées pour `mediumia.fr`.

Dernière mise à jour : 5 septembre 2026.

## 1. CHRONOSPHÈRE — TARIFICATION VALIDÉE

### Décision commerciale

- **Offre cible : 9,90 € TTC pour 3 tirages Chronosphère.**
- L'ancien fonctionnement **5,00 € TTC pour 1 tirage unique** est désormais considéré comme **tarif / fonctionnement historique à remplacer**.
- Le prix de 9,90 € correspond à un **pack de 3 crédits de tirage**, pas à trois paiements séparés.

### Fonctionnement attendu

1. Le client paie une seule fois **9,90 € TTC** via PayPal.
2. Après confirmation serveur du paiement, son accès reçoit **3 crédits Chronosphère**.
3. Chaque tirage terminé consomme **1 crédit**.
4. Les crédits restants persistent afin que le client puisse revenir plus tard utiliser les tirages non consommés.
5. Tant qu'il reste au moins 1 crédit, **aucun nouveau paiement PayPal ne doit être demandé**.
6. Une fois les 3 crédits consommés, proposer l'achat d'un nouveau pack de 3 tirages à 9,90 € TTC.
7. Le crédit ne doit jamais être accordé sur la seule foi du navigateur : l'attribution et la consommation doivent être contrôlées côté serveur.
8. Prévoir une protection contre la double consommation d'un même crédit en cas de double clic, reprise ou requêtes concurrentes.

### Statut

- **Décision validée : OUI**
- **Implémentation sur le site : À FAIRE**
- **Production actuelle connue avant modification : 5,00 € TTC / tirage unique**

---

## 2. RDV — CALENDRIER MENSUEL

### Décision UX validée

Remplacer la sélection de dates précédente par un calendrier mensuel complet :

- mois entier visible ;
- navigation mois précédent / suivant ;
- point doré uniquement sur les jours ayant réellement au moins un créneau disponible ;
- clic sur un jour disponible → affichage des horaires sous le calendrier ;
- jours passés et jours complets non sélectionnables ;
- priorité au rendu mobile ;
- moteur de disponibilités, buffers, `max_per_day`, holds, PayPal, Google Meet, e-mails et annulation H-24 inchangés.

### Travail Claude du 5 septembre 2026

- Branche : `claude/quirky-keller-gxgAV`
- Commit initial : `a20ccc2ccdcdc8dfe61bb4a4a521bcdbff43435c`
- Correctif : `c1b5ce303d0b8f737f9aa3c237b55525c5508468`
- Le composant `CalendarPicker` a été remplacé par une grille mensuelle avec points de disponibilité.
- Les étapes Date + Créneau ont été fusionnées en `Date & Heure`.
- Le Preview Vercel du correctif est `READY` et le nouveau parcours a été vérifié visuellement.

### Statut

- **Décision UX : VALIDÉE**
- **Preview : VALIDÉ visuellement**
- **Production : NON MODIFIÉE par la branche Claude tant qu'aucun merge n'est demandé**

---

## 3. RDV SÉBASTIEN — CAPACITÉ ET HORIZON

### Décision validée le 5 septembre 2026

Objectif de capacité : environ **100 rendez-vous par mois**.

Configuration de référence :

- jours ouverts : **lundi à vendredi** ;
- créneaux quotidiens : **08:00, 09:30, 11:00, 13:30, 15:00** ;
- soit **5 créneaux maximum par jour** ;
- `max_per_day = 5` ;
- horizon de réservation : **365 jours** ;
- préavis minimum : **24 h** ;
- buffer après rendez-vous : **30 min** ;
- buffer avant rendez-vous : **0 min**.

Le créneau de **08:00 était déjà présent du lundi au vendredi** dans les règles de disponibilité au moment de la vérification ; aucune duplication n'a été créée.

### Statut

- **Base MediumIA mise à jour : OUI**
- `booking_horizon_days = 365`
- `max_per_day = 5`

---

## Règle de suivi

Lorsqu'une décision commerciale ou fonctionnelle est validée par Sébastien, la consigner ici avant ou au moment de son implémentation afin d'éviter qu'une ancienne valeur ou un ancien fonctionnement soit réintroduit lors d'une future modification.
