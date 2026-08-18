-- =====================================================
-- CopiaCRM — Script de Setup Completo para o Supabase
-- Rode TUDO isso no SQL Editor do painel Supabase
-- =====================================================

-- 1. Criar tabela de licenças (se não existir)
CREATE TABLE IF NOT EXISTS public.licenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE NOT NULL,
    plan_expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Adicionar colunas de pagamento (caso já exista a tabela sem elas)
ALTER TABLE public.licenses ADD COLUMN IF NOT EXISTS amount_paid NUMERIC DEFAULT 0;
ALTER TABLE public.licenses ADD COLUMN IF NOT EXISTS api_enabled BOOLEAN DEFAULT false;

-- 3. Habilitar Row Level Security
ALTER TABLE public.licenses ENABLE ROW LEVEL SECURITY;

-- 4. Política: Usuário logado só lê a própria licença
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'licenses' AND policyname = 'Leitura_Propria_Licenca'
  ) THEN
    CREATE POLICY "Leitura_Propria_Licenca"
    ON public.licenses FOR SELECT
    USING ( auth.uid() = user_id );
  END IF;
END $$;

-- 5. Política: Service Role (webhook) pode inserir/atualizar qualquer linha
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'licenses' AND policyname = 'Service_Role_Full'
  ) THEN
    CREATE POLICY "Service_Role_Full"
    ON public.licenses FOR ALL
    USING ( auth.role() = 'service_role' )
    WITH CHECK ( auth.role() = 'service_role' );
  END IF;
END $$;

-- 6. Tabela de logs de webhook para debug (captura o payload da InfinitePay)
CREATE TABLE IF NOT EXISTS public.webhook_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payload JSONB,
    raw_body TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Desabilitar RLS na tabela de logs (service role precisa escrever)
ALTER TABLE public.webhook_logs DISABLE ROW LEVEL SECURITY;

-- 7. Trigger para criar licença Trial de 3 dias automaticamente ao criar usuário no Supabase Auth
CREATE OR REPLACE FUNCTION public.handle_new_user_license()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.licenses (user_id, email, plan_expires_at, amount_paid, api_enabled)
  VALUES (
    NEW.id,
    NEW.email,
    NOW() + INTERVAL '3 days',
    0,
    false
  )
  ON CONFLICT (email) DO UPDATE SET
    user_id = EXCLUDED.user_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger disparado automaticamente após cadastrar usuário na tabela auth.users
DROP TRIGGER IF EXISTS on_auth_user_created_license ON auth.users;
CREATE TRIGGER on_auth_user_created_license
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_license();

