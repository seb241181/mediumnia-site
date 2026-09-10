-- Historical migration recovered from the deployed Supabase function.

create or replace function public.search_agent_document_chunks(
  p_agent_id uuid,
  p_query text,
  p_limit integer default 6
)
returns table (
  chunk_id bigint,
  document_id uuid,
  document_name text,
  chunk_index integer,
  content text,
  rank real
)
language sql
stable
set search_path = public, pg_temp
as $$
  with query_vector as (
    select to_tsvector('french', coalesce(nullif(trim(p_query), ''), '')) as value
  ),
  q as (
    select case
      when cardinality(tsvector_to_array(value)) = 0 then null::tsquery
      else to_tsquery('french', array_to_string(tsvector_to_array(value), ' | '))
    end as query
    from query_vector
  )
  select
    c.id,
    c.document_id,
    d.name,
    c.chunk_index,
    c.content,
    ts_rank_cd(to_tsvector('french', c.content), q.query)::real as rank
  from public.agent_document_chunks c
  join public.agent_documents d on d.id = c.document_id
  cross join q
  where c.agent_id = p_agent_id
    and c.owner_id = (select auth.uid())
    and d.owner_id = (select auth.uid())
    and d.agent_id = p_agent_id
    and d.status = 'ready'
    and d.approved_for_ai = true
    and d.sensitivity <> 'restricted'
    and q.query is not null
    and to_tsvector('french', c.content) @@ q.query
  order by rank desc, c.chunk_index asc
  limit greatest(1, least(coalesce(p_limit, 6), 12));
$$;
