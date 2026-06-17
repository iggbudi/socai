-- Setup read-only PostgreSQL user for AI db_query tool.
-- Jalankan sebagai superuser / owner database:
--   psql -U postgres -d socai -f scripts/setup-ai-readonly.sql
--
-- GANTI password placeholder di bawah sebelum production:
--   socai_ai_read / GANTI_PASSWORD_INI

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'socai_ai_read') THEN
    CREATE ROLE socai_ai_read LOGIN PASSWORD 'GANTI_PASSWORD_INI';
    RAISE NOTICE 'Role socai_ai_read dibuat.';
  ELSE
    RAISE NOTICE 'Role socai_ai_read sudah ada, dilewati.';
  END IF;
END
$$;

-- Izin koneksi ke database (nama default: socai; sesuaikan jika berbeda)
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_database WHERE datname = current_database()) THEN
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO socai_ai_read', current_database());
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO socai_ai_read;

-- Hanya SELECT pada tabel yang diizinkan untuk tool db_query
GRANT SELECT ON TABLE public.produk TO socai_ai_read;
GRANT SELECT ON TABLE public.pemasaran TO socai_ai_read;

-- Pastikan tidak ada hak tulang selain SELECT (idempotent revoke)
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.produk FROM socai_ai_read;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.pemasaran FROM socai_ai_read;

-- Hindari akses ke tabel lain di schema public
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM socai_ai_read;