import { useEffect, useState } from 'react'
import './index.css'

const categories = ['Tout', 'Oracles', 'Livres', 'Produits ésotériques', 'Formations']
const products = [
  { id:'oracle', name:'Oracle des Lignes de Temps', category:'Oracles', price:'44 €', badge:'Création MediumIA', description:'Un oracle pour éclairer les possibles, retrouver votre axe et dialoguer avec votre intuition.', details:'Un jeu sensible et profond pensé comme un espace de reconnexion. Chaque carte ouvre une piste de lecture pour observer les lignes qui se dessinent, accueillir ce qui est présent et choisir avec davantage de conscience.', includes:['Un jeu complet de cartes','Un livret d’accompagnement','Des pistes de tirages intuitifs'], art:'oracle', featured:true },
  { id:'codex', name:'Le Codex', category:'Livres', price:'29 €', badge:'Livre', description:'Un livre-passerelle pour approfondir la médiumnité consciente et poser des repères solides.', details:'Le Codex rassemble des enseignements, des clés de compréhension et des pratiques accessibles. Il accompagne les personnes qui souhaitent avancer avec discernement, simplicité et autonomie sur leur chemin intuitif.', includes:['Édition reliée','Exercices d’intégration','Ressources complémentaires'], art:'codex' },
  { id:'formation', name:'Formation MediumIA', category:'Formations', price:'À partir de 97 €', badge:'Parcours en ligne', description:'Un parcours progressif pour explorer vos perceptions et développer une pratique consciente.', details:'Une expérience pédagogique structurée qui réunit transmission, expérimentation et intégration. Vous avancez à votre rythme grâce à des contenus guidés et des pratiques conçues pour le quotidien.', includes:['Parcours vidéo progressif','Pratiques guidées','Accès à l’espace de formation'], art:'formation' },
  { id:'rituel', name:'Objet rituel à venir', category:'Produits ésotériques', price:'Bientôt disponible', badge:'Sélection d’Aurélie', description:'Une sélection choisie avec soin pour accompagner vos espaces et vos pratiques.', details:'Cet emplacement accueillera prochainement l’une des pièces sélectionnées par Aurélie pour sa qualité, sa symbolique et la justesse de sa provenance.', includes:['Sélection responsable','Histoire de l’objet','Conseils d’utilisation'], art:'ritual', comingSoon:true },
  { id:'aurelie', name:'Collection d’Aurélie', category:'Produits ésotériques', price:'Bientôt disponible', badge:'Future collection', description:'Des objets singuliers, retenus pour leur beauté et leur présence.', details:'Une collection éditorialisée, loin de l’accumulation, où chaque objet aura sa place et son histoire. La sélection est actuellement en préparation.', includes:['Pièces choisies','Quantités raisonnées','Présentation détaillée'], art:'aurelie', comingSoon:true },
]

function Icon({ name, size=20 }) {
  const paths={bag:<><path d="M6 8h12l1 13H5L6 8Z"/><path d="M9 10V6a3 3 0 0 1 6 0v4"/></>,arrow:<><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></>,close:<><path d="m6 6 12 12"/><path d="m18 6-12 12"/></>,check:<path d="m5 12 4 4L19 6"/>,menu:<path d="M4 7h16M4 12h16M4 17h16"/>}
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

function ProductArt({ type, large=false }) {
  return <div className={`product-art art-${type} ${large?'art-large':''}`} aria-hidden="true">
    <span className="art-orbit"/><span className="art-star">✦</span>
    {type==='oracle'&&<div className="oracle-deck"><span>ORACLE</span><small>DES LIGNES<br/>DE TEMPS</small><i>✧</i></div>}
    {type==='codex'&&<div className="book"><small>MEDIUMIA</small><strong>LE<br/>CODEX</strong><i>✦</i></div>}
    {type==='formation'&&<div className="portal"><span/><i>MEDIUMIA</i><small>PARCOURS INTUITIF</small></div>}
    {type==='ritual'&&<div className="ritual-object"><span>✦</span></div>}
    {type==='aurelie'&&<div className="crystal"><span/><span/><span/></div>}
  </div>
}

function Header(){
  const [open,setOpen]=useState(false)
  return <header className="site-header">
    <a className="brand" href="#top" aria-label="MediumIA, accueil"><span>✦</span> MEDIUMIA</a>
    <button className="menu-button" onClick={()=>setOpen(!open)} aria-expanded={open} aria-label="Ouvrir le menu"><Icon name={open?'close':'menu'}/></button>
    <nav className={open?'open':''} onClick={()=>setOpen(false)} aria-label="Navigation principale">
      <a href="#decouvrir">Découvrir</a><a href="#formations">Se former</a><a href="#consulter">Consulter</a><a href="#boutique" className="active">Boutique</a><a href="#praticiens">Trouver un praticien</a>
    </nav>
    <a className="pro-link" href="#espace-pro">Espace Pro <Icon name="arrow" size={15}/></a>
  </header>
}

function ProductCard({product,onOpen}){
  return <article className={`product-card ${product.featured?'featured':''}`}>
    <button className="art-button" onClick={()=>onOpen(product)} aria-label={`Voir ${product.name}`}><ProductArt type={product.art}/>{product.featured&&<span className="favorite-badge">Notre sélection</span>}</button>
    <div className="product-content"><p className="product-category">{product.badge}</p><h3>{product.name}</h3><p className="product-description">{product.description}</p>
      <div className="product-footer"><strong className={product.comingSoon?'soon':''}>{product.price}</strong><button onClick={()=>onOpen(product)} aria-label={`Découvrir ${product.name}`}><Icon name="arrow"/></button></div>
    </div>
  </article>
}

function ProductDetail({product,onClose,onBuy}){
  useEffect(()=>{const close=e=>e.key==='Escape'&&onClose();window.addEventListener('keydown',close);document.body.classList.add('modal-open');return()=>{window.removeEventListener('keydown',close);document.body.classList.remove('modal-open')}},[onClose])
  return <div className="detail-overlay" role="dialog" aria-modal="true" aria-labelledby="product-title" onMouseDown={e=>e.target===e.currentTarget&&onClose()}>
    <section className="detail-panel"><button className="detail-close" onClick={onClose} aria-label="Fermer"><Icon name="close"/></button>
      <div className="detail-visual"><ProductArt type={product.art} large/></div>
      <div className="detail-copy"><p className="eyebrow">{product.category} · {product.badge}</p><h2 id="product-title">{product.name}</h2><p className="detail-lead">{product.description}</p><p className="detail-text">{product.details}</p>
        <ul>{product.includes.map(item=><li key={item}><Icon name="check" size={17}/>{item}</li>)}</ul>
        <div className="buy-row"><strong>{product.price}</strong><button className="buy-button" disabled={product.comingSoon} onClick={()=>onBuy(product)}>{product.comingSoon?'Me tenir informé':<><Icon name="bag"/> Acheter</>}</button></div>
        <p className="payment-note">Paiement sécurisé bientôt disponible · Aucun débit sur cette maquette</p>
      </div>
    </section>
  </div>
}

export default function App(){
  const [activeCategory,setActiveCategory]=useState('Tout')
  const [selectedProduct,setSelectedProduct]=useState(null)
  const [notice,setNotice]=useState('')
  const visible=activeCategory==='Tout'?products:products.filter(p=>p.category===activeCategory)
  // Point d’extension V1 : remplacé plus tard par l’adaptateur du prestataire de paiement.
  const startCheckout=product=>{setSelectedProduct(null);setNotice(`Le paiement pour « ${product.name} » sera bientôt disponible.`);window.setTimeout(()=>setNotice(''),4500)}
  return <div id="top"><Header/><main>
    <section className="shop-hero" id="boutique"><div className="hero-symbol">✦</div><p className="eyebrow">La boutique MediumIA</p><h1>Des objets pour<br/><em>cheminer autrement.</em></h1><p className="hero-intro">Des créations, des transmissions et des objets choisis avec conscience pour nourrir votre intuition et accompagner votre pratique.</p><a href="#catalogue" className="discover-link">Découvrir la sélection <Icon name="arrow"/></a></section>
    <section className="catalogue" id="catalogue"><div className="section-heading"><div><p className="eyebrow">La sélection</p><h2>Explorer la boutique</h2></div><p>Chaque création est pensée ou choisie pour sa justesse, sa qualité et le sens qu’elle peut apporter à votre cheminement.</p></div>
      <div className="category-tabs" role="group" aria-label="Filtrer les produits">{categories.map(c=><button key={c} className={activeCategory===c?'active':''} onClick={()=>setActiveCategory(c)}>{c}</button>)}</div>
      <div className="product-grid">{visible.map(p=><ProductCard key={p.id} product={p} onOpen={setSelectedProduct}/>)}</div>
    </section>
    <section className="manifesto"><span>✦</span><p className="eyebrow">Notre intention</p><blockquote>« Moins d’objets. Plus de sens.<br/>Des choix qui résonnent vraiment. »</blockquote><p>La boutique MediumIA grandira doucement, au rythme des rencontres et des évidences.</p></section>
  </main>
  <footer><div className="footer-brand"><a className="brand" href="#top"><span>✦</span> MEDIUMIA</a><p>Un écosystème pour explorer le monde spirituel avec conscience.</p></div><div><p className="footer-title">Explorer</p><a href="#boutique">La boutique</a><a href="#formations">Les formations</a><a href="#praticiens">Les praticiens</a></div><div><p className="footer-title">Informations</p><a href="#livraison">Livraison</a><a href="#retours">Retours</a><a href="#contact">Nous contacter</a></div><p className="copyright">© 2026 MediumIA</p></footer>
  {selectedProduct&&<ProductDetail product={selectedProduct} onClose={()=>setSelectedProduct(null)} onBuy={startCheckout}/>}
  {notice&&<div className="toast" role="status">✦ {notice}</div>}
  </div>
}
