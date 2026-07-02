-- Blog: artículos de contenido público. category/status son Parameter
-- ('blog_category' / 'blog_status'). author es un PlatformAdmin. slug único.
-- Los endpoints públicos filtran status='published'; el borrado es suave
-- (status -> 'archived'). created_at/updated_at del seed en SQL.

-- ── avatar_url en platform_admins (foto del autor del blog) ──────────────
ALTER TABLE "platform_admins" ADD COLUMN "avatar_url" VARCHAR(500);

-- ── Seed de parámetros (categorías + estados) ───────────────────────────
INSERT INTO "parameters" ("type", "code", "label", "description", "is_active", "sort_order", "created_at", "updated_at")
VALUES
  -- Categorías del blog (el code es el slug de la categoría en la URL)
  ('blog_category', 'analisis-de-credito', 'Análisis de crédito', 'Artículos sobre estudios y análisis de crédito', true, 0, NOW(), NOW()),
  ('blog_category', 'finanzas-pymes', 'Finanzas para PYMES', 'Finanzas prácticas para pequeñas y medianas empresas', true, 1, NOW(), NOW()),
  ('blog_category', 'gestion-de-cartera', 'Gestión de cartera', 'Cobranza, cartera y recuperación', true, 2, NOW(), NOW()),
  -- Estados del ciclo de vida del artículo
  ('blog_status', 'draft', 'Borrador', 'Artículo en edición, no visible al público', true, 0, NOW(), NOW()),
  ('blog_status', 'published', 'Publicado', 'Artículo visible en el blog público', true, 1, NOW(), NOW()),
  ('blog_status', 'archived', 'Archivado', 'Artículo retirado (borrado suave)', true, 2, NOW(), NOW())
ON CONFLICT ("type", "code") DO NOTHING;

-- ── Tabla: blog_posts ───────────────────────────────────────────────────
CREATE TABLE "blog_posts" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(255) NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "excerpt" VARCHAR(500),
    "content" TEXT NOT NULL,
    "cover_image_url" VARCHAR(500),
    "category_id" INTEGER NOT NULL,
    "author_id" UUID NOT NULL,
    "reading_minutes" INTEGER,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status_id" INTEGER NOT NULL,
    "published_at" TIMESTAMP(3),
    "meta_title" VARCHAR(300),
    "meta_description" VARCHAR(500),
    "og_image_url" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "blog_posts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "blog_posts_slug_key" ON "blog_posts"("slug");
CREATE INDEX "blog_posts_status_id_published_at_idx" ON "blog_posts"("status_id", "published_at");
CREATE INDEX "blog_posts_category_id_idx" ON "blog_posts"("category_id");

ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "parameters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_status_id_fkey" FOREIGN KEY ("status_id") REFERENCES "parameters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "blog_posts" ADD CONSTRAINT "blog_posts_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "platform_admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
