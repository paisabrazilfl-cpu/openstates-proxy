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

create index if not exists knowledge_documents_source_type_idx
  on public.knowledge_documents (source_type);

create index if not exists knowledge_documents_topic_tags_idx
  on public.knowledge_documents using gin (topic_tags);

create index if not exists knowledge_documents_content_fts_idx
  on public.knowledge_documents
  using gin (to_tsvector('english', content));
