-- ChronoSphère MAX — reprise par compte sans jeton rotatif.
--
-- La reprise d'un compte authentifié adoptait le pack via pack_token_hash, que
-- l'action status fait tourner en parallèle à la connexion : l'adoption pouvait
-- échouer (max_access_denied) et afficher une fausse « lecture récupérable ».
--
-- adopt_chronosphere_max_attempt identifie le pack par user_id (dernier pack
-- max3 actif ou épuisé), sous verrou de ligne : aucune valeur fournie par le
-- client, aucun jeton, et un utilisateur n'adopte jamais le pack d'un autre.
-- Même comportement que begin_chronosphere_max_attempt sans nonce : dernière
-- tentative du pack, sinon tirage historique terminé et orphelin, sinon rien.
-- Service role uniquement. Additive : aucune fonction existante n'est modifiée.
begin;

create function public.adopt_chronosphere_max_attempt(p_user_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  p public.chronosphere_credit_packs%rowtype;
  a public.chronosphere_max_attempts%rowtype;
  d public.chronosphere_pack_draws%rowtype;
  v_id uuid := gen_random_uuid();
begin
  if p_user_id is null then raise exception 'max_access_denied'; end if;
  select * into p from public.chronosphere_credit_packs
    where user_id = p_user_id and product_type = 'max3' and status in ('active', 'exhausted')
    order by created_at desc, id desc limit 1
    for update;
  if not found then return null; end if;

  select * into a from public.chronosphere_max_attempts
    where pack_id = p.id and user_id = p_user_id order by created_at desc, id desc limit 1;
  if found then return a.id; end if;

  -- Un tirage historique encore en cours exige sa requête d'origine (onglet initial).
  if exists (
    select 1 from public.chronosphere_pack_draws x where x.pack_id = p.id and x.status = 'processing'
      and not exists (select 1 from public.chronosphere_max_attempts m where m.draw_id = x.id)
  ) then raise exception 'max_legacy_request_required'; end if;

  select x.* into d from public.chronosphere_pack_draws x
    where x.pack_id = p.id and x.status = 'completed'
      and not exists (select 1 from public.chronosphere_max_attempts m where m.draw_id = x.id)
      and not exists (select 1 from public.chronosphere_timeline_entries e where e.source_draw_table = 'chronosphere_pack_draws' and e.source_draw_id = x.id)
    order by x.created_at, x.id limit 1;
  if found then
    insert into public.chronosphere_max_attempts(id, pack_id, user_id, nonce, request_json, request_hash, draw_id)
      values (v_id, p.id, p_user_id, 'legacy-' || d.id,
        jsonb_build_object('profile', d.result_json->'profile', 'theme', d.result_json->>'theme', 'maxTimelineTitle', d.result_json->>'theme'),
        d.request_hash, d.id);
    return v_id;
  end if;
  return null;
end $$;

revoke all on function public.adopt_chronosphere_max_attempt(uuid) from public, anon, authenticated;
grant execute on function public.adopt_chronosphere_max_attempt(uuid) to service_role;

commit;
