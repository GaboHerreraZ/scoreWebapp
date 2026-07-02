-- La imagen de Open Graph del blog pasa a usar coverImageUrl (la portada sirve
-- de preview social). Se elimina la columna og_image_url de blog_posts.

ALTER TABLE "blog_posts" DROP COLUMN "og_image_url";
