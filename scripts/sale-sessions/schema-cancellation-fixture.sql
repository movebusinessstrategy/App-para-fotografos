CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT '11111111-1111-1111-1111-111111111111'::uuid
$$;

CREATE TABLE fin_despesas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  descricao text NOT NULL,
  fornecedor text,
  valor numeric(12,2) NOT NULL DEFAULT 0,
  data_vencimento date,
  data_pagamento date,
  status text NOT NULL DEFAULT 'pendente',
  recorrente boolean NOT NULL DEFAULT false,
  frequencia_recorrencia text,
  meio_id uuid,
  conta_id uuid,
  categoria_id uuid,
  origem_ref text,
  updated_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  UNIQUE (user_id, origem_ref)
);

