export default function FormationJourney({ difference, journey, approach }) {
  return (
    <>
      <section className="formation-section formation-difference" aria-labelledby="formation-difference-title">
        <p className="formation-eyebrow">Une autre approche</p>
        <h2 id="formation-difference-title">{difference.title}</h2>
        <div>{difference.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div>
        <p className="formation-difference__emphasis">{difference.emphasis}</p>
      </section>

      <section className="formation-journey" id="formation-parcours" aria-labelledby="formation-journey-title">
        <div className="formation-section">
          <p className="formation-eyebrow">Le parcours</p>
          <h2 id="formation-journey-title">{journey.title}</h2>
          <div>{journey.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div>
          <blockquote>« {journey.quote} »</blockquote>
        </div>
      </section>

      <section className="formation-section formation-approach" aria-labelledby="formation-approach-title">
        <p className="formation-eyebrow">Les principes</p>
        <h2 id="formation-approach-title">Ce qui rend MediumIA différente</h2>
        <div className="formation-approach__grid">
          {approach.map((point) => (
            <article key={point.title}><span aria-hidden="true">✦</span><h3>{point.title}</h3><p>{point.description}</p></article>
          ))}
        </div>
      </section>
    </>
  )
}
