import { useState } from 'react'
import ProductCard from './ProductCard'
import ProductDetail from './ProductDetail'
import { boutiqueCategories, boutiqueProducts } from '../data/boutiqueProducts'
import '../styles/boutique.css'

/**
 * Module Boutique autonome. Les données et le callback peuvent être injectés.
 * Le callback d'achat reste sans paiement jusqu'à validation explicite.
 */
export default function BoutiqueSection({
  products = boutiqueProducts,
  categories = boutiqueCategories,
  onPurchaseRequest,
  id = 'boutique',
}) {
  const [activeCategory, setActiveCategory] = useState('all')
  const [selectedProduct, setSelectedProduct] = useState(null)
  const [notice, setNotice] = useState('')

  const visibleProducts = activeCategory === 'all'
    ? products
    : products.filter((product) => product.category === activeCategory)

  const handlePurchaseRequest = (product) => {
    onPurchaseRequest?.(product)
    setSelectedProduct(null)
    setNotice(`« ${product.name} » : paiement bientôt disponible.`)
    window.setTimeout(() => setNotice(''), 4000)
  }

  return (
    <section className="boutique-module" id={id}>
      <header className="boutique-module__hero">
        <span className="boutique-module__symbol" aria-hidden="true">✦</span>
        <p className="boutique-eyebrow">La boutique MediumIA</p>
        <h2>Des objets pour<br /><em>cheminer autrement.</em></h2>
        <p>Des créations, des transmissions et des objets choisis avec conscience pour nourrir l’intuition et accompagner la pratique.</p>
        <a href={`#${id}-catalogue`}>Découvrir la sélection <span aria-hidden="true">→</span></a>
      </header>

      <div className="boutique-module__catalogue" id={`${id}-catalogue`}>
        <div className="boutique-module__heading">
          <div><p className="boutique-eyebrow">La sélection</p><h2>Explorer la boutique</h2></div>
          <p>Chaque création est pensée ou choisie pour sa justesse, sa qualité et le sens qu’elle peut apporter au cheminement.</p>
        </div>
        <div className="boutique-filters" role="group" aria-label="Filtrer les produits">
          {categories.map((category) => (
            <button type="button" key={category.id} className={activeCategory === category.id ? 'is-active' : ''} aria-pressed={activeCategory === category.id} onClick={() => setActiveCategory(category.id)}>
              {category.label}
            </button>
          ))}
        </div>
        <div className="boutique-products">
          {visibleProducts.map((product) => <ProductCard key={product.id} product={product} onOpen={setSelectedProduct} />)}
        </div>
      </div>

      <aside className="boutique-manifesto">
        <span aria-hidden="true">✦</span><p className="boutique-eyebrow">Notre intention</p>
        <blockquote>« Moins d’objets. Plus de sens.<br />Des choix qui résonnent vraiment. »</blockquote>
        <p>La boutique MediumIA grandira doucement, au rythme des rencontres et des évidences.</p>
      </aside>

      {selectedProduct && <ProductDetail product={selectedProduct} onClose={() => setSelectedProduct(null)} onPurchaseRequest={handlePurchaseRequest} />}
      {notice && <div className="boutique-toast" role="status">✦ {notice}</div>}
    </section>
  )
}
