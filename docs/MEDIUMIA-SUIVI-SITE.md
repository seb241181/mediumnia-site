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
- Commit : `a20ccc2ccdcdc8dfe61bb4a4a521bcdbff43435c`
- Le composant `CalendarPicker` a été remplacé par une grille mensuelle avec points de disponibilité.
- Les étapes Date + Créneau ont été fusionnées en `Date & Heure`.

### Points à corriger avant validation / merge

1. **Le Preview Vercel du commit `a20ccc2` échoue au build.** Le script de prebuild `scripts/apply-rdv-next-availability.mjs` cherche encore une ancre supprimée de `src/components/rdv/RdvPublic.jsx` et lève : `Expected patch anchor not found`.
2. Le cahier des charges demandait que les jours confirmés sans disponibilité soient **non cliquables**. Dans le commit actuel, ils sont grisés mais restent cliquables.
3. La grille charge les disponibilités avec un appel API par jour, seulement regroupés par lots de 5. À conserver uniquement si aucune récupération mensuelle / par plage n'est raisonnablement possible ; sinon privilégier une stratégie réduisant le nombre de requêtes.
4. Ne pas considérer la refonte terminée tant que le Preview Vercel n'est pas `READY` et que le parcours réel n'a pas été vérifié.

### Statut

- **Décision UX : VALIDÉE**
- **Implémentation : EN COURS / À CORRIGER**
- **Production : NON MODIFIÉE par le commit Claude à ce stade**

---

## Règle de suivi

Lorsqu'une décision commerciale ou fonctionnelle est validée par Sébastien, la consigner ici avant ou au moment de son implémentation afin d'éviter qu'une ancienne valeur ou un ancien fonctionnement soit réintroduit lors d'une future modification.
