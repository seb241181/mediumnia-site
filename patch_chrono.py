#!/usr/bin/env python3
"""
Supprime le chronomètre de mediumnia-app.
Lance depuis la racine du dépôt mediumnia-app.
"""
import os, sys

# ── 1. ExerciseReader.jsx ──────────────────────────────────────────────────
EXERCISE_PATH = "src/pages/ExerciseReader.jsx"

NEW_EXERCISE = """\
import { useParams, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { EXERCISES } from '../data/exercises.js'
import { markExerciceDone } from '../utils/storage.js'

export default function ExerciseReader() {
  const { id } = useParams()
  const navigate = useNavigate()
  const ex = EXERCISES.find(e => e.id === parseInt(id))

  const [phase, setPhase] = useState('idle') // idle | running | done
  const [currentStep, setCurrentStep] = useState(0)

  if (!ex) return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="text-mist font-georgia">Exercice introuvable.</p>
    </div>
  )

  const handleStart = () => {
    setPhase('running')
    setCurrentStep(0)
  }

  const handleDone = () => {
    setPhase('done')
    markExerciceDone(parseInt(id))
  }

  const handleRestart = () => {
    setCurrentStep(0)
    setPhase('idle')
  }

  return (
    <div className="pb-24 min-h-screen">
      {/* Header */}
      <div className="sticky top-0 bg-cream/95 backdrop-blur-sm border-b border-gold/20 px-6 py-4 z-10">
        <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-mist font-georgia text-sm">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Retour
        </button>
      </div>

      <div className="px-6">

        {/* Titre */}
        <div className="py-8">
          <p className="text-xs uppercase tracking-widest text-gold/60 font-georgia mb-2">Exercice</p>
          <h1 className="text-2xl text-deep font-georgia font-medium leading-tight">{ex.titre}</h1>
          <p className="text-mist font-georgia text-sm mt-2 italic">{ex.description}</p>
        </div>

        {/* Phase DONE */}
        {phase === 'done' && (
          <div className="text-center mb-8 fade-in">
            <p className="grande-citation">Pratique terminée.</p>
            <p className="text-mist font-georgia text-sm italic">
              Notez vos ressentis dans votre carnet pendant que c'est frais.
            </p>
            <button
              onClick={() => navigate('/journal')}
              className="mt-4 btn-primary"
            >
              Ouvrir mon carnet
            </button>
          </div>
        )}

        {/* Étapes */}
        <div className="space-y-3 mb-8">
          <p className="section-title">Étapes</p>
          {ex.etapes.map((etape, i) => (
            <div
              key={i}
              onClick={() => phase === 'running' && setCurrentStep(i)}
              className={`card cursor-pointer transition-all ${
                phase === 'running' && currentStep === i
                  ? 'border-gold bg-gold/5'
                  : ''
              }`}
            >
              <div className="flex gap-4 items-start">
                <span className={`text-sm font-georgia font-medium flex-shrink-0 ${
                  phase === 'running' && currentStep === i ? 'text-gold' : 'text-mist/60'
                }`}>
                  {i + 1}.
                </span>
                <p className="text-deep font-georgia text-sm leading-relaxed">{etape}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Question carnet */}
        {ex.questionCarnet && (
          <div className="mb-8 py-4 px-4 border border-gold/30 rounded-lg bg-gold/5">
            <p className="text-xs uppercase tracking-widest text-gold/60 font-georgia mb-2">
              ✦ Question de carnet
            </p>
            <p className="text-deep font-georgia text-sm italic leading-relaxed">
              {ex.questionCarnet}
            </p>
          </div>
        )}

        {/* Boutons de contrôle */}
        <div className="space-y-3">
          {phase === 'idle' && (
            <button onClick={handleStart} className="w-full btn-primary">
              ▶ Démarrer l'exercice
            </button>
          )}
          {phase === 'running' && (
            <button onClick={handleDone} className="w-full btn-primary">
              ✦ Terminer l'exercice
            </button>
          )}
          {phase === 'done' && (
            <>
              <button onClick={handleRestart} className="w-full btn-primary">
                ↺ Recommencer
              </button>
              <button onClick={() => navigate('/exercices')} className="w-full btn-secondary">
                Retour aux exercices
              </button>
            </>
          )}
        </div>

      </div>
    </div>
  )
}
"""

# ── 2. Chat.jsx — correction du prompt système ─────────────────────────────
CHAT_PATH = "src/pages/Chat.jsx"
OLD_INCLUS = "CE QUI EST INCLUS : 25 modules imprimés envoyés chez vous, 32 exercices guidés avec chronomètre, carnet de pratique intégré dans l'application, Mediumia (moi-même !) comme coach IA personnel, 12 mois d'accès à l'application."
NEW_INCLUS = "CE QUI EST INCLUS : 25 modules PDF téléchargeables, 84 exercices guidés, carnet de pratique intégré dans l'application, Mediumia (moi-même !) comme coach IA personnel, 12 mois d'accès à l'application."

# ── Vérifications ──────────────────────────────────────────────────────────
for path in [EXERCISE_PATH, CHAT_PATH]:
    if not os.path.exists(path):
        print(f"ERREUR : fichier introuvable : {path}")
        print("Lance ce script depuis la racine du dépôt mediumnia-app.")
        sys.exit(1)

# ExerciseReader
with open(EXERCISE_PATH, "w", encoding="utf-8") as f:
    f.write(NEW_EXERCISE)
print(f"✓ {EXERCISE_PATH} — chronomètre supprimé")

# Chat.jsx
with open(CHAT_PATH, "r", encoding="utf-8") as f:
    chat_content = f.read()

if OLD_INCLUS in chat_content:
    chat_content = chat_content.replace(OLD_INCLUS, NEW_INCLUS)
    with open(CHAT_PATH, "w", encoding="utf-8") as f:
        f.write(chat_content)
    print(f"✓ {CHAT_PATH} — texte du prompt mis à jour")
elif NEW_INCLUS in chat_content:
    print(f"✓ {CHAT_PATH} — déjà à jour, rien à faire")
else:
    print(f"⚠ {CHAT_PATH} — texte non trouvé, vérification manuelle nécessaire")

print("\nTout est prêt. Lance maintenant :")
print("  git add src/pages/ExerciseReader.jsx src/pages/Chat.jsx")
print('  git commit -m "Supprimer le chronomètre des exercices"')
print("  git push")
