# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Mesure d'audience (Vercel Web Analytics)

Instrumentation côté client, sans cookie, sans donnée personnelle. Active
uniquement en production sur `mediumia.fr` et `www.mediumia.fr` (build de
production). Désactivable avec `?noanalytics=1` (mémorisé), réactivable avec
`?noanalytics=0`.

**Dépendance** : `@vercel/analytics@2.0.1` — composant `<Analytics>` monté dans
`src/main.jsx`, filtrage dans `makeBeforeSend()`.

### Architecture à deux étages

| Étage | Outil | Ce qu'il mesure | Plan requis |
|---|---|---|---|
| Pages vues | Vercel Web Analytics | Trafic, parcours de navigation, sources | Hobby (gratuit) |
| Actions | Compteurs MediumIA | CTA rendez-vous, tirages, réservations, partages | Interne (pas de coût Vercel) |

Les compteurs MediumIA (`mediumiaMetrics.js` → `/api/rdv-config?analyticsAction=event`)
mesurent déjà toutes les actions importantes du site. Les événements personnalisés
Vercel (`track()`) ne sont **pas** utilisés car ils nécessitent le plan Pro.

### Confidentialité des pages vues

| Protection | Détail |
|---|---|
| Aucun cookie | Vercel Analytics fonctionne sans cookie |
| Pages sensibles exclues | `/rdv`, `/rdv/annuler`, `/rdv/solde`, `/pro`, `/agents` ne sont jamais comptées |
| Fragments supprimés | `#token=...` jamais envoyé |
| Tous les paramètres supprimés | `beforeSend` retire **tous** les paramètres de requête (UTM inclus) — aucune stat UTM détaillée disponible |
| Codes carte cadeau masqués | `/carte-cadeau/MED-ABCD-1234` → `/carte-cadeau/[code]` |
| Identifiants longs masqués | Segments ≥ 20 caractères alphanumériques → `[id]` |

### Tests

```bash
node --test tests/siteAnalytics.test.js
```

6 tests couvrent : production uniquement, opt-out, pages sensibles exclues,
confidentialité (sanitization, masquage), compteurs MediumIA intacts, et
branchements dans le code source.

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
