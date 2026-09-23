import { Component } from 'react'

function CrashNotice() {
  return (
    <div data-app-crash className="min-h-screen bg-cream px-6 py-24 text-center font-georgia text-deep">
      <p className="text-xs uppercase tracking-[0.2em] text-gold">MediumIA</p>
      <h1 className="mt-4 text-3xl font-medium">Cette page n’a pas pu s’afficher.</h1>
      <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-mist">
        Un incident technique empêche son chargement. Rechargez la page ; si le problème persiste, revenez à l’accueil.
      </p>
      <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <button type="button" onClick={() => window.location.reload()} className="rounded-lg bg-deep px-6 py-3 text-sm font-bold text-gold">
          Recharger la page
        </button>
        <a href="/" className="rounded-lg border border-gold/45 px-6 py-3 text-sm font-bold text-deep">
          Retour à l’accueil
        </a>
      </div>
    </div>
  )
}

// A render error in one page or widget must not blank the whole site.
export default class AppErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error) {
    console.error('[MediumIA] render error:', error)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return this.props.silent ? null : <CrashNotice />
  }
}
