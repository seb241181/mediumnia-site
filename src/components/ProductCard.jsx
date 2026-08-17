import BoutiqueProductArt from './BoutiqueProductArt'

function ArrowIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></svg>
}

export default function ProductCard({ product, onOpen }) {
  return (
    <article className="boutique-product-card">
      <button type="button" className="boutique-product-card__visual" onClick={() => onOpen(product)} aria-label={`Voir la fiche de ${product.name}`}>
        <BoutiqueProductArt variant={product.artwork} />
        {product.featured && <span className="boutique-product-card__badge">Notre sélection</span>}
      </button>
      <div className="boutique-product-card__body">
        <p className="boutique-eyebrow">{product.eyebrow}</p><h3>{product.name}</h3>
        <p className="boutique-product-card__summary">{product.summary}</p>
        <div className="boutique-product-card__footer">
          <strong>{product.priceLabel}</strong>
          <button type="button" onClick={() => onOpen(product)} aria-label={`Découvrir ${product.name}`}><ArrowIcon /></button>
        </div>
      </div>
    </article>
  )
}
