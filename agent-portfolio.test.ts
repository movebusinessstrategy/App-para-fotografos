import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import {
  MAX_LABEL_LENGTH,
  MAX_PORTFOLIO_LINKS,
  PORTFOLIO_NICHES,
  normalizePortfolioLinks,
  portfolioLinksForNiche,
} from './agent-portfolio.js';

// A validação vive em dois lugares: aqui e no CHECK do Postgres. Quando os dois
// se desencontram, o banco aceita um link que este arquivo recusa e a Lia para
// de responder — foi exatamente o que aconteceu com "cha_revelacao".
function portfolioCheckSql(): string {
  const file = readdirSync('migrations')
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .reverse()
    .find((name) => readFileSync(`migrations/${name}`, 'utf8').includes('ai_agent_portfolio_links_valid(value jsonb)'));
  assert.ok(file, 'nenhuma migration define ai_agent_portfolio_links_valid');
  return readFileSync(`migrations/${file}`, 'utf8');
}

function sqlNiches(sql: string): string[] {
  const block = sql.match(/item_niche <> all \(array\[([\s\S]*?)\]\)/);
  assert.ok(block, 'não achei a lista de nichos na migration');
  return [...block[1].matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
}

function link(niche: string, url = 'https://estudio.example/ensaio') {
  return { label: 'Ensaio em estúdio', url, niche };
}

test('os nichos aceitos aqui são os mesmos que o banco aceita', () => {
  assert.deepEqual([...PORTFOLIO_NICHES].sort(), sqlNiches(portfolioCheckSql()).sort());
});

test('os limites de quantidade e de rótulo acompanham o banco', () => {
  const sql = portfolioCheckSql();
  assert.match(sql, new RegExp(`jsonb_array_length\\(value\\) > ${MAX_PORTFOLIO_LINKS}`));
  assert.match(sql, new RegExp(`char_length\\(item_label\\) not between 1 and ${MAX_LABEL_LENGTH}`));
});

test('link salvo fora do formato descarta só ele, não a lista inteira', () => {
  const saved = [
    link('gestante', 'https://estudio.example/gestante'),
    { label: 'Quebrado', url: 'https://estudio.example/x', niche: 'nicho_que_nao_existe' },
    link('geral', 'https://estudio.example/sobre'),
  ];
  assert.deepEqual(
    portfolioLinksForNiche(saved, 'gestante').map((item) => item.url),
    ['https://estudio.example/gestante', 'https://estudio.example/sobre'],
  );
});

test('gravar uma lista com link inválido continua sendo recusado', () => {
  assert.throws(
    () => normalizePortfolioLinks([link('gestante'), link('nicho_que_nao_existe')]),
    /Link 2: escolha um tipo de ensaio válido/,
  );
});
