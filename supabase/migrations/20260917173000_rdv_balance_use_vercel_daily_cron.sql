-- MediumIA RDV — le plan Vercel Hobby utilise un contrôle quotidien.
-- On désactive donc le job pg_cron horaire créé par la fondation afin d'éviter
-- deux ordonnanceurs concurrents. Les fonctions de paiement et d'annulation restent inchangées.

DO $$
DECLARE
  v_job_id BIGINT;
BEGIN
  SELECT jobid INTO v_job_id
  FROM cron.job
  WHERE jobname = 'mediumia-rdv-balance-hourly'
  LIMIT 1;

  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_job_id);
  END IF;
END;
$$;

UPDATE public.rdv_balance_runtime_settings
SET sweep_url = NULL,
    updated_at = now()
WHERE singleton = true;
