import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import bundle from './src/data/contract-templates-pitori-2026.json' with { type: 'json' };

const REQUIRED_VARIABLES = [
  '{{cliente_nome}}',
  '{{cliente_cpf}}',
  '{{cliente_endereco}}',
  '{{cliente_telefone}}',
  '{{cliente_email}}',
  '{{servico_data}}',
  '{{servico_hora}}',
  '{{valor_total}}',
  '{{valor_extenso}}',
  '{{ano}}',
];

describe('contratos atualizados do Estúdio Pitori', () => {
  it('contém os 16 modelos enviados, sem duplicidade', () => {
    assert.equal(bundle.templates.length, 16);
    const keys = bundle.templates.map((template) => `${template.category}|${template.name}`);
    assert.equal(new Set(keys).size, keys.length);
  });

  for (const template of bundle.templates) {
    it(`${template.category} / ${template.name} usa somente entrega digital por link`, () => {
      assert.doesNotMatch(template.body, /pendrive|pen drive|\bUSB\b/i);
      assert.match(template.body, /link de acesso à galeria online|entregues? via link|por meio de link/i);
    });

    it(`${template.category} / ${template.name} não contém dados pessoais de cliente`, () => {
      assert.doesNotMatch(template.body, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
      assert.doesNotMatch(template.body, /\b\d{3}\.?\d{3}\.?\d{3}-?\s?\d{2}\b/);
      assert.doesNotMatch(template.body, /\b\d{1,2}\/\d{1,2}\/2026\b/);
    });

    it(`${template.category} / ${template.name} contém todos os campos automáticos`, () => {
      for (const variable of REQUIRED_VARIABLES) {
        assert.ok(template.body.includes(variable), `${template.name} sem ${variable}`);
      }
      assert.ok(template.default_data.source_document_id);
      assert.ok(template.default_data.source_document_url.includes(template.default_data.source_document_id));
    });
  }

  it('mantém endereço do evento separado do endereço residencial', () => {
    const eventCategories = new Set(['ANIVERSÁRIO', 'CHÁ DE BEBÊ', 'BATIZADO']);
    for (const template of bundle.templates.filter((item) => eventCategories.has(item.category))) {
      assert.ok(template.body.includes('{{servico_endereco}}'), `${template.name} sem endereço do evento`);
    }
  });
});
