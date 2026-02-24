-- Tabela de atendimentos do CopiaCRM
-- Execute este SQL no Supabase SQL Editor

CREATE TABLE IF NOT EXISTS public.crm_atendimentos (
  id           TEXT PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date         DATE NOT NULL,
  contato      TEXT NOT NULL,
  num_mensagens INTEGER DEFAULT 1,
  ultima_mensagem TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  
  -- Evita duplicatas: mesmo usuário, mesmo dia, mesmo contato
  UNIQUE (user_id, date, contato)
);

-- Índices para queries rápidas por período
CREATE INDEX IF NOT EXISTS idx_crm_atend_user_date 
  ON public.crm_atendimentos(user_id, date);

-- RLS: cada usuário só vê e altera os seus próprios dados
ALTER TABLE public.crm_atendimentos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own atendimentos" 
  ON public.crm_atendimentos FOR SELECT 
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own atendimentos" 
  ON public.crm_atendimentos FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own atendimentos" 
  ON public.crm_atendimentos FOR UPDATE 
  USING (auth.uid() = user_id);

CREATE POLICY "Users delete own atendimentos" 
  ON public.crm_atendimentos FOR DELETE 
  USING (auth.uid() = user_id);
