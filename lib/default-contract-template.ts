// Modelo de contrato padrão criado automaticamente em conta nova.
// Genérico (não específico de fotografia): identifica partes, descreve
// o objeto contratado, valor, prazo, foro. Usa os placeholders já
// reconhecidos pelo substituteVariables() de src/utils/contractTemplate.ts.

export const DEFAULT_TEMPLATE = {
  name: 'Contrato de prestação de serviços (padrão)',
  category: 'GERAL',
  is_default: true,
  default_data: {},
  body: `CONTRATO DE PRESTAÇÃO DE SERVIÇOS

Pelo presente instrumento particular, de um lado, a empresa contratada,
doravante denominada CONTRATADA, e de outro {{cliente_nome}}, inscrito(a)
no CPF/CNPJ sob o nº {{cliente_cpf}}, residente em {{cliente_endereco}},
telefone {{cliente_telefone}}, e-mail {{cliente_email}}, doravante
denominado(a) CONTRATANTE, têm entre si justo e contratado o seguinte:

1. OBJETO
1.1. A CONTRATADA prestará à CONTRATANTE os serviços descritos no
orçamento aprovado, na data de {{servico_data}} às {{servico_hora}},
no endereço {{servico_endereco}}.

2. VALOR E FORMA DE PAGAMENTO
2.1. O valor total pelos serviços é de R$ {{valor_total}}
({{valor_extenso}}), a ser pago conforme combinado entre as partes.
2.2. O não pagamento na data acordada implicará em multa de 2% sobre
o valor devido, acrescido de juros de mora de 1% ao mês.

3. EXECUÇÃO E PRAZOS
3.1. A CONTRATADA compromete-se a executar os serviços com diligência,
qualidade e dentro dos prazos pactuados.
3.2. Eventuais alterações de escopo deverão ser formalizadas por escrito
entre as partes.

4. USO DE IMAGEM
4.1. O(a) CONTRATANTE {{autorizacao_imagem}} o uso de imagens produzidas
durante a execução dos serviços para fins de divulgação do trabalho da
CONTRATADA em portfólio e redes sociais.

5. RESCISÃO
5.1. O presente contrato poderá ser rescindido por qualquer das partes,
mediante comunicação por escrito com antecedência mínima de 7 (sete) dias.
5.2. Em caso de cancelamento pela CONTRATANTE com menos de 48 horas da
execução, ficará retido o valor já pago a título de reserva.

6. FORO
6.1. Fica eleito o foro da comarca onde a CONTRATADA tem sua sede
principal para dirimir quaisquer dúvidas ou controvérsias decorrentes
deste contrato, renunciando as partes a qualquer outro, por mais
privilegiado que seja.

E por estarem assim justos e contratados, assinam o presente instrumento
em duas vias de igual teor.

____________________________, {{ano}}.


_____________________________________
CONTRATANTE: {{cliente_nome}}


_____________________________________
CONTRATADA
`,
};
