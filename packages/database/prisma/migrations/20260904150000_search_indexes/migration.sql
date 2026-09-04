-- Триграммные индексы для нечёткого поиска устройств и товаров (pg_trgm)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE INDEX IF NOT EXISTS "DeviceAlias_normalized_trgm_idx" ON "DeviceAlias" USING GIN ("normalized" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "DeviceModel_name_trgm_idx" ON "DeviceModel" USING GIN (lower("fullName") gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "DeviceIdentifier_normalized_trgm_idx" ON "DeviceIdentifier" USING GIN ("normalized" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Product_searchText_trgm_idx" ON "Product" USING GIN ("searchText" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "ProductVariant_sku_trgm_idx" ON "ProductVariant" USING GIN (lower("sku") gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Product_searchText_fts_idx" ON "Product" USING GIN (to_tsvector('simple', coalesce("searchText", '')));
