import { useState } from 'react'
import { boutiqueCategories, boutiqueProducts } from '../data/boutiqueProducts'
import ProductDetail from './ProductDetail'
import BoutiqueProductArt from './BoutiqueProductArt'
import '../styles/boutique.css'

function ProductCard({ product, onOpen, onOpenOracle, onOpenFormation }) {
  const isOracle = product.id === 'oracle-au-dela-ame'
  const isFormation = product.id === 'formation-mediumia'
  const isEcho = product.category === 'echo-des-fees'
  // Products sold elsewhere (CODEX on Amazon) open the seller directly with a
  // real link: phones never block it, unlike a scripted window.open.
  const external = product.externalPurchase && product.purchaseUrl
  const internalLink = !external && product.href

  const handleClick = () => {
    if (isOracle && onOpenOracle) {
      onOpenOracle()
    } else if (isFormation && onOpenFormation) {
      onOpenFormation()
    } else {
      onOpen(product)
    }
  }

  const Card = external || internalLink ? 'a' : 'article'
  const cardProps = external
    ? { href: product.purchaseUrl, target: '_blank', rel: 'noopener noreferrer', 'aria-label': `${product.name} — ${product.purchaseLabel || 'voir chez le vendeur'}` }
    : internalLink ? { href: product.href } : { onClick: handleClick }

  return (
    <Card
      {...cardProps}
      className="block bg-white border rounded-xl overflow-hidden cursor-pointer group transition-all hover:shadow-md hover:-translate-y-0.5"
      style={{ borderColor: isEcho ? 'rgba(201,168,76,.35)' : 'rgba(53,40,79,.12)' }}
    >
      {/* Image / artwork */}
      <div className="relative overflow-hidden bg-stone-100" style={{ height: 220 }}>
        {product.coverImage
          ? <img
              src={product.coverImage}
              alt={product.name}
              className={`w-full h-full ${product.imageFit === 'contain' ? 'object-contain p-3' : 'object-cover'}`}
              style={product.imageFit === 'contain' ? { background: '#0a0910' } : undefined}
            />
          : <BoutiqueProductArt type={product.artwork} />
        }
        {product.availability === 'coming-soon' && (
          <span className="absolute top-3 left-3 bg-white/90 text-xs font-georgia px-2 py-1 tracking-wide" style={{ color: '#4A3F6B', letterSpacing: '0.12em', fontSize: 9, textTransform: 'uppercase' }}>
            À venir
          </span>
        )}
        {product.featured && (
          <span className="absolute top-3 right-3 bg-white/90 text-xs font-georgia px-2 py-1 tracking-wide" style={{ color: '#C9A84C', letterSpacing: '0.12em', fontSize: 9, textTransform: 'uppercase' }}>
            ✦ Nouveauté
          </span>
        )}
      </div>

      {/* Info */}
      <div className="px-4 py-4">
        <p className="font-georgia text-[10px] tracking-[0.18em] uppercase mb-1.5" style={{ color: '#C9A84C' }}>
          {product.categoryLabel}
        </p>
        <h3 className="font-georgia text-sm font-medium text-deep leading-snug mb-3" style={{ minHeight: 38 }}>
          {product.name}
        </h3>
        <div className="flex items-center justify-between border-t pt-3" style={{ borderColor: 'rgba(201,168,76,.18)' }}>
          <span className="font-georgia text-sm font-semibold text-deep">{product.priceLabel}</span>
          <span className="font-georgia text-xs text-gold group-hover:translate-x-1 transition-transform inline-block">
            {external ? '→' : 'Voir →'}
          </span>
        </div>
      </div>
    </Card>
  )
}

// Offre phare (Formation MediumIA) : en grand, en tête de la boutique.
function SpotlightCard({ product, onOpenFormation }) {
  const open = (event) => {
    if (!onOpenFormation || event.metaKey || event.ctrlKey || event.shiftKey) return
    event.preventDefault()
    onOpenFormation()
  }
  return (
    <article className="mb-6 grid overflow-hidden rounded-2xl border border-gold/40 bg-white shadow-[0_14px_40px_rgba(26,21,53,.08)] md:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <a href={product.href} onClick={open} className="block bg-deep" aria-label={`${product.name} — découvrir la formation`}>
        <img src={product.coverImage} alt="Couverture de la Formation MediumIA : 25 modules, 4 niveaux, Sébastien Seguin" loading="lazy" decoding="async" className="h-full max-h-[340px] w-full object-cover md:max-h-none" />
      </a>
      <div className="flex flex-col p-7 md:p-9">
        <p className="font-georgia text-[10px] uppercase tracking-[0.2em]" style={{ color: '#C9A84C' }}>{product.eyebrow}</p>
        <h3 className="mt-2 font-georgia text-2xl font-medium leading-tight text-deep md:text-3xl">{product.name}</h3>
        <p className="mt-3 font-georgia leading-relaxed text-mist">{product.summary}</p>
        <ul className="mt-4 grid grid-cols-1 gap-1.5 font-georgia text-sm text-deep sm:grid-cols-2">
          {product.highlights.map((item) => (
            <li key={item} className="flex gap-2"><span className="text-gold" aria-hidden="true">✓</span>{item}</li>
          ))}
        </ul>
        <p className="mt-6 font-georgia text-3xl font-medium text-deep">{product.priceLabel}</p>
        {product.paymentNote && <p className="mt-1 font-georgia text-xs text-mist">{product.paymentNote}</p>}
        <div className="mt-6">
          <a href={product.href} onClick={open} className="inline-block rounded-lg bg-deep px-6 py-3 font-georgia text-sm font-bold text-gold transition-colors hover:bg-deep/90">
            Découvrir la formation →
          </a>
        </div>
      </div>
    </article>
  )
}

function EchoFeesBanner() {
  return (
    <div className="relative overflow-hidden rounded-2xl mb-4 border-2" style={{ borderColor: 'rgba(201,168,76,.4)', background: 'linear-gradient(140deg,#f9f4ea,#ede6d6 50%,#f9f4ea)' }}>
      <div className="px-8 md:px-12 py-6 md:py-8 flex flex-col items-center text-center">
        <img
          src="/images/brand/LEcho_des_Fees_logo.png"
          alt="L'Écho des Fées"
          className="h-40 md:h-56 w-auto object-contain mb-3"
        />
        <p className="font-georgia text-xs tracking-[0.28em] uppercase mb-2" style={{ color: '#C9A84C' }}>L'univers boutique d'Aurélie Seguin</p>
        <h3 className="font-georgia font-medium text-3xl md:text-5xl text-deep leading-tight mb-3">
          L'Écho des Fées
        </h3>
        <p className="font-georgia text-base md:text-lg italic leading-relaxed max-w-xl" style={{ color: '#4A3F6B' }}>
          Des objets choisis avec soin pour accompagner les espaces et les pratiques — retenus pour leur qualité, leur histoire et leur provenance.
        </p>
      </div>
    </div>
  )
}

export default function BoutiqueEcommerce({ id = 'boutique', onOpenOracle, onOpenFormation }) {
  const [activeCategory, setActiveCategory] = useState('all')
  const [selectedProduct, setSelectedProduct] = useState(null)
  const [notice, setNotice] = useState('')

  const publicProducts = boutiqueProducts.filter(p => p.publicVisible !== false)
  const activeCategoryIds = new Set(publicProducts.map(p => p.category))
  const publicCategories = boutiqueCategories.filter(c => c.id === 'all' || activeCategoryIds.has(c.id))

  const inCategory = activeCategory === 'all'
    ? publicProducts
    : publicProducts.filter(p => p.category === activeCategory)
  const spotlight = inCategory.find(p => p.spotlight)
  const visibleProducts = inCategory.filter(p => !p.spotlight)

  const showEchoBanner = activeCategoryIds.has('echo-des-fees') && (
    activeCategory === 'echo-des-fees' ||
    activeCategory === 'all'
  )

  const handlePurchaseRequest = (product) => {
    if (product.purchaseUrl) {
      window.open(product.purchaseUrl, '_blank', 'noopener,noreferrer')
      return
    }
    setSelectedProduct(null)
    setNotice(`« ${product.name} » — paiement bientôt disponible.`)
    window.setTimeout(() => setNotice(''), 4000)
  }

  return (
    <section id={id} className="px-6 py-14 max-w-6xl mx-auto">

      {/* Filtres */}
      <div className="flex gap-2 flex-wrap mb-8">
        {publicCategories.map(cat => (
          <button
            key={cat.id}
            onClick={() => setActiveCategory(cat.id)}
            className="font-georgia text-xs px-4 py-2 rounded-full border transition-all"
            style={activeCategory === cat.id
              ? { background: '#1A1535', color: '#fff', borderColor: '#1A1535' }
              : { background: 'transparent', color: '#4A3F6B', borderColor: 'rgba(74,63,107,.3)' }
            }
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Bannière L'Écho des Fées */}
      {showEchoBanner && <EchoFeesBanner />}

      {/* Offre phare */}
      {spotlight && <SpotlightCard product={spotlight} onOpenFormation={onOpenFormation} />}

      {/* Grille produits */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {visibleProducts.map(product => (
          <ProductCard
            key={product.id}
            product={product}
            onOpen={setSelectedProduct}
            onOpenOracle={onOpenOracle}
            onOpenFormation={onOpenFormation}
          />
        ))}
      </div>

      {/* Modal détail produit */}
      {selectedProduct && (
        <ProductDetail
          product={selectedProduct}
          onClose={() => setSelectedProduct(null)}
          onPurchaseRequest={handlePurchaseRequest}
        />
      )}

      {notice && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-deep text-cream font-georgia text-xs px-5 py-3 shadow-lg">
          ✦ {notice}
        </div>
      )}
    </section>
  )
}
