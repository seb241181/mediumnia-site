import { readFile, writeFile } from 'node:fs/promises'

const timelinePath = new URL('../lib/oracleTimeline.js', import.meta.url)
const pagePath = new URL('../src/components/ChronospherePage.jsx', import.meta.url)

function replaceRequired(source, before, after, label) {
  if (source.includes(after)) return source
  if (!source.includes(before)) {
    throw new Error(`Chronosphere V2 patch drift: ${label}`)
  }
  return source.replace(before, after)
}

let timeline = await readFile(timelinePath, 'utf8')

const oldClosedIntro = `- Si le thème est formulé comme une question qui appelle naturellement une orientation claire — par exemple « Est-ce que… ? », « Vais-je… ? », « Dois-je… ? », « Est-ce le bon moment… ? », « Ce projet peut-il… ? » — commence la lecture par une courte section intitulée « La tendance du tirage ».`
const newClosedIntro = `- Si le thème est formulé comme une question qui appelle naturellement une orientation claire — par exemple « Est-ce que… ? », « Vais-je… ? », « Dois-je… ? », « Est-ce le bon moment… ? », « Ce projet peut-il… ? » — ajoute, après le « Résumé en 30 secondes », une courte section intitulée « La tendance du tirage ».`

timeline = replaceRequired(timeline, oldClosedIntro, newClosedIntro, 'directional intro')

const oldOpenIntro = `- Si le thème n'est PAS une question fermée, n'ajoute pas cette section et commence directement par « La photographie de l'instant ».`
const newOpenIntro = `- Si le thème n'est PAS une question fermée, n'ajoute pas « La tendance du tirage ». Après le « Résumé en 30 secondes », commence directement par « La photographie de l'instant ».`

timeline = replaceRequired(timeline, oldOpenIntro, newOpenIntro, 'open-theme intro')

const oldStructure = `REDIGE ENSUITE LA LECTURE EN 6 PARTIES, précédées de « La tendance du tirage » uniquement si le thème est une question fermée comme défini plus haut :
1. « La photographie de l'instant » — décris la dynamique actuelle en la reliant directement au thème. Appuie-toi sur l'axe de la carte principale et, si pertinent, sur un élément céleste calculé qui éclaire le climat symbolique du moment.
2. « La ligne qui se dessine » — décris ce vers quoi cette dynamique peut naturellement tendre SI ELLE SE POURSUIT, sans prédiction certaine et sans fatalisme.
3. « Le point de bifurcation » — identifie le choix, l'attitude, la prise de conscience ou le mouvement concret qui pourrait modifier la trajectoire. Il doit découler réellement des cartes et peut être précisé uniquement par des données astrologiques explicitement calculées.
4. « La fenêtre d'action » — réponds clairement à la question implicite « quand agir ? ». Utilise uniquement les fenêtres futures calculées. Donne d'abord la fenêtre prioritaire, puis au maximum une alternative réellement utile. Si une zone de prudence est calculée, indique-la brièvement. Explique POURQUOI la fenêtre est plus porteuse en citant seulement les aspects fournis. Pour un thème travail, projet ou finances, formule une recommandation d'action concrète mais non financièrement prescriptive : préparer, lancer, présenter, négocier, décider, structurer ou patienter selon le cas.
5. « Les trois fréquences » — nomme les trois cartes et montre comment elles dialoguent. Explique clairement ce que la carte principale porte et comment chaque résonance la transforme ou la précise. Évite de simplement répéter les trois fiches.
6. « L'acte de réalignement » — reprends le GESTE et le DECRET de la carte principale fidèlement, sans changer leur sens ni introduire un autre rituel. Termine par une courte phrase rappelant que la ligne de temps reste mobile et se transforme avec les choix, les actes et l'état intérieur.`

const newStructure = `REDIGE LA LECTURE SELON CETTE STRUCTURE V2. Respecte exactement les intitulés ci-dessous afin que l'interface puisse les mettre en valeur.

AVANT LES PARTIES NUMEROTEES
« Résumé en 30 secondes » — TOUJOURS présent. En 2 à 4 phrases maximum, donne la photographie la plus utile du tirage : ce qui domine, ce qui bouge et le point concret à retenir. Il doit pouvoir être lu seul et donner immédiatement de la valeur, sans reprendre mot pour mot les parties détaillées.
« La tendance du tirage » — UNIQUEMENT si le thème est une question fermée comme défini plus haut. Choisis l'une des quatre orientations autorisées puis donne une explication courte et nette.

PUIS REDIGE 9 PARTIES :
1. « La photographie de l'instant » — décris la dynamique actuelle en la reliant directement au thème. Appuie-toi d'abord sur la carte principale et, si pertinent, sur un élément céleste calculé qui éclaire le climat symbolique du moment.
2. « La fréquence principale » — approfondis la carte principale : ce qu'elle met en mouvement, sa ressource, sa vigilance et ce qu'elle demande concrètement dans CE thème. N'en fais pas une fiche générique de la carte.
3. « Les deux résonances » — explique séparément ce que chaque résonance vient préciser, amplifier, déplacer ou nuancer autour de l'axe principal.
4. « Ce que racontent les trois fréquences ensemble » — produis une vraie synthèse intégrée. Fais apparaître le mouvement commun des trois cartes en une trajectoire simple et mémorable, sans révéler la mécanique interne des combinaisons.
5. « Le ciel de naissance et le contexte astrologique » — retiens seulement 2 à 5 éléments célestes calculés réellement utiles au thème. Explique-les en français clair, sans réciter un thème astral et sans transformer une position astrologique en vérité psychologique.
6. « La ligne de temps » — réponds clairement à « quand préparer, avancer ou ralentir ? ». Utilise uniquement les fenêtres futures calculées. Donne la fenêtre prioritaire, au maximum une alternative utile et la zone de prudence si elle existe. Explique pourquoi en citant seulement les aspects explicitement fournis. Pour travail, projet ou finances, propose des verbes d'action concrets mais non prescriptifs : préparer, tester, présenter, négocier, structurer, décider ou patienter.
7. « Les deux chemins possibles » — présente deux trajectoires conditionnelles : a) « Si tu maintiens la dynamique actuelle… » ; b) « Si tu modifies l'élément clé… ». Décris des tendances plausibles, jamais des événements garantis. L'élément clé doit découler du tirage.
8. « Vos leviers concrets » — donne exactement trois leviers courts et applicables : « À faire maintenant », « À préparer », « À ne pas forcer ». Ils doivent être spécifiques au thème et cohérents avec les cartes et le timing.
9. « La question que Chronosphère vous renvoie » — termine la lecture détaillée par UNE question d'introspection précise, directement reliée au point de bifurcation du tirage. Elle doit aider à décider ou à clarifier, pas simplement sonner spirituelle.

L'acte de réalignement est affiché séparément par l'interface à partir du GESTE et du DECRET exacts de la carte principale : ne crée donc PAS de dixième partie et ne répète pas le geste ni le décret dans le texte de lecture.`

timeline = replaceRequired(timeline, oldStructure, newStructure, 'V2 reading structure')

const oldFinal = `La réponse finale doit être immédiatement lisible par le client : la tendance directionnelle si applicable, puis uniquement les 6 parties demandées, sans préambule technique, sans notes internes et sans explication de ta méthode.`
const newFinal = `La réponse finale doit être immédiatement lisible par le client : d'abord « Résumé en 30 secondes », ensuite « La tendance du tirage » uniquement si elle s'applique, puis les 9 parties demandées. Aucun préambule technique, aucune note interne, aucune explication de ta méthode.`

timeline = replaceRequired(timeline, oldFinal, newFinal, 'V2 final-output rule')

await writeFile(timelinePath, timeline)

let page = await readFile(pagePath, 'utf8')

const oldParser = `function splitTendency(value) {
  const text = String(value || '').trim()
  const photoMatch = text.match(/(?:^|\\n)(?:#+\\s*)?(?:\\*\\*)?1\\.\\s*La photographie de l'instant(?:\\*\\*)?/i)
  if (!photoMatch) return { direction: null, summary: null, reading: text }
  const photoIndex = photoMatch.index + (photoMatch[0].startsWith('\\n') ? 1 : 0)
  const head = text
    .slice(0, photoIndex)
    .replace(/^\\s*#+\\s*La tendance du tirage\\s*/i, '')
    .replace(/^\\s*---\\s*$/gm, '')
    .trim()
  const directionMatch = head.match(
    /\\*{0,2}(Tendance (?:favorable(?: mais en construction)?|mitigée|peu porteuse actuellement))\\.?\\*{0,2}/i,
  )
  if (!directionMatch) return { direction: null, summary: null, reading: text }
  const summary = head.replace(directionMatch[0], '').replace(/\\*\\*/g, '').trim()
  return {
    direction: directionMatch[1].replace(/\\.$/, ''),
    summary,
    reading: text.slice(photoIndex).trim(),
  }
}`

const newParser = `function splitTendency(value) {
  const text = String(value || '').trim()
  const photoMatch = text.match(/(?:^|\\n)(?:#+\\s*)?(?:\\*\\*)?1\\.\\s*La photographie de l'instant(?:\\*\\*)?/i)
  if (!photoMatch) return { direction: null, summary: null, reading: text }
  const photoIndex = photoMatch.index + (photoMatch[0].startsWith('\\n') ? 1 : 0)
  const head = text.slice(0, photoIndex).replace(/^\\s*---\\s*$/gm, '').trim()
  const directionMatch = head.match(
    /\\*{0,2}(Tendance (?:favorable(?: mais en construction)?|mitigée|peu porteuse actuellement))\\.?\\*{0,2}/i,
  )
  const summary = head
    .replace(/(?:^|\\n)\\s*(?:#+\\s*)?(?:\\*\\*)?(?:Résumé en 30 secondes|Votre tirage en 30 secondes)(?:\\*\\*)?\\s*/i, '\\n')
    .replace(/(?:^|\\n)\\s*(?:#+\\s*)?(?:\\*\\*)?La tendance du tirage(?:\\*\\*)?\\s*/i, '\\n')
    .replace(directionMatch?.[0] || '', '')
    .replace(/\\*\\*/g, '')
    .trim()
  return {
    direction: directionMatch ? directionMatch[1].replace(/\\.$/, '') : null,
    summary: summary || null,
    reading: text.slice(photoIndex).trim(),
  }
}

const READING_SECTION_TITLES = [
  "La photographie de l'instant",
  'La fréquence principale',
  'Les deux résonances',
  'Ce que racontent les trois fréquences ensemble',
  'Le ciel de naissance et le contexte astrologique',
  'La ligne de temps',
  'Les deux chemins possibles',
  'Vos leviers concrets',
  'La question que Chronosphère vous renvoie',
]

function matchReadingHeading(value) {
  const cleaned = String(value || '')
    .trim()
    .replace(/^#{1,4}\\s*/, '')
    .replace(/^\\*\\*(.*?)\\*\\*$/, '$1')
    .trim()
  const withoutNumber = cleaned.replace(/^\\d+[.)]\\s*/, '').trim()
  const index = READING_SECTION_TITLES.findIndex((title) => title.toLowerCase() === withoutNumber.toLowerCase())
  return index >= 0 ? { number: index + 1, title: READING_SECTION_TITLES[index] } : null
}

function splitReadingSections(value) {
  const lines = String(value || '').split('\\n')
  const sections = []
  let current = null

  for (const line of lines) {
    const heading = matchReadingHeading(line)
    if (heading) {
      if (current) {
        current.content = current.lines.join('\\n').trim()
        delete current.lines
        sections.push(current)
      }
      current = { ...heading, lines: [] }
      continue
    }
    if (current) current.lines.push(line)
  }

  if (current) {
    current.content = current.lines.join('\\n').trim()
    delete current.lines
    sections.push(current)
  }

  return sections.length >= 6 ? sections : []
}`

page = replaceRequired(page, oldParser, newParser, 'V2 summary and section parser')

const oldPartsLine = `  const parts = result ? splitTendency(result.interpretation) : null`
const newPartsLine = `  const parts = result ? splitTendency(result.interpretation) : null
  const readingSections = parts ? splitReadingSections(parts.reading) : []`
page = replaceRequired(page, oldPartsLine, newPartsLine, 'V2 parsed reading sections')

const oldSummaryCard = `              {parts.direction && (
                <div className="rounded-[22px] border-2 border-gold bg-gradient-to-br from-gold/[.14] to-white/90 p-6 shadow-md md:p-7">
                  <span className="font-georgia text-[11px] uppercase tracking-[0.18em] text-gold">
                    Tendance du tirage
                  </span>
                  <strong className="mt-2 block font-georgia text-2xl font-normal leading-snug md:text-[26px]">
                    {parts.direction}
                  </strong>
                  {parts.summary && (
                    <p className="mt-2.5 font-georgia text-base leading-relaxed text-deep/75">{parts.summary}</p>
                  )}
                </div>
              )}`

const newSummaryCard = `              {(parts.direction || parts.summary) && (
                <div className="rounded-[22px] border-2 border-gold bg-gradient-to-br from-gold/[.14] to-white/90 p-6 shadow-md md:p-7">
                  <span className="font-georgia text-[11px] uppercase tracking-[0.18em] text-gold">
                    Votre tirage en 30 secondes
                  </span>
                  {parts.direction && (
                    <strong className="mt-2 block font-georgia text-2xl font-normal leading-snug md:text-[26px]">
                      {parts.direction}
                    </strong>
                  )}
                  {parts.summary && (
                    <p className="mt-2.5 font-georgia text-base leading-relaxed text-deep/75">{parts.summary}</p>
                  )}
                </div>
              )}`

page = replaceRequired(page, oldSummaryCard, newSummaryCard, 'V2 30-second summary card')

const oldTimeline = `              {/* Timeline */}
              <TimelineFrise timing={result.sky?.timing} />

`
page = replaceRequired(page, oldTimeline, '', 'V2 move timeline into detailed reading')

const oldReading = `              {/* Reading */}
              <article className="rounded-3xl border-2 border-gold/25 bg-white p-7 md:p-9">
                <div className="whitespace-pre-line font-georgia text-[15px] leading-[1.85] text-deep/90 md:text-base">
                  {parts.reading}
                </div>
              </article>`

const newReading = `              {/* Reading */}
              {readingSections.length > 0 ? (
                <div className="space-y-5">
                  {readingSections.map((section) => (
                    <div key={section.number}>
                      <article
                        className={section.number === 4
                          ? "rounded-3xl border-2 border-gold bg-gold/[.08] p-6 shadow-sm md:p-8"
                          : "rounded-3xl border border-gold/25 bg-white/80 p-6 shadow-sm md:p-8"}
                      >
                        <div className="flex items-start gap-4">
                          <span className="mt-0.5 shrink-0 font-georgia text-[11px] font-semibold tracking-[0.14em] text-gold">
                            {String(section.number).padStart(2, '0')}
                          </span>
                          <div className="min-w-0 flex-1">
                            <h2 className="font-georgia text-2xl font-medium leading-tight text-deep md:text-3xl">
                              {section.title}
                            </h2>
                            <div className="mt-4 whitespace-pre-line font-georgia text-[15px] leading-[1.85] text-deep/80 md:text-base">
                              {section.content}
                            </div>
                          </div>
                        </div>
                      </article>
                      {section.number === 6 && (
                        <div className="mt-5">
                          <TimelineFrise timing={result.sky?.timing} />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <article className="rounded-3xl border-2 border-gold/25 bg-white p-7 md:p-9">
                  <div className="whitespace-pre-line font-georgia text-[15px] leading-[1.85] text-deep/90 md:text-base">
                    {parts.reading}
                  </div>
                </article>
              )}`

page = replaceRequired(page, oldReading, newReading, 'V2 premium reading cards')

await writeFile(pagePath, page)

console.log('MediumIA Chronosphère: V2 reading structure applied')