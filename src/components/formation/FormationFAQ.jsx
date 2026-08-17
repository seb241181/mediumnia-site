import { useState } from 'react'

export default function FormationFAQ({ items }) {
  const [openItem, setOpenItem] = useState(null)

  return (
    <section className="formation-section formation-faq" aria-labelledby="formation-faq-title">
      <p className="formation-eyebrow">Pour aller plus loin</p>
      <h2 id="formation-faq-title">Questions fréquentes</h2>
      <div className="formation-faq__list">
        {items.map((item, index) => {
          const isOpen = openItem === index
          const panelId = `formation-faq-panel-${index}`
          return (
            <article key={item.question}>
              <h3>
                <button type="button" aria-expanded={isOpen} aria-controls={panelId} onClick={() => setOpenItem(isOpen ? null : index)}>
                  <span>{item.question}{item.provisional && <small>À revalider</small>}</span><i aria-hidden="true">{isOpen ? '−' : '+'}</i>
                </button>
              </h3>
              <div id={panelId} hidden={!isOpen}><p>{item.answer}</p></div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
