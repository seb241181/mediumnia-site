export default function FormationContents({ contents }) {
  return (
    <section className="formation-section formation-contents" aria-labelledby="formation-contents-title">
      <p className="formation-eyebrow">Une progression complète</p>
      <h2 id="formation-contents-title">Ce que contient le parcours</h2>
      <div className="formation-contents__grid">
        {contents.map((item) => (
          <article key={item.title}>
            <span className="formation-contents__icon" aria-hidden="true">{item.icon}</span>
            {item.provisional && <small>Modalité à confirmer</small>}
            <h3>{item.title}</h3><p>{item.description}</p>
          </article>
        ))}
      </div>
    </section>
  )
}
