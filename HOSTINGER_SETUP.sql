create table if not exists knowledge_documents (
  id varchar(255) not null,
  source_type varchar(100) not null default 'knowledge',
  title varchar(500) not null,
  content longtext not null,
  topic_tags json null,
  references_json json null,
  media_json json null,
  source varchar(1000) null,
  metadata_json json null,
  created_at timestamp not null default current_timestamp,
  updated_at timestamp not null default current_timestamp on update current_timestamp,
  primary key (id),
  key knowledge_documents_source_type_idx (source_type),
  fulltext key knowledge_documents_title_content_ft (title, content)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci;
