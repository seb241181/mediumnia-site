-- Signalements de paiement : base locale jetable (après la migration 20261108140000).
\set ON_ERROR_STOP on
set client_min_messages = notice;
create or replace function pg_temp.check(cond boolean, label text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'ÉCHEC : %', label; end if; raise notice 'ok : %', label; end $$;
create or replace function pg_temp.sub(p_email text, p_attempt text, p_ip text, p_comment text default null, p_reason text default 'payment_failed', p_now timestamptz default now()) returns jsonb language sql as $$
  select public.submit_payment_issue_report(p_email, p_reason, p_comment, 'chronosphere_max', 'confirmation_failed', p_attempt, now(), '/chronosphere-max', 'mobile', p_ip, p_now)
$$;

do $$
declare r jsonb; r2 jsonb; ip text := repeat('a', 64);
begin
  r := pg_temp.sub('Cliente@Example.org', '5O190127TN364715T', ip, 'Débitée');
  perform pg_temp.check(r->>'ok' = 'true' and r->>'duplicate' = 'false' and r->>'reference' ~ '^PB-[0-9A-F]{8}$' and r->>'ack_allowed' = 'true', 'S1 signalement enregistré avec une référence publique');
  perform pg_temp.check((select contact_email from public.payment_issue_reports where reference = r->>'reference') = 'cliente@example.org', 'S1 adresse normalisée');
  r2 := pg_temp.sub('cliente@example.org', '5O190127TN364715T', ip);
  perform pg_temp.check(r2->>'duplicate' = 'true' and r2->>'reference' = r->>'reference', 'S2 même tentative, même motif : doublon, même référence');
  perform pg_temp.check((select count(*) from public.payment_issue_reports) = 1, 'S2 aucune seconde ligne');
  r2 := pg_temp.sub('cliente@example.org', '5O190127TN364715T', ip, null, 'payment_failed', now() + interval '25 hours');
  perform pg_temp.check(r2->>'duplicate' = 'false', 'S3 après 24 h, un nouveau signalement est possible');
end $$;

do $$
declare r jsonb; ip text := repeat('b', 64);
begin
  perform pg_temp.sub('a@example.org', 'ORDERA0000000001', ip);
  perform pg_temp.sub('b@example.org', 'ORDERA0000000002', ip);
  perform pg_temp.sub('c@example.org', 'ORDERA0000000003', ip);
  perform pg_temp.sub('d@example.org', 'ORDERA0000000004', ip);
  perform pg_temp.sub('e@example.org', 'ORDERA0000000005', ip);
  r := pg_temp.sub('f@example.org', 'ORDERA0000000006', ip);
  perform pg_temp.check(r->>'error' = 'rate_limited', 'S4 6e signalement de la même adresse IP en une heure refusé');
  perform pg_temp.sub('g@example.org', 'ORDERB0000000001', repeat('c', 64));
  perform pg_temp.sub('g@example.org', 'ORDERB0000000002', repeat('d', 64));
  perform pg_temp.sub('g@example.org', 'ORDERB0000000003', repeat('e', 64));
  r := pg_temp.sub('g@example.org', 'ORDERB0000000004', repeat('f', 64));
  perform pg_temp.check(r->>'error' = 'rate_limited', 'S5 4e signalement du même e-mail en une heure refusé');
  r := pg_temp.sub('pas-un-email', 'ORDERC0000000001', repeat('9', 64));
  perform pg_temp.check(r->>'error' = 'invalid_email', 'S6 e-mail invalide refusé par la base');
end $$;

do $$
begin
  begin
    perform pg_temp.sub('h@example.org', 'ORDERD0000000001', repeat('1', 64), 'ma carte 4970 1012 3456 7890');
    raise exception 'ÉCHEC : S7 numéro de carte accepté';
  exception when check_violation then raise notice 'ok : S7 un numéro de carte est refusé par la base, même si le serveur ne l’a pas masqué';
  end;
  begin
    insert into public.payment_issue_reports (reference, contact_email, reason, journey, page_path, dedupe_key)
    values ('PB-AAAAAAAA', 'h@example.org', 'other', 'other', '/rdv/solde?token=x', md5('x'));
    raise exception 'ÉCHEC : S8 paramètre d’URL accepté';
  exception when check_violation then raise notice 'ok : S8 aucune adresse de page avec paramètres (jetons) stockée';
  end;
end $$;

do $$
declare r jsonb; v_id uuid; actor uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
begin
  r := pg_temp.sub('k@example.org', 'ORDERE0000000001', repeat('2', 64));
  v_id := (r->>'id')::uuid;
  perform public.mark_payment_issue_notified(v_id, 'ack');
  r := pg_temp.sub('k@example.org', 'ORDERE0000000002', repeat('3', 64));
  perform pg_temp.check(r->>'ack_allowed' = 'false', 'S9 un seul accusé de réception par jour et par adresse');
  r := public.update_payment_issue_report(actor, v_id, 'in_progress', 'Vérification PayPal');
  perform pg_temp.check(r->>'status' = 'in_progress', 'S10 prise en charge');
  r := public.update_payment_issue_report(actor, v_id, 'resolved', null);
  perform pg_temp.check(r->>'status' = 'resolved' and r->>'handled_at' is not null and r->>'owner_note' = 'Vérification PayPal', 'S10 résolu, note conservée');
  r := public.update_payment_issue_report(actor, v_id, 'deleted', null);
  perform pg_temp.check(r->>'error' = 'invalid_status', 'S10 état inconnu refusé');
  perform pg_temp.check((select string_agg(event, ',' order by id) from public.payment_issue_events where report_id = v_id) = 'submitted,ack_sent,status_changed,note_updated,status_changed', 'S11 historique complet');
end $$;

do $$
begin
  perform pg_temp.check(not has_function_privilege('anon', 'public.submit_payment_issue_report(text,text,text,text,text,text,timestamptz,text,text,text,timestamptz)', 'execute'), 'S12 visiteur : aucun accès direct au dépôt');
  perform pg_temp.check(not has_function_privilege('authenticated', 'public.update_payment_issue_report(uuid,uuid,text,text)', 'execute'), 'S12 compte connecté : aucun accès direct au traitement');
  perform pg_temp.check(not has_table_privilege('anon', 'public.payment_issue_reports', 'select') and not has_table_privilege('authenticated', 'public.payment_issue_reports', 'select'), 'S12 signalements illisibles hors serveur');
  perform pg_temp.check(not has_table_privilege('service_role', 'public.payment_issue_events', 'update'), 'S12 historique non modifiable');
end $$;
select 'ok' as resultat;
