-- ============================================================
-- MÓDULO FINANCEIRO — Script de criação das tabelas
-- Execute no Supabase SQL Editor (Dashboard > SQL Editor)
-- ============================================================

-- 1. Grupos DRE (antes de categorias, pois categorias referenciam grupos)
CREATE TABLE IF NOT EXISTS fin_grupos_dre (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           TEXT NOT NULL,
  nome              TEXT NOT NULL,
  tipo              TEXT NOT NULL DEFAULT 'despesa', -- 'receita','deducao','custo','despesa','imposto'
  operacao          TEXT NOT NULL DEFAULT 'subtrai', -- 'soma','subtrai'
  ordem             INT  NOT NULL DEFAULT 0,
  total_parcial_apos TEXT,
  campos_automaticos TEXT[] DEFAULT '{}',
  created_at        TIMESTAMPTZ DEFAULT now()
);

-- 2. Categorias
CREATE TABLE IF NOT EXISTS fin_categorias (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      TEXT NOT NULL,
  nome         TEXT NOT NULL,
  tipo         TEXT NOT NULL DEFAULT 'despesa', -- 'receita','despesa'
  cor          TEXT NOT NULL DEFAULT '#6366f1',
  ordem        INT  NOT NULL DEFAULT 0,
  ativo        BOOLEAN NOT NULL DEFAULT true,
  grupo_dre_id UUID REFERENCES fin_grupos_dre(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- 3. Contas bancárias
CREATE TABLE IF NOT EXISTS fin_contas (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       TEXT NOT NULL,
  nome          TEXT NOT NULL,
  tipo          TEXT NOT NULL DEFAULT 'corrente', -- 'corrente','poupanca','investimento','caixa'
  banco         TEXT,
  saldo_inicial NUMERIC(12,2) NOT NULL DEFAULT 0,
  ativo         BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- 4. Meios de pagamento
CREATE TABLE IF NOT EXISTS fin_meios (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             TEXT NOT NULL,
  nome                TEXT NOT NULL,
  tipo                TEXT NOT NULL DEFAULT 'pix', -- 'pix','credito','debito','dinheiro','ted','boleto'
  taxa_percentual     NUMERIC(6,4) NOT NULL DEFAULT 0,
  taxa_fixa           NUMERIC(10,2) NOT NULL DEFAULT 0,
  prazo_recebimento   INT NOT NULL DEFAULT 0, -- dias até cair na conta
  ativo               BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ DEFAULT now()
);

-- 5. Receitas (A Receber)
CREATE TABLE IF NOT EXISTS fin_receitas (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               TEXT NOT NULL,
  job_id                INT  REFERENCES jobs(id) ON DELETE SET NULL,
  cliente_id            UUID REFERENCES clients(id) ON DELETE SET NULL,
  cliente_nome          TEXT,
  descricao             TEXT NOT NULL,
  valor_bruto           NUMERIC(12,2) NOT NULL DEFAULT 0,
  taxa_meio             NUMERIC(12,2) NOT NULL DEFAULT 0,
  valor_liquido         NUMERIC(12,2) NOT NULL DEFAULT 0,
  data_vencimento       DATE,
  data_pagamento        DATE,
  data_recebimento_real DATE,
  status                TEXT NOT NULL DEFAULT 'pendente', -- 'pendente','recebido','atrasado'
  parcela               INT NOT NULL DEFAULT 1,
  total_parcelas        INT NOT NULL DEFAULT 1,
  recorrente            BOOLEAN NOT NULL DEFAULT false,
  frequencia_recorrencia TEXT, -- 'mensal','trimestral','anual'
  meio_id               UUID REFERENCES fin_meios(id) ON DELETE SET NULL,
  conta_id              UUID REFERENCES fin_contas(id) ON DELETE SET NULL,
  categoria_id          UUID REFERENCES fin_categorias(id) ON DELETE SET NULL,
  origem_automatica     BOOLEAN NOT NULL DEFAULT false,
  updated_at            TIMESTAMPTZ DEFAULT now(),
  created_at            TIMESTAMPTZ DEFAULT now()
);

-- 6. Despesas (A Pagar)
CREATE TABLE IF NOT EXISTS fin_despesas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         TEXT NOT NULL,
  descricao       TEXT NOT NULL,
  fornecedor      TEXT,
  valor           NUMERIC(12,2) NOT NULL DEFAULT 0,
  data_vencimento DATE,
  data_pagamento  DATE,
  status          TEXT NOT NULL DEFAULT 'pendente', -- 'pendente','pago','atrasado'
  recorrente      BOOLEAN NOT NULL DEFAULT false,
  frequencia_recorrencia TEXT,
  meio_id         UUID REFERENCES fin_meios(id) ON DELETE SET NULL,
  conta_id        UUID REFERENCES fin_contas(id) ON DELETE SET NULL,
  categoria_id    UUID REFERENCES fin_categorias(id) ON DELETE SET NULL,
  updated_at      TIMESTAMPTZ DEFAULT now(),
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- 7. Transações OFX (extrato bancário)
CREATE TABLE IF NOT EXISTS fin_transacoes_ofx (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             TEXT NOT NULL,
  conta_id            UUID REFERENCES fin_contas(id) ON DELETE CASCADE,
  fit_id              TEXT NOT NULL, -- ID único da transação no OFX
  tipo                TEXT NOT NULL DEFAULT 'debito', -- 'credito','debito'
  valor               NUMERIC(12,2) NOT NULL DEFAULT 0,
  data                DATE NOT NULL,
  descricao           TEXT,
  status_conciliacao  TEXT NOT NULL DEFAULT 'pendente', -- 'pendente','conciliado','ignorado'
  receita_id          UUID REFERENCES fin_receitas(id) ON DELETE SET NULL,
  despesa_id          UUID REFERENCES fin_despesas(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ DEFAULT now(),
  UNIQUE(conta_id, fit_id) -- evita duplicatas de OFX
);

-- ============================================================
-- Índices para performance
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_fin_receitas_user_id   ON fin_receitas(user_id);
CREATE INDEX IF NOT EXISTS idx_fin_receitas_status     ON fin_receitas(status);
CREATE INDEX IF NOT EXISTS idx_fin_receitas_vencimento ON fin_receitas(data_vencimento);
CREATE INDEX IF NOT EXISTS idx_fin_receitas_job_id     ON fin_receitas(job_id);
CREATE INDEX IF NOT EXISTS idx_fin_despesas_user_id    ON fin_despesas(user_id);
CREATE INDEX IF NOT EXISTS idx_fin_despesas_status     ON fin_despesas(status);
CREATE INDEX IF NOT EXISTS idx_fin_despesas_vencimento ON fin_despesas(data_vencimento);
CREATE INDEX IF NOT EXISTS idx_fin_categorias_user_id  ON fin_categorias(user_id);
CREATE INDEX IF NOT EXISTS idx_fin_grupos_dre_user_id  ON fin_grupos_dre(user_id);
CREATE INDEX IF NOT EXISTS idx_fin_contas_user_id      ON fin_contas(user_id);
CREATE INDEX IF NOT EXISTS idx_fin_meios_user_id       ON fin_meios(user_id);
CREATE INDEX IF NOT EXISTS idx_fin_ofx_user_id         ON fin_transacoes_ofx(user_id);

-- ============================================================
-- Row Level Security (RLS) — cada usuário só vê seus dados
-- ============================================================
ALTER TABLE fin_grupos_dre      ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin_categorias      ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin_contas          ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin_meios           ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin_receitas        ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin_despesas        ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin_transacoes_ofx  ENABLE ROW LEVEL SECURITY;

-- Políticas: user_id = auth.uid()::text
CREATE POLICY "fin_grupos_dre_user"     ON fin_grupos_dre     USING (user_id = auth.uid()::text);
CREATE POLICY "fin_categorias_user"     ON fin_categorias     USING (user_id = auth.uid()::text);
CREATE POLICY "fin_contas_user"         ON fin_contas         USING (user_id = auth.uid()::text);
CREATE POLICY "fin_meios_user"          ON fin_meios          USING (user_id = auth.uid()::text);
CREATE POLICY "fin_receitas_user"       ON fin_receitas       USING (user_id = auth.uid()::text);
CREATE POLICY "fin_despesas_user"       ON fin_despesas       USING (user_id = auth.uid()::text);
CREATE POLICY "fin_transacoes_ofx_user" ON fin_transacoes_ofx USING (user_id = auth.uid()::text);
