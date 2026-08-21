import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decideProcessorSettlement,
  decideReconciliation,
  detectInternalTransfers,
  fingerprintOfxTransaction,
  normalizePaymentMethod,
  OfxIncompleteAccountIdentityError,
  OfxMultipleAccountsError,
  parseOfx,
  parseOfxAmount,
  parseOfxDate,
  planLegacyAccountCorrection,
  projectJobPaymentsToReceitas,
  scoreReconciliationCandidate,
} from './financial-reconciliation.js';

const xmlOfx = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:UTF-8
CHARSET:1252

<OfX>
  <BankMsgSrsV1>
    <StmtTrnRs>
      <StmtRs>
        <CurDef>BRL</CurDef>
        <BankAcctFrom>
          <BankId>341</BankId>
          <AcctId>000111-2</AcctId>
          <AcctType>CHECKING</AcctType>
        </BankAcctFrom>
        <BankTranList>
          <DtStart>20260801000000[-3:BRT]</DtStart>
          <DtEnd>20260820235959[-3:BRT]</DtEnd>
          <StmtTrn>
            <TrnType>CREDIT</TrnType>
            <DtPosted>20260815120000[-3:BRT]</DtPosted>
            <TrnAmt>850.00</TrnAmt>
            <FitId>credito-001</FitId>
            <Name>Cliente Alfa &amp; Cia</Name>
            <Memo>PIX recebido Cliente Alfa</Memo>
          </StmtTrn>
        </BankTranList>
        <LedgerBal><BalAmt>3210.45</BalAmt><DtAsOf>20260820180000[-3:BRT]</DtAsOf></LedgerBal>
        <AvailBal><BalAmt>3100.45</BalAmt></AvailBal>
      </StmtRs>
    </StmtTrnRs>
  </BankMsgSrsV1>
</OfX>`;

test('lê OFX XML com tags case-insensitive, metadados bancários e saldo', () => {
  const parsed = parseOfx(xmlOfx);

  assert.deepEqual(parsed.metadata, {
    encoding: 'UTF-8',
    charset: '1252',
    bankId: '341',
    accountId: '000111-2',
    accountType: 'CHECKING',
    currency: 'BRL',
    dateStart: '2026-08-01',
    dateEnd: '2026-08-20',
    balanceAmount: 3210.45,
    balanceDate: '2026-08-20',
    availableBalanceAmount: 3100.45,
  });
  assert.equal(parsed.transactions.length, 1);
  assert.equal(parsed.transactions[0].description, 'PIX recebido Cliente Alfa');
  assert.equal(parsed.transactions[0].name, 'Cliente Alfa & Cia');
  assert.equal(parsed.transactions[0].type, 'credito');
  assert.deepEqual(parsed.totals, { credits: 850, debits: 0, count: 1 });
  assert.equal(parsed.multipleAccounts, false);
  assert.deepEqual(parsed.accountIdentities, [{
    bankId: '341', accountId: '000111-2', accountType: 'CHECKING', statementType: 'bank',
  }]);
});

test('lê OFX SGML sem fechamentos individuais e aceita vírgula decimal', () => {
  const parsed = parseOfx(`<OFX><BANKID>260<ACCTID>conta-2<BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260801<TRNAMT>-45,90<FITID>d-1<MEMO>Tarifa mensal
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260802<TRNAMT>1000.25<FITID>c-1<NAME>Cliente Beta
</BANKTRANLIST><LEDGERBAL><BALAMT>954.35<DTASOF>20260802</OFX>`);

  assert.equal(parsed.transactions.length, 2);
  assert.deepEqual(parsed.transactions.map((tx) => tx.amount), [45.9, 1000.25]);
  assert.deepEqual(parsed.transactions.map((tx) => tx.type), ['debito', 'credito']);
  assert.equal(parsed.metadata.balanceAmount, 954.35);
});

test('TRNTYPE conhecido corrige a direção quando TRNAMT vem com sinal inconsistente', () => {
  const parsed = parseOfx(`<OFX><BANKID>341<ACCTID>anon
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260803<TRNAMT>45.90<FITID>debito-positivo
<MEMO>Tarifa bancária</STMTTRN></OFX>`);

  assert.equal(parsed.transactions[0].type, 'debito');
  assert.equal(parsed.transactions[0].amount, 45.9);
  assert.equal(parsed.transactions[0].signedAmount, -45.9);
  assert.deepEqual(parsed.totals, { credits: 0, debits: 45.9, count: 1 });
});

test('usa o MEMO quando NAME é apenas um rótulo bancário genérico', () => {
  const parsed = parseOfx(`<OFX><BANKID>001<ACCTID>anon
<STMTTRN><DTPOSTED>20260802<TRNAMT>400<FITID>nome-generico
<NAME>PIX RECEBIDO<MEMO>PIX RECEBIDO Cliente Ômega</STMTTRN></OFX>`);

  assert.equal(parsed.transactions[0].counterpartyName, 'Cliente Ômega');
});

test('rejeita data e valor inválidos e não transforma linha de saldo em movimento', () => {
  const parsed = parseOfx(`<OFX><BANKID>001<ACCTID>anon
<STMTTRN><DTPOSTED>20260230<TRNAMT>100<FITID>data-invalida<MEMO>PIX recebido
</STMTTRN><STMTTRN><DTPOSTED>20260802<TRNAMT>abc<FITID>valor-invalido<MEMO>Compra
</STMTTRN><STMTTRN><DTPOSTED>20260803<TRNAMT>9999<FITID>saldo<MEMO>S A L D O TOTAL DISPONÍVEL DIA
</STMTTRN></OFX>`);

  assert.equal(parsed.transactions.length, 0);
  assert.equal(parsed.ignoredBalance, 1);
  assert.deepEqual(parsed.rejected.map((item) => item.reason), ['invalid_date', 'invalid_amount']);
});

test('ignora qualquer lançamento bancário cujo nome ou memo comece por saldo', () => {
  const parsed = parseOfx(`<OFX><BANKID>001<ACCTID>anon
<STMTTRN><DTPOSTED>20260803<TRNAMT>5000<FITID>saldo-final<NAME>SALDO FINAL</STMTTRN>
<STMTTRN><DTPOSTED>20260803<TRNAMT>4000<FITID>balance-forward<MEMO>Balance forward</STMTTRN>
</OFX>`);

  assert.equal(parsed.transactions.length, 0);
  assert.equal(parsed.ignoredBalance, 2);
  assert.deepEqual(parsed.totals, { credits: 0, debits: 0, count: 0 });
});

test('não suprime rendimento legítimo apenas porque a descrição começa por saldo', () => {
  const parsed = parseOfx(`<OFX><BANKID>001<ACCTID>anon
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260803<TRNAMT>12.50<FITID>rendimento
<MEMO>SALDO DE RENDIMENTO DE APLICAÇÃO</STMTTRN></OFX>`);

  assert.equal(parsed.transactions.length, 1);
  assert.equal(parsed.transactions[0].amount, 12.5);
});

test('rejeita todo o arquivo antes de agregar duas identidades bancárias distintas', () => {
  const multiAccount = `<OFX>
<STMTRS><BANKACCTFROM><BANKID>341</BANKID><ACCTID>conta-a</ACCTID></BANKACCTFROM>
<BANKTRANLIST><STMTTRN><TRNTYPE>CREDIT</TRNTYPE><DTPOSTED>20260801</DTPOSTED>
<TRNAMT>100</TRNAMT><FITID>a-1</FITID><MEMO>PIX recebido</MEMO></STMTTRN></BANKTRANLIST></STMTRS>
<CCSTMTRS><CCACCTFROM><BANKID>341</BANKID><ACCTID>cartao-b</ACCTID></CCACCTFROM>
<BANKTRANLIST><STMTTRN><TRNTYPE>PAYMENT</TRNTYPE><DTPOSTED>20260802</DTPOSTED>
<TRNAMT>50</TRNAMT><FITID>b-1</FITID><MEMO>Pagamento</MEMO></STMTTRN></BANKTRANLIST></CCSTMTRS>
</OFX>`;

  assert.throws(() => parseOfx(multiAccount), (error: unknown) => {
    assert.ok(error instanceof OfxMultipleAccountsError);
    assert.equal(error.code, 'OFX_MULTIPLE_ACCOUNTS');
    assert.equal(error.statusCode, 422);
    assert.equal(error.multipleAccounts, true);
    assert.deepEqual(error.accountIdentities, [
      { bankId: '341', accountId: 'conta-a', accountType: null, statementType: 'bank' },
      { bankId: '341', accountId: 'cartao-b', accountType: null, statementType: 'credit_card' },
    ]);
    return true;
  });
});

test('aceita blocos repetidos quando todos pertencem à mesma conta', () => {
  const repeatedAccount = `<OFX>
<STMTRS><BANKID>341</BANKID><ACCTID>mesma-conta</ACCTID>
<STMTTRN><TRNTYPE>CREDIT</TRNTYPE><DTPOSTED>20260801</DTPOSTED><TRNAMT>100</TRNAMT>
<FITID>periodo-1</FITID><MEMO>Entrada um</MEMO></STMTTRN></STMTRS>
<STMTRS><BANKID>341</BANKID><ACCTID>mesma-conta</ACCTID>
<STMTTRN><TRNTYPE>CREDIT</TRNTYPE><DTPOSTED>20260802</DTPOSTED><TRNAMT>200</TRNAMT>
<FITID>periodo-2</FITID><MEMO>Entrada dois</MEMO></STMTTRN></STMTRS>
</OFX>`;
  const parsed = parseOfx(repeatedAccount);

  assert.equal(parsed.multipleAccounts, false);
  assert.equal(parsed.accountIdentities.length, 1);
  assert.deepEqual(parsed.transactions.map((transaction) => transaction.fitId), ['periodo-1', 'periodo-2']);
  assert.deepEqual(parsed.totals, { credits: 300, debits: 0, count: 2 });
});

test('não mistura conta corrente e poupança com o mesmo número', () => {
  const mixedTypes = `<OFX>
<STMTRS><BANKID>341</BANKID><ACCTID>mesma-conta</ACCTID><ACCTTYPE>CHECKING</ACCTTYPE>
<STMTTRN><DTPOSTED>20260801</DTPOSTED><TRNAMT>100</TRNAMT><FITID>checking-1</FITID></STMTTRN></STMTRS>
<STMTRS><BANKID>341</BANKID><ACCTID>mesma-conta</ACCTID><ACCTTYPE>SAVINGS</ACCTTYPE>
<STMTTRN><DTPOSTED>20260802</DTPOSTED><TRNAMT>200</TRNAMT><FITID>savings-1</FITID></STMTTRN></STMTRS>
</OFX>`;

  assert.throws(() => parseOfx(mixedTypes), (error: unknown) => {
    assert.ok(error instanceof OfxMultipleAccountsError);
    assert.deepEqual(error.accountIdentities.map((identity) => identity.accountType), ['CHECKING', 'SAVINGS']);
    return true;
  });
});

test('não mistura extrato bancário e cartão ainda que reutilizem o identificador', () => {
  const mixedStatements = `<OFX>
<STMTRS><BANKID>341</BANKID><ACCTID>identificador-1</ACCTID><ACCTTYPE>CHECKING</ACCTTYPE>
<STMTTRN><DTPOSTED>20260801</DTPOSTED><TRNAMT>100</TRNAMT><FITID>bank-1</FITID></STMTTRN></STMTRS>
<CCSTMTRS><BANKID>341</BANKID><ACCTID>identificador-1</ACCTID>
<STMTTRN><DTPOSTED>20260802</DTPOSTED><TRNAMT>-50</TRNAMT><FITID>card-1</FITID></STMTTRN></CCSTMTRS>
</OFX>`;

  assert.throws(() => parseOfx(mixedStatements), OfxMultipleAccountsError);
});

test('rejeita bloco de extrato sem número da conta antes de somar movimentos', () => {
  const missingAccount = `<OFX><STMTRS><BANKID>341</BANKID><ACCTTYPE>CHECKING</ACCTTYPE>
<STMTTRN><DTPOSTED>20260801</DTPOSTED><TRNAMT>100</TRNAMT><FITID>sem-conta</FITID></STMTTRN>
</STMTRS></OFX>`;

  assert.throws(() => parseOfx(missingAccount), (error: unknown) => {
    assert.ok(error instanceof OfxIncompleteAccountIdentityError);
    assert.equal(error.code, 'OFX_INCOMPLETE_ACCOUNT_IDENTITY');
    assert.equal(error.statusCode, 422);
    assert.equal(error.accountIdentities[0].accountId, null);
    return true;
  });
});

test('rejeita extrato bancário com conta mas sem BANKID', () => {
  const missingBank = `<OFX><STMTRS><ACCTID>12345</ACCTID><ACCTTYPE>CHECKING</ACCTTYPE>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260820<TRNAMT>10<FITID>bank-missing</STMTTRN>
</STMTRS></OFX>`;

  assert.throws(() => parseOfx(missingBank), (error: unknown) => {
    assert.ok(error instanceof OfxIncompleteAccountIdentityError);
    assert.equal(error.accountIdentities[0].accountId, '12345');
    assert.equal(error.accountIdentities[0].bankId, null);
    return true;
  });
});

test('rejeita cartão sem BANKID porque a origem bancária fica incompleta', () => {
  const creditCard = `<OFX><CCSTMTRS><ACCTID>411111</ACCTID>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260820<TRNAMT>-10<FITID>cc-ok</STMTTRN>
</CCSTMTRS></OFX>`;

  assert.throws(() => parseOfx(creditCard), OfxIncompleteAccountIdentityError);
});

test('valida datas reais e formatos monetários sem aceitar lixo parcial', () => {
  assert.equal(parseOfxDate('20240229'), '2024-02-29');
  assert.equal(parseOfxDate('20230229'), null);
  assert.equal(parseOfxAmount('1.234,56'), 1234.56);
  assert.equal(parseOfxAmount('-1,25'), -1.25);
  assert.equal(parseOfxAmount('R$ 10,00'), null);
});

test('mantém fingerprints distintos para lançamentos legítimos idênticos sem FITID', () => {
  const content = `<OFX><BANKID>077<ACCTID>anon-3
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260810<TRNAMT>200<NAME>Pessoa Exemplo<MEMO>PIX recebido
</STMTTRN><STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260810<TRNAMT>200<NAME>Pessoa Exemplo<MEMO>PIX recebido
</STMTTRN></OFX>`;
  const first = parseOfx(content);
  const second = parseOfx(content);

  assert.equal(first.transactions.length, 2);
  assert.notEqual(first.transactions[0].fingerprint, first.transactions[1].fingerprint);
  assert.deepEqual(
    first.transactions.map((tx) => tx.fingerprint),
    second.transactions.map((tx) => tx.fingerprint),
  );
  assert.match(first.transactions[0].fitId, /^hash:/);
});

test('FITID torna a identidade estável mesmo se o banco mudar o texto descritivo', () => {
  const base = {
    bankId: '341', accountId: 'anon', fitId: 'id-estavel', date: '2026-08-10',
    signedAmount: 50,
  };
  assert.equal(
    fingerprintOfxTransaction({ ...base, description: 'Texto A' }),
    fingerprintOfxTransaction({ ...base, description: 'Texto B' }),
  );
});

const creditTransaction = {
  id: 'tx-1',
  type: 'credito' as const,
  amount: 750,
  date: '2026-08-12',
  description: 'PIX recebido de Cliente Gama',
  counterpartyName: 'Cliente Gama',
  accountId: 'itau',
};

test('auto-concilia apenas o candidato único forte por valor, data e nome', () => {
  const decision = decideReconciliation(creditTransaction, [
    { id: 'receita-certa', kind: 'receita', amount: 750, date: '2026-08-12', name: 'Cliente Gama' },
    { id: 'receita-distante', kind: 'receita', amount: 640, date: '2026-07-01', name: 'Outra Pessoa' },
  ]);

  assert.equal(decision.status, 'auto');
  assert.equal(decision.suggestionId, 'receita-certa');
  assert.equal(decision.candidates[0].eligibleForAuto, true);
  assert.ok(decision.reasons.includes('nome_compativel'));
});

test('não baixa no Itaú uma receita já marcada para a conta Nubank', () => {
  const decision = decideReconciliation(creditTransaction, [
    {
      id: 'receita-nubank', kind: 'receita', amount: 750, date: '2026-08-12',
      name: 'Cliente Gama', accountId: 'nubank',
    },
  ]);

  assert.equal(decision.status, 'unmatched');
  assert.equal(decision.candidates[0].eligibleForAuto, false);
  assert.equal(decision.candidates[0].score, 0);
  assert.ok(decision.candidates[0].reasons.includes('conta_divergente'));
});

test('valor e data exatos sem nome compatível ficam para revisão', () => {
  const decision = decideReconciliation(
    { ...creditTransaction, description: 'CRÉDITO EM CONTA', counterpartyName: null },
    [{ id: 'receita-1', kind: 'receita', amount: 750, date: '2026-08-12', name: 'Cliente Gama' }],
  );

  assert.equal(decision.status, 'review');
  assert.equal(decision.candidates[0].exactAmount, true);
  assert.equal(decision.candidates[0].eligibleForAuto, false);
});

test('dois candidatos fortes tornam a sugestão ambígua e impedem baixa automática', () => {
  const candidates = ['a', 'b'].map((id) => ({
    id,
    kind: 'receita' as const,
    amount: 750,
    date: '2026-08-12',
    name: 'Cliente Gama',
  }));
  const decision = decideReconciliation(creditTransaction, candidates);

  assert.equal(decision.status, 'review');
  assert.equal(decision.ambiguous, true);
});

test('não pontua receita para débito ou candidato já indisponível', () => {
  const wrongDirection = scoreReconciliationCandidate(
    { ...creditTransaction, type: 'debito' },
    { id: 'r', kind: 'receita', amount: 750, date: '2026-08-12', name: 'Cliente Gama' },
  );
  const unavailable = scoreReconciliationCandidate(
    creditTransaction,
    { id: 'r', kind: 'receita', amount: 750, date: '2026-08-12', name: 'Cliente Gama', available: false },
  );

  assert.equal(wrongDirection.score, 0);
  assert.equal(unavailable.score, 0);
});

test('detecta repasse InfinitePay oposto entre duas contas próprias', () => {
  const result = detectInternalTransfers([
    {
      id: 'saida-infinite', accountId: 'infinite', accountName: 'InfinitePay', type: 'debito',
      amount: 1200, date: '2026-08-14', description: 'Transferência InfinitePay para conta Nubank',
    },
    {
      id: 'entrada-nubank', accountId: 'nubank', accountName: 'Nubank', type: 'credito',
      amount: 1200, date: '2026-08-15', description: 'Crédito recebido InfinitePay',
    },
  ]);

  assert.equal(result.pairs.length, 1);
  assert.equal(result.pairs[0].fromAccountId, 'infinite');
  assert.equal(result.pairs[0].toAccountId, 'nubank');
  assert.equal(result.pairs[0].dateDistanceDays, 1);
});

test('crédito InfinitePay não pareia com débito coincidente de outra conta qualquer', () => {
  const result = detectInternalTransfers([
    {
      id: 'debito-itau', accountId: 'itau', accountName: 'Itaú', type: 'debito',
      amount: 950, date: '2026-08-17', description: 'Pagamento fornecedor externo',
    },
    {
      id: 'credito-nubank', accountId: 'nubank', accountName: 'Nubank', type: 'credito',
      amount: 950, date: '2026-08-18', description: 'Crédito recebido InfinitePay',
    },
  ]);

  assert.deepEqual(result.pairs, []);
  assert.deepEqual(result.ambiguousTransactionIds, ['credito-nubank', 'debito-itau']);
});

test('dois PIX coincidentes sem evidência forte não viram transferência automática', () => {
  const result = detectInternalTransfers([
    { id: 'pix-saida', accountId: 'a', type: 'debito', amount: 300, date: '2026-08-10', description: 'PIX enviado' },
    { id: 'pix-entrada', accountId: 'b', type: 'credito', amount: 300, date: '2026-08-10', description: 'PIX recebido' },
  ]);

  assert.deepEqual(result.pairs, []);
  assert.deepEqual(result.ambiguousTransactionIds, ['pix-entrada', 'pix-saida']);
});

test('palavra transferência sozinha não comprova que duas operações externas são internas', () => {
  const result = detectInternalTransfers([
    { id: 'transf-saida', accountId: 'itau', accountName: 'Itaú', type: 'debito', amount: 800, date: '2026-08-10', description: 'Transferência enviada' },
    { id: 'transf-entrada', accountId: 'nubank', accountName: 'Nubank', type: 'credito', amount: 800, date: '2026-08-11', description: 'Transferência recebida' },
  ]);

  assert.deepEqual(result.pairs, []);
  assert.deepEqual(result.ambiguousTransactionIds, ['transf-entrada', 'transf-saida']);
});

test('múltiplos pares possíveis ficam ambíguos mesmo com palavras de transferência', () => {
  const result = detectInternalTransfers([
    { id: 'd', accountId: 'a', type: 'debito', amount: 500, date: '2026-08-10', description: 'Transferência' },
    { id: 'c1', accountId: 'b', type: 'credito', amount: 500, date: '2026-08-10', description: 'Transferência' },
    { id: 'c2', accountId: 'c', type: 'credito', amount: 500, date: '2026-08-10', description: 'Transferência' },
  ]);

  assert.equal(result.pairs.length, 0);
  assert.deepEqual(result.ambiguousTransactionIds, ['c1', 'c2', 'd']);
});

const processorCredit = {
  id: 'credito-banco-1',
  type: 'credito' as const,
  amount: 950,
  date: '2026-08-18',
  description: 'Crédito recebido INFINITEPAY',
  counterpartyName: 'InfinitePay Instituição de Pagamento',
  accountId: 'nubank',
};

test('reconhece um único recebimento InfinitePay que explica o crédito bancário', () => {
  const decision = decideProcessorSettlement(processorCredit, [
    {
      id: 'link-1', netAmount: 950, expectedDate: '2026-08-17',
      intermediaryAccountId: 'infinitepay',
    },
  ]);

  assert.equal(decision.status, 'auto');
  assert.deepEqual(decision.receiptIds, ['link-1']);
  assert.equal(decision.candidateSets[0].totalAmount, 950);
});

test('permite revisar repasse por meio Link mesmo antes de cadastrar conta intermediadora', () => {
  const decision = decideProcessorSettlement(processorCredit, [
    { id: 'link-sem-conta', netAmount: 950, expectedDate: '2026-08-18', intermediaryAccountId: null },
  ]);

  assert.equal(decision.status, 'auto');
  assert.deepEqual(decision.receiptIds, ['link-sem-conta']);
});

test('reconhece um grupo único de dois recebimentos cuja soma líquida fecha em centavos', () => {
  const decision = decideProcessorSettlement(processorCredit, [
    { id: 'link-a', netAmount: 325.15, expectedDate: '2026-08-16', intermediaryAccountId: 'infinitepay' },
    { id: 'link-b', netAmount: 624.85, expectedDate: '2026-08-18', intermediaryAccountId: 'infinitepay' },
    { id: 'link-fora', netAmount: 50, expectedDate: '2026-08-01', intermediaryAccountId: 'infinitepay' },
  ]);

  assert.equal(decision.status, 'auto');
  assert.deepEqual(decision.receiptIds, ['link-a', 'link-b']);
  assert.equal(decision.consideredCandidateCount, 2);
});

test('dois grupos exatos possíveis deixam o repasse para revisão', () => {
  const decision = decideProcessorSettlement(processorCredit, [
    { id: 'grupo-1a', netAmount: 300, expectedDate: '2026-08-18', intermediaryAccountId: 'infinitepay' },
    { id: 'grupo-1b', netAmount: 650, expectedDate: '2026-08-18', intermediaryAccountId: 'infinitepay' },
    { id: 'grupo-2a', netAmount: 400, expectedDate: '2026-08-18', intermediaryAccountId: 'infinitepay' },
    { id: 'grupo-2b', netAmount: 550, expectedDate: '2026-08-18', intermediaryAccountId: 'infinitepay' },
  ]);

  assert.equal(decision.status, 'review');
  assert.equal(decision.reason, 'multiple_sets');
  assert.equal(decision.candidateSets.length, 2);
  assert.deepEqual(decision.receiptIds, []);
});

test('crédito genérico não é atribuído a recebimentos InfinitePay só por valor e data', () => {
  const decision = decideProcessorSettlement(
    {
      ...processorCredit,
      description: 'Crédito em conta',
      counterpartyName: 'Pessoa Exemplo',
    },
    [{ id: 'link-1', netAmount: 950, expectedDate: '2026-08-18', intermediaryAccountId: 'infinitepay' }],
  );

  assert.equal(decision.status, 'unmatched');
  assert.equal(decision.reason, 'not_processor_credit');
  assert.deepEqual(decision.candidateSets, []);
});

test('projeta pagamentos por origem_ref e calcula um único saldo restante correto', () => {
  const projection = projectJobPaymentsToReceitas(
    {
      userId: 'user-anon', id: 42, amount: 3000, dueDate: '2026-08-01',
      clientId: 'client-anon', clientName: 'Cliente Delta', description: 'Ensaio Delta',
    },
    [
      { id: 'pay-1', amount: 500, paymentDate: '2026-07-10', description: 'Sinal', paymentMethod: 'Pix' },
      { id: 'pay-2', amount: 1000, paymentDate: '2026-07-20', description: 'Parcela', paymentMethod: 'Cartão de Crédito/Link' },
    ],
    [],
    { today: '2026-08-20' },
  );

  assert.equal(projection.totalPaid, 1500);
  assert.equal(projection.remainingBalance, 1500);
  assert.equal(projection.paymentStatus, 'partial');
  assert.deepEqual(projection.rows.map((row) => row.origem_ref), [
    'job_payment:pay-1', 'job_payment:pay-2', 'job_balance:42',
  ]);
  assert.equal(projection.rows[2].status, 'atrasado');
  assert.equal(projection.paymentMethodsByOriginRef['job_payment:pay-2'], 'Link InfinitePay');
});

test('projeção é determinística, remove refs obsoletas e não recria saldo quitado', () => {
  const job = { userId: 'user-anon', id: 7, amount: 1000, dueDate: '2026-08-30' };
  const payments = [{ id: 99, amount: 1000, paymentDate: '2026-08-10', paymentMethod: 'Cartão de Crédito' }];
  const existing = [
    { origem_ref: 'job_payment:antigo', origem_automatica: true },
    { origem_ref: 'job_balance:7', origem_automatica: true },
    { origem_ref: 'manual:preservar', origem_automatica: false },
  ];
  const first = projectJobPaymentsToReceitas(job, payments, existing, { today: '2026-08-20' });
  const second = projectJobPaymentsToReceitas(job, payments, existing, { today: '2026-08-20' });

  assert.deepEqual(first, second);
  assert.equal(first.rows.length, 1);
  assert.equal(first.paymentStatus, 'paid');
  assert.deepEqual(first.staleOriginRefs.sort(), ['job_balance:7', 'job_payment:antigo']);
  assert.equal(first.paymentMethodsByOriginRef['job_payment:99'], 'Link InfinitePay');
});

test('não soma duas vezes pagamentos duplicados e relata valores inválidos', () => {
  const projection = projectJobPaymentsToReceitas(
    { userId: 'user-anon', id: 8, amount: 500 },
    [
      { id: 'p1', amount: 200 },
      { id: 'p1', amount: 200 },
      { id: 'p2', amount: 'invalido' },
    ],
    [],
    { today: '2026-08-20' },
  );

  assert.equal(projection.totalPaid, 200);
  assert.equal(projection.remainingBalance, 300);
  assert.deepEqual(projection.duplicatePaymentIds, ['p1']);
  assert.deepEqual(projection.rejectedPaymentIds, ['p2']);
});

test('não inventa data de caixa quando o pagamento não possui data real', () => {
  const projection = projectJobPaymentsToReceitas(
    { userId: 'user-anon', id: 9, amount: 500, dueDate: '2026-08-30' },
    [{ id: 'sem-data', amount: 200 }],
    [],
    { today: '2026-08-20' },
  );
  const paymentRow = projection.rows.find((row) => row.origem_ref === 'job_payment:sem-data');

  assert.equal(paymentRow?.data_vencimento, '2026-08-30');
  assert.equal(paymentRow?.data_pagamento, null);
  assert.equal(paymentRow?.data_recebimento_real, null);
});

test('normaliza os nomes usados pelo link da InfinitePay sem alterar outros métodos', () => {
  assert.equal(normalizePaymentMethod('Cartão de Crédito/Link'), 'Link InfinitePay');
  assert.equal(normalizePaymentMethod('Link de Pagamento'), 'Link InfinitePay');
  assert.equal(normalizePaymentMethod('cartao de credito'), 'Link InfinitePay');
  assert.equal(normalizePaymentMethod('Cartão Crédito 1x'), 'Link InfinitePay');
  assert.equal(normalizePaymentMethod('Credit Card'), 'Link InfinitePay');
  assert.equal(normalizePaymentMethod('Crédito'), 'Link InfinitePay');
  assert.equal(normalizePaymentMethod('Pix'), 'Pix');
  assert.equal(normalizePaymentMethod(null), null);
});

test('planeja correção Itaú sem duplicar conciliados e separa snapshots legados', () => {
  const incoming = [
    { fitId: 'fit-1', type: 'credito' as const, amount: 100, date: '2026-06-01' },
    { fitId: 'fit-2', type: 'debito' as const, amount: 40, date: '2026-06-02' },
    { fitId: 'fit-novo', type: 'credito' as const, amount: 75, date: '2026-06-03' },
  ];
  const existing = [
    {
      id: 'tx-1', fitId: 'fit-1', accountId: 'nubank', type: 'credito' as const,
      amount: 100, date: '2026-06-01', receiptId: 'receita-1', legacyUnconfirmed: true,
    },
    {
      id: 'tx-2', fitId: 'fit-2', accountId: 'nubank', type: 'debito' as const,
      amount: 40, date: '2026-06-02', legacyUnconfirmed: true,
    },
    {
      id: 'tx-saldo', fitId: 'saldo', accountId: 'nubank', type: 'credito' as const,
      amount: 9999, date: '2026-06-02', description: 'SALDO TOTAL DISPONÍVEL DIA', legacyUnconfirmed: true,
    },
  ];

  const plan = planLegacyAccountCorrection('itau', incoming, existing);
  assert.equal(plan.requiresCorrection, true);
  assert.deepEqual(plan.sourceAccountIds, ['nubank']);
  assert.deepEqual(plan.reassignTransactionIds, ['tx-1', 'tx-2']);
  assert.deepEqual(plan.linkedTransactionIds, ['tx-1']);
  assert.deepEqual(plan.balanceSnapshotIds, ['tx-saldo']);
  assert.deepEqual(plan.missingIncomingFitIds, ['fit-novo']);
  assert.deepEqual(plan.blockedReasons, []);
});

test('bloqueia correção legada quando FITID preserva valor ou data divergente', () => {
  const plan = planLegacyAccountCorrection('itau', [
    { fitId: 'fit-1', type: 'credito', amount: 100, date: '2026-06-01' },
  ], [{
    id: 'tx-1', fitId: 'fit-1', accountId: 'nubank', type: 'credito',
    amount: 101, date: '2026-06-01', legacyUnconfirmed: true,
  }]);

  assert.deepEqual(plan.blockedReasons, ['immutable_collision']);
  assert.deepEqual(plan.reassignTransactionIds, []);
});

test('não promete arquivar snapshot legado que participa de transferência ou alocação', () => {
  const plan = planLegacyAccountCorrection('itau', [
    { fitId: 'fit-1', type: 'credito', amount: 100, date: '2026-06-01' },
  ], [
    {
      id: 'tx-1', fitId: 'fit-1', accountId: 'nubank', type: 'credito',
      amount: 100, date: '2026-06-01', legacyUnconfirmed: true,
    },
    {
      id: 'saldo-transferido', fitId: 'saldo', accountId: 'nubank', type: 'credito',
      amount: 9000, date: '2026-06-02', description: 'SALDO TOTAL DISPONÍVEL DIA',
      legacyUnconfirmed: true, transferPairId: 'par-1', status: 'transferencia',
    },
  ]);

  assert.deepEqual(plan.balanceSnapshotIds, []);
  assert.ok(plan.blockedReasons.includes('linked_balance_snapshot'));
});
