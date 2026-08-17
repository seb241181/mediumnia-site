export default function FormationTestimonials({ testimonials }) {
  if (!testimonials.length) return null

  return (
    <section className="formation-testimonials" aria-labelledby="formation-testimonials-title">
      <div className="formation-section">
        <p className="formation-eyebrow">Expériences</p>
        <h2 id="formation-testimonials-title">Témoignages</h2>
        <div className="formation-testimonials__grid">
          {testimonials.map((testimonial) => <blockquote key={testimonial.id}><p>« {testimonial.quote} »</p><cite>{testimonial.author}</cite></blockquote>)}
        </div>
      </div>
    </section>
  )
}
