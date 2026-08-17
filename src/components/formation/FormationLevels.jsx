import { useState } from 'react'

export default function FormationLevels({ levels }) {
  const [openLevel, setOpenLevel] = useState(null)

  return (
    <section className="formation-levels" aria-labelledby="formation-levels-title">
      <div className="formation-section">
        <p className="formation-eyebrow">La progression</p>
        <h2 id="formation-levels-title">Le parcours en 4 niveaux</h2>
        <div className="formation-levels__list">
          {levels.map((level, index) => {
            const isOpen = openLevel === index
            const panelId = `formation-level-panel-${index}`
            return (
              <article key={level.number}>
                <button type="button" aria-expanded={isOpen} aria-controls={panelId} onClick={() => setOpenLevel(isOpen ? null : index)}>
                  <span>{level.number}</span><span><strong>{level.title}</strong><small>{level.modules}</small></span><i aria-hidden="true">{isOpen ? '−' : '+'}</i>
                </button>
                <div id={panelId} hidden={!isOpen}><p>{level.description}</p></div>
              </article>
            )
          })}
        </div>
      </div>
    </section>
  )
}
