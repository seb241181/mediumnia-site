import { useEffect } from 'react'
import BoutiqueProductArt from './BoutiqueProductArt'

const CloseIcon = () => <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12" /><path d="m18 6-12 12" /></svg>
const CheckIcon = () => <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>

export default function ProductDetail({ product, onClose, onPurchaseRequest }) {
  useEffect(() => {
    const onKeyDown = (event) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKeyDown)
    document.body.classList.add('boutique-modal-open')
    return () => { window.removeEventListener('keydown', onKeyDown); document.body.classList.remove('boutique-modal-open') }
  }, [onClose])

  const isComingSoon = product.availability === 'coming-soon'
  return (
    <div className="boutique-detail" role="dialog" aria-modal="true" aria-labelledby="boutique-product-title" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="boutique-detail__panel">
        <button type="button" className="boutique-detail__close" onClick={onClose} aria-label="Fermer la fiche produit"><CloseIcon /></button>
        <div className="boutique-detail__visual"><BoutiqueProductArt variant={product.artwork} large /></div>
        <div className="boutique-detail__content">
          <p className="boutique-eyebrow">{product.categoryLabel} · {product.eyebrow}</p>
          <h2 id="boutique-product-title">{product.name}</h2>
          <p className="boutique-detail__lead">{product.summary}</p><p className="boutique-detail__description">{product.description}</p>
          <ul>{product.highlights.map((highlight) => <li key={highlight}><CheckIcon />{highlight}</li>)}</ul>
          <div className="boutique-detail__action">
            <strong>{product.priceLabel}</strong>
            <button type="button" disabled={isComingSoon} onClick={() => onPurchaseRequest(product)}>{isComingSoon ? 'Prochainement' : 'Acheter — bientôt disponible'}</button>
          </div>
          <p className="boutique-detail__notice">Maquette uniquement · Paiement désactivé · Aucun débit possible</p>
        </div>
      </section>
    </div>
  )
}
