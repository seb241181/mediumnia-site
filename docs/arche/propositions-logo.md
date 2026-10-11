# L’Arche — filiation avec l’œil MediumIA

Ces trois nouvelles pistes remplacent dans le sélecteur les premières propositions Passage, Refuge et A habité, non retenues. Exploration locale sur `codex/arche-visuel-humain`, uniquement dans l’en-tête de la messagerie. Aucun choix définitif ni extension aux autres écrans.

## Référence examinée

`public/images/brand/MEDIUMIA_symbol_header.png`, effectivement utilisé dans `SiteNav.jsx` : œil doré avec iris, grande courbe protectrice, rayons fins et étoiles. Les nouveaux SVG en reprennent l’œil, le halo en arche et la lumière dorée, avec moins de traits pour rester lisibles dans une application. Ils sont dessinés directement dans React ; aucune image IA, aucune dépendance ni reproduction exacte de l’asset MediumIA.

## Les pistes

1. **Regard refuge** : œil or et iris bleu nuit sous une courbe protectrice ; trois traits de lumière courts. La plus proche de la composition MediumIA, avec une lecture plus douce et plus simple.
2. **Porte ouverte** : l’œil traverse une arche ; son iris devient une petite ouverture lumineuse. Le lien au passage et au refuge est plus explicite.
3. **Lueur partagée** : œil aux courbes ouvertes, lueur discrète dans l’iris et trois rayons fins. Le regard et la lumière prennent le premier plan.

Le nom **L’ARCHE** et sa typographie sont conservés. Couleurs : bleu nuit `#17233F`, or doux `#B49450`, lumière champagne. Les trois variantes sont sélectionnables en cliquant sur le logo dans la messagerie ; sélection en mémoire locale uniquement.

## Vérification

Build, ESLint du composant et 14 tests existants L’Arche réussis. Chrome desktop 1440 px et mobile 390 px, appels externes bloqués : sélection et fermeture des trois variantes, clavier/Échap, cibles ≥44 px, aucun débordement ni erreur JavaScript. `noindex,nofollow` conservé. Le logo initial reste en place sur les autres onglets ; aucune modification de la logique sociale.

Comparaison : `captures/logos-filiation-mediumia.png`. Captures complètes : `logo-regard-interface.png`, `logo-porte-interface.png`, `logo-lueur-interface.png`. Les anciennes captures restent disponibles comme historique de la piste écartée.

Préférence proposée : **Regard refuge**, pour sa filiation immédiate avec MediumIA et le lien entre regard et accueil. Attendre le choix de Sébastien. Aucun merge, push ou déploiement.
