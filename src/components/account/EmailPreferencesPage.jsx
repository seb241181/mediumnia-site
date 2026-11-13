import { useEffect, useState } from 'react'
import { readEmailLinkFragment } from './emailLink.js'

// Page ouverte depuis un e-mail : confirmer son inscription aux actualités,
// ou se désinscrire. Rien ne se passe à l'ouverture : il faut cliquer sur le
// bouton (une messagerie qui « visite » le lien ne change donc rien).

const ACTIONS = {
  confirmer: {
    api: 'confirm',
    title: 'Confirmer mon inscription',
    intro: 'Vous avez demandé à recevoir par e-mail les actualités, conseils et offres de MediumIA.',
    button: 'Confirmer mon inscription',
    done: 'Votre inscription est confirmée. Merci, et à très bientôt.',
  },
  desinscription: {
    api: 'unsubscribe',
    title: 'Me désinscrire',
    intro: 'Vous ne recevrez plus les actualités de MediumIA. Les e-mails liés à vos rendez-vous continueront de vous parvenir.',
    button: 'Me désinscrire',
    done: 'C’est fait : vous êtes désinscrit(e) des actualités MediumIA.',
  },
}

const ERRORS = {
  token_expired: 'Ce lien a expiré. Vous pouvez refaire votre demande depuis votre espace MediumIA.',
  too_many_requests: 'Trop de tentatives. Patientez quelques minutes avant de réessayer.',
}

export default function EmailPreferencesPage() {
  const [link] = useState(() => readEmailLinkFragment(window.location.hash))
  const [state, setState] = useState('ready') // ready | busy | done | error
  const [error, setError] = useState('')

  useEffect(() => {
    document.title = 'Préférences e-mail — MediumIA'
  }, [])

  const action = link ? ACTIONS[link.kind] : null

  async function submit() {
    setState('busy')
    setError('')
    try {
      const response = await fetch(`/api/rdv-config?marketingAction=${action.api}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: link.token }),
      })
      if (response.ok) { setState('done'); return }
      const data = await response.json().catch(() => ({}))
      setError(ERRORS[data.error] || 'Ce lien n’est plus valable. Vous pouvez gérer vos préférences depuis votre espace MediumIA.')
    } catch {
      setError('La connexion a échoué. Réessayez dans un instant.')
    }
    setState('error')
  }

  return (
    <main className="min-h-screen bg-cream px-4 py-12 text-deep">
      <div className="mx-auto max-w-md rounded-2xl border border-gold/30 bg-white/70 p-6 text-center">
        <p className="font-georgia text-[11px] uppercase tracking-[0.2em] text-gold">MediumIA</p>
        {!action ? (
          <>
            <h1 className="mt-2 font-georgia text-2xl font-medium">Lien incomplet</h1>
            <p className="mt-3 font-georgia text-sm leading-relaxed text-mist">Ce lien n’est pas reconnu. Ouvrez-le directement depuis l’e-mail reçu, ou gérez vos préférences depuis votre espace.</p>
          </>
        ) : (
          <>
            <h1 className="mt-2 font-georgia text-2xl font-medium">{action.title}</h1>
            {state === 'done' ? (
              <p className="mt-3 font-georgia text-base leading-relaxed text-deep" role="status">{action.done}</p>
            ) : (
              <>
                <p className="mt-3 font-georgia text-sm leading-relaxed text-mist">{action.intro}</p>
                {error && <p role="alert" className="mt-3 font-georgia text-sm text-red-700">{error}</p>}
                <button type="button" disabled={state === 'busy'} onClick={submit}
                  className="mt-5 w-full rounded-xl bg-deep px-6 py-4 font-georgia text-base font-bold text-gold transition-colors hover:bg-deep/90 disabled:opacity-50">
                  {state === 'busy' ? 'Un instant…' : action.button}
                </button>
              </>
            )}
          </>
        )}
        <a href="/mon-espace" className="mt-6 inline-block font-georgia text-sm text-deep underline decoration-gold underline-offset-4">Ouvrir mon espace MediumIA</a>
      </div>
    </main>
  )
}
