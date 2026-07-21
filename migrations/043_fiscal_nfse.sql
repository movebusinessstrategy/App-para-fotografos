-- Rode no SQL Editor do Supabase. Idempotente.
--
-- Bloco "Nota Fiscal" (NFS-e via PlugNotas), multi-tenant. Cada estúdio (user_id)
-- guarda a sua configuração fiscal e as notas que emitiu. A nota NÃO sai no sinal
-- de 30% — só depois do ENSAIO REALIZADO, pelo valor cheio do serviço.
--
-- IMPORTANTE (segurança): o certificado digital A1 (.pfx) e a senha NÃO são
-- guardados aqui. Eles são enviados pro PlugNotas no cadastro da empresa e
-- descartados; o nosso banco só registra que o certificado foi enviado.

-- ── Configuração fiscal por estúdio ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fiscal_config (
  user_id                uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  provider               text    NOT NULL DEFAULT 'plugnotas',
  environment            text    NOT NULL DEFAULT 'sandbox',   -- 'sandbox' | 'production'
  ativo                  boolean NOT NULL DEFAULT false,        -- emissão liberada (config completa + empresa cadastrada)

  -- Identificação do prestador (emitente)
  cnpj                   text,
  inscricao_municipal    text,
  inscricao_estadual     text,
  razao_social           text,
  nome_fantasia          text,
  regime_tributario      integer,                               -- código PlugNotas (ex.: Simples Nacional)
  simples_nacional       boolean NOT NULL DEFAULT true,
  incentivo_cultural     boolean NOT NULL DEFAULT false,
  email                  text,
  telefone               text,

  -- Endereço do prestador
  cep                    text,
  logradouro             text,
  numero                 text,
  complemento            text,
  bairro                 text,
  codigo_cidade          text,                                  -- código IBGE da cidade
  cidade                 text,
  estado                 text,                                  -- UF

  -- Dados do serviço (NFS-e)
  servico_codigo         text,                                  -- código do serviço municipal / item LC 116
  servico_cnae           text,
  servico_discriminacao  text,                                  -- descrição padrão (editável por nota)
  iss_aliquota           numeric NOT NULL DEFAULT 0,            -- % do ISS

  -- Estado da integração com o provedor
  empresa_cadastrada     boolean NOT NULL DEFAULT false,        -- já criou a empresa no PlugNotas
  certificado_enviado    boolean NOT NULL DEFAULT false,
  certificado_validade   date,

  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- ── Notas emitidas ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fiscal_invoices (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id             bigint REFERENCES jobs(id) ON DELETE SET NULL,  -- o ensaio realizado (jobs.id é bigint neste banco)
  deal_id            bigint,
  client_id          bigint,

  tipo               text NOT NULL DEFAULT 'nfse',               -- 'nfse' (serviço) | 'nfe' (produto, fase 2)
  provider_id        text,                                       -- id da nota no PlugNotas (consulta/cancelamento)
  status             text NOT NULL DEFAULT 'processando',        -- processando|autorizada|rejeitada|cancelada|erro
  valor              numeric NOT NULL DEFAULT 0,                  -- valor cheio do serviço
  numero             text,                                       -- número da nota (quando autorizada)
  codigo_verificacao text,
  pdf_url            text,
  xml_url            text,

  tomador_nome       text,
  tomador_doc        text,                                       -- CPF/CNPJ do cliente
  discriminacao      text,
  error_message      text,                                       -- motivo da rejeição/erro

  emitida_em         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fiscal_invoices_user    ON fiscal_invoices (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fiscal_invoices_job     ON fiscal_invoices (job_id);
CREATE INDEX IF NOT EXISTS idx_fiscal_invoices_provider ON fiscal_invoices (provider_id);

-- ── RLS: dono acessa o seu; o backend usa service role (com .eq('user_id')). ──
ALTER TABLE fiscal_config   ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiscal_invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fiscal_config_owner   ON fiscal_config;
DROP POLICY IF EXISTS fiscal_invoices_owner ON fiscal_invoices;

CREATE POLICY fiscal_config_owner   ON fiscal_config
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY fiscal_invoices_owner ON fiscal_invoices
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
