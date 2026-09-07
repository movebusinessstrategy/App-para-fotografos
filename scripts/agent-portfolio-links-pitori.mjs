// Cadastra os links de portfólio por nicho na Lia (ai_agent_config.portfolio_links)
// para o Estúdio Pitori. Pré-requisito: migration 071_ai_agent_portfolio_links.sql
// rodada no Supabase. Uso: node scripts/agent-portfolio-links-pitori.mjs [--apply]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(fs.readFileSync(path.join(root, '.env'), 'utf8')
  .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
  .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const url = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
const USER = 'b6608c80-b993-444e-8ba8-ddde5bd18ac0'; // Estúdio Pitori
const SITE = 'https://www.gipitorifotografias.com.br/portfolio/';

// Nichos aceitos pela migration 071 (agent-portfolio.ts PORTFOLIO_NICHES).
// "acompanhamento-do-bebe" fica de fora: não existe nicho "baby" no portfólio da Lia.
const LINKS = [
  { niche: 'geral', label: 'Portfólio completo', url: SITE },
  { niche: 'gestante', label: 'Ensaios de gestante', url: `${SITE}gestante/` },
  { niche: 'newborn', label: 'Ensaios newborn', url: `${SITE}newborn/` },
  { niche: 'familia', label: 'Ensaios de família', url: `${SITE}familia/` },
  { niche: 'smash_the_cake', label: 'Smash the Cake', url: `${SITE}smash-the-cake/` },
  { niche: 'aniversario', label: 'Cobertura de aniversário', url: `${SITE}aniversario/` },
  { niche: 'casal', label: 'Ensaios de casal', url: `${SITE}casal/` },
  { niche: 'feminino', label: 'Ensaios femininos', url: `${SITE}feminino/` },
  { niche: 'marca_pessoal', label: 'Marca pessoal (fotos profissionais)', url: `${SITE}marca-pessoal/` },
  { niche: 'batizado', label: 'Cobertura de batizado', url: `${SITE}batizado/` },
  { niche: 'revelacao', label: 'Chá revelação', url: `${SITE}cha-revelacao/` },
];

const apply = process.argv.includes('--apply');
const check = await fetch(`${url}/rest/v1/ai_agent_config?user_id=eq.${USER}&select=user_id,portfolio_links`, { headers: H });
const body = await check.text();
if (check.status !== 200) {
  console.error('Coluna portfolio_links ainda não existe? Rode a migration 071 no Supabase.\n', body.slice(0, 300));
  process.exit(1);
}
console.log('atual:', JSON.parse(body)[0]?.portfolio_links);
for (const l of LINKS) {
  const r = await fetch(l.url, { method: 'HEAD' });
  console.log(r.status === 200 ? 'ok ' : 'ERR', r.status, l.niche.padEnd(15), l.url);
}
if (!apply) { console.log('\n(dry-run; use --apply)'); process.exit(0); }
const p = await fetch(`${url}/rest/v1/ai_agent_config?user_id=eq.${USER}`, {
  method: 'PATCH', headers: H, body: JSON.stringify({ portfolio_links: LINKS, updated_at: new Date().toISOString() }),
});
console.log('PATCH', p.status, (await p.text()).slice(0, 200));
