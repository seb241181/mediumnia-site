# free-human-design (extrait)

`lib/astroHouses.js` reprend les calculs d'angles et de maisons de
[free-human-design](https://github.com/adamblvck/free-human-design) 1.0.1
(`src/hd/houses.js` et `normalizeAngleDegrees` de `src/calc/mandala.js`),
sous licence MIT (voir `LICENSE`).

Pourquoi : la version 1.0.1 a été retirée du registre npm le 19/11/2026, ce qui
faisait échouer toute installation du site. Ce code est identique dans la
version 2.0.0. Il a été vérifié identique au résultat près (écart 0 sur
15 000 cas, latitudes polaires comprises) avant de remplacer la dépendance.
