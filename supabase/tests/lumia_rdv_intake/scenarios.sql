\set ON_ERROR_STOP on
set role service_role;
\set P '''aaaaaaaa-0000-0000-0000-000000000001'''
create or replace function pg_temp.ok(label text, cond boolean) returns void language plpgsql as $$
begin if cond is distinct from true then raise exception 'ÉCHEC : %', label; end if; raise notice 'OK  %', label; end $$;
create or replace function pg_temp.intake(p jsonb) returns jsonb language sql as $$
  select public.lumia_upsert_booking_request('aaaaaaaa-0000-0000-0000-000000000001', jsonb_build_object('agent','lumia','channel','sms','detected_at', now()) || p) $$;
create or replace function pg_temp.req(id text) returns public.booking_requests language sql as $$ select * from public.booking_requests where id = id::uuid $$;

\echo '== 1. Demande vague (cas A) =='
select pg_temp.intake('{"message_id":"SMS-1","phone":"06 00 00 00 01","first_name":"Inconnue","message_text":"Bonjour, je voudrais reprendre un rendez-vous avec Sébastien."}') as r1 \gset
select pg_temp.ok('créée', (:'r1'::jsonb->>'outcome') = 'created');
select pg_temp.ok('statut pending, à vérifier, client inconnu', (select status = 'pending' and needs_review and customer_match = 'none' and service_id is null from public.booking_requests where id = (:'r1'::jsonb->>'request_id')::uuid));
select pg_temp.ok('téléphone normalisé, texte conservé', (select customer_phone = '+33600000001' and customer_message like 'Bonjour%' from public.booking_requests where id = (:'r1'::jsonb->>'request_id')::uuid));
select pg_temp.ok('aucun booking créé', (select count(*) from public.bookings) = 4);

\echo '== 2. Même message relu =='
select pg_temp.intake('{"message_id":"SMS-1","phone":"06 00 00 00 01","first_name":"Autre","message_text":"texte différent"}') as r2 \gset
select pg_temp.ok('même demande renvoyée (duplicate)', (:'r2'::jsonb->>'outcome') = 'duplicate' and (:'r2'::jsonb->>'request_id') = (:'r1'::jsonb->>'request_id'));
select pg_temp.ok('rien n''a changé', (select customer_first_name = 'Inconnue' and customer_message like 'Bonjour%' from public.booking_requests where id = (:'r1'::jsonb->>'request_id')::uuid));
select pg_temp.ok('une seule demande, un seul événement', (select count(*) from public.booking_requests) = 1 and (select count(*) from public.booking_request_intake_events) = 1);
select pg_temp.ok('même identifiant sur un autre canal = autre message', (pg_temp.intake('{"message_id":"SMS-1","channel":"imessage","first_name":"X","phone":"0600000009"}')->>'outcome') = 'created');

\echo '== 3. Rapprochement client =='
select pg_temp.intake('{"message_id":"SMS-3","phone":"+33 6 11 22 33 44","first_name":"Claire"}') as r3 \gset
select pg_temp.ok('client connu par téléphone : e-mail et nom complétés', (select customer_match = 'phone' and customer_email = 'claire@example.test' and customer_last_name = 'Exemple' from public.booking_requests where id = (:'r3'::jsonb->>'request_id')::uuid));
select pg_temp.intake('{"message_id":"SMS-4","email":"CLAIRE@example.test","first_name":"Claire"}') as r4 \gset
select pg_temp.ok('client connu par e-mail : téléphone et nom complétés', (select customer_match = 'email' and customer_phone = '06 11 22 33 44' and customer_last_name = 'Exemple' from public.booking_requests where id = (:'r4'::jsonb->>'request_id')::uuid));
select pg_temp.intake('{"message_id":"SMS-5","phone":"0799887766"}') as r5 \gset
select pg_temp.ok('numéro partagé par deux clients : ambigu, rien de complété', (select customer_match = 'ambiguous' and customer_email is null and needs_review from public.booking_requests where id = (:'r5'::jsonb->>'request_id')::uuid));
select pg_temp.intake('{"message_id":"SMS-6","phone":"0611223344","first_name":"Martine"}') as r6 \gset
select pg_temp.ok('même numéro, autre prénom : ambigu, pas de fusion', (select customer_match = 'ambiguous' and customer_email is null from public.booking_requests where id = (:'r6'::jsonb->>'request_id')::uuid));
select pg_temp.intake('{"message_id":"SMS-7","phone":"0611223344","first_name":"Claire","email":"autre@example.test"}') as r7 \gset
select pg_temp.ok('numéro connu sous une autre adresse : ambigu', (select customer_match = 'ambiguous' and customer_email = 'autre@example.test' and customer_last_name is null from public.booking_requests where id = (:'r7'::jsonb->>'request_id')::uuid));
select pg_temp.intake('{"message_id":"SMS-8","first_name":"Claire","last_name":"Exemple"}') as r8 \gset
select pg_temp.ok('nom seul : jamais rapproché', (select customer_match = 'none' and customer_email is null from public.booking_requests where id = (:'r8'::jsonb->>'request_id')::uuid));
select pg_temp.intake('{"message_id":"SMS-9","phone":"0655555555","first_name":"Marc"}') as r9 \gset
select pg_temp.ok('client d''un autre praticien : non rapproché', (select customer_match = 'none' and customer_email is null from public.booking_requests where id = (:'r9'::jsonb->>'request_id')::uuid));

select pg_temp.ok('une demande d''agent ne sert jamais de référence client', (pg_temp.intake('{"message_id":"SMS-9b","phone":"0600000001","first_name":"Inconnue"}')->>'customer_match') = 'none');

\echo '== 4. Conversation : la demande est mise à jour (cas B) =='
select pg_temp.intake('{"message_id":"SMS-10","conversation_id":"CONV-A","phone":"0600000010","first_name":"Léa","message_text":"Bonjour, je voudrais un rendez-vous."}') as r10 \gset
select pg_temp.intake('{"message_id":"SMS-11","conversation_id":"CONV-A","phone":"0600000010","message_text":"Vous auriez une place lundi matin ?","preferred_period":"lundi matin","service_hint":"guidance"}') as r11 \gset
select pg_temp.ok('message suivant : même demande mise à jour', (:'r11'::jsonb->>'outcome') = 'updated' and (:'r11'::jsonb->>'request_id') = (:'r10'::jsonb->>'request_id'));
select pg_temp.ok('souhait ajouté, messages conservés dans l''ordre', (select preferred_period = 'lundi matin' and customer_message like 'Bonjour%lundi matin ?' and service_hint = 'guidance' from public.booking_requests where id = (:'r10'::jsonb->>'request_id')::uuid));
select pg_temp.ok('deux événements (created, updated)', (select array_agg(action order by id) from public.booking_request_intake_events where request_id = (:'r10'::jsonb->>'request_id')::uuid) = array['created','updated']);
select pg_temp.ok('relecture du 2e message : duplicate', (pg_temp.intake('{"message_id":"SMS-11","conversation_id":"CONV-A","preferred_period":"autre"}')->>'outcome') = 'duplicate');
select pg_temp.ok('aucun booking créé', (select count(*) from public.bookings) = 4);

\echo '== 5. Créneau précis demandé (cas C) puis confirmation par le flux existant =='
select pg_temp.intake(jsonb_build_object('message_id','SMS-12','phone','0611223344','first_name','Claire','service_id','bbbbbbbb-0000-0000-0000-000000000001','modality','video',
  'proposed_starts_at', (date_trunc('day', now()) + interval '12 days 12 hours')::text, 'message_text','Je voudrais mardi à 14h en visio.')) as r12 \gset
select pg_temp.ok('demande pending avec créneau proposé, sans booking', (select status = 'pending' and proposed_starts_at is not null and confirmed_booking_id is null and not needs_review from public.booking_requests where id = (:'r12'::jsonb->>'request_id')::uuid) and (select count(*) from public.bookings) = 4);
select public.confirm_booking_request((:'r12'::jsonb->>'request_id')::uuid, :P, (select proposed_starts_at from public.booking_requests where id = (:'r12'::jsonb->>'request_id')::uuid), 0, 7000, null) as c1 \gset
select pg_temp.ok('confirmation existante : booking créé', (:'c1'::jsonb->>'success')::boolean and (select count(*) from public.bookings) = 5);
select pg_temp.ok('demande planifiée, booking relié', (select status = 'scheduled' and confirmed_booking_id = (:'c1'::jsonb->>'booking_id')::uuid from public.booking_requests where id = (:'r12'::jsonb->>'request_id')::uuid));
select pg_temp.ok('booking aux coordonnées du client connu', (select customer_email = 'claire@example.test' and customer_last_name = 'Exemple' and status = 'confirmed' from public.bookings where id = (:'c1'::jsonb->>'booking_id')::uuid));
select pg_temp.ok('demande sans prestation : confirmation refusée', (public.confirm_booking_request((:'r1'::jsonb->>'request_id')::uuid, :P, now() + interval '20 days', 0, null, null)->>'error') = 'service_not_found');
select pg_temp.ok('nouveau message après planification : nouvelle demande', (pg_temp.intake('{"message_id":"SMS-13","conversation_id":"CONV-A","message_text":"merci"}')->>'outcome') in ('created','updated'));

\echo '== 6. Contraintes =='
do $$ begin
  begin
    insert into public.booking_requests(practitioner_id, service_id, customer_first_name, status) values ('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','Web','pending');
    raise exception 'contrainte manquante';
  exception when check_violation then raise notice 'OK  formulaire du site : champs toujours obligatoires'; end;
  begin
    perform public.lumia_upsert_booking_request('aaaaaaaa-0000-0000-0000-000000000001', '{"agent":"lumia","channel":"pigeon","message_id":"X"}');
    raise exception 'contrainte manquante';
  exception when check_violation then raise notice 'OK  canal inconnu refusé'; end;
end $$;
select pg_temp.ok('fonction : appel incomplet refusé', (public.lumia_upsert_booking_request(:P, '{"agent":"lumia","channel":"sms"}')->>'error') = 'invalid_intake');
reset role;
\echo 'TOUS LES SCÉNARIOS SÉQUENTIELS SONT PASSÉS'
