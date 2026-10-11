-- Keep extension objects out of the exposed public schema. The installed
-- extension is relocatable; moving it preserves OIDs and dependent indexes.
alter extension btree_gist set schema extensions;
