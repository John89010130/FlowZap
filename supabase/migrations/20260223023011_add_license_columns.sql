-- Adicionar colunas de pagamento (caso já exista a tabela sem elas)
ALTER TABLE public.licenses ADD COLUMN IF NOT EXISTS amount_paid NUMERIC DEFAULT 0;
ALTER TABLE public.licenses ADD COLUMN IF NOT EXISTS api_enabled BOOLEAN DEFAULT false;
