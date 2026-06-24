create table if not exists public.knowledge_documents (
  id text primary key,
  source_type text not null default 'knowledge',
  title text not null,
  content text not null,
  topic_tags text[] not null default '{}',
  references jsonb not null default '[]'::jsonb,
  media jsonb,
  source text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.knowledge_documents
  add column if not exists search_vector tsvector generated always as (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(content, ''))
  ) stored;

create index if not exists knowledge_documents_source_type_idx
  on public.knowledge_documents (source_type);

create index if not exists knowledge_documents_topic_tags_idx
  on public.knowledge_documents using gin (topic_tags);

create index if not exists knowledge_documents_search_vector_idx
  on public.knowledge_documents using gin (search_vector);

create or replace function public.match_knowledge_documents(
  query_text text,
  match_count integer default 5
)
returns table (
  id text,
  source_type text,
  title text,
  content text,
  topic_tags text[],
  references jsonb,
  media jsonb,
  source text,
  metadata jsonb,
  score real
)
language sql
stable
as $$
  with query as (
    select websearch_to_tsquery('english', coalesce(nullif(trim(query_text), ''), 'islam')) as value
  )
  select
    documents.id,
    documents.source_type,
    documents.title,
    documents.content,
    documents.topic_tags,
    documents.references,
    documents.media,
    documents.source,
    documents.metadata,
    ts_rank_cd(documents.search_vector, query.value)::real as score
  from public.knowledge_documents as documents
  cross join query
  where documents.search_vector @@ query.value
  order by score desc, documents.updated_at desc
  limit greatest(1, least(coalesce(match_count, 5), 20));
$$;
