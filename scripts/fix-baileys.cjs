/*
 * Aplica, de forma IDEMPOTENTE, os 2 ajustes que o app precisa no Baileys —
 * SEM depender do patch-package. O patch-package falha quando o node_modules
 * está "meio-aplicado" (cache de build do Render): se um hunk já está aplicado
 * e o outro não, ele aborta com erro e NÃO aplica o hunk novo. Foi exatamente
 * isso que deixou o QR quebrado em produção (Platform.WEB nunca virava MACOS).
 *
 * Este script reescreve direto os arquivos (idempotente: se já está aplicado,
 * é no-op), e roda no `postinstall` E no `build`, então funciona mesmo com o
 * node_modules vindo do cache.
 *
 *  1) validate-connection.js: Platform.WEB -> Platform.MACOS
 *     O WhatsApp passou a RECUSAR UserAgent.Platform.WEB no handshake de
 *     registro de dispositivo novo (Baileys issue #2370 / PR #2365). Com WEB,
 *     a conexão cai com 428 ANTES de emitir o QR. Com MACOS, o QR é gerado.
 *
 *  2) messages.js: inclui requiresWaveformProcessing em
 *     requiresOriginalForSomeProcessing — mantém o waveform do áudio PTT.
 */
const fs = require('fs');
const path = require('path');

function libPath(rel) {
  try {
    const base = path.dirname(require.resolve('@whiskeysockets/baileys/package.json'));
    return path.join(base, rel);
  } catch {
    return path.join(process.cwd(), 'node_modules', '@whiskeysockets', 'baileys', rel);
  }
}

function ensure(file, from, to, label) {
  if (!fs.existsSync(file)) {
    console.log(`[fix-baileys] ${label}: arquivo nao encontrado, pulando (${file})`);
    return;
  }
  const src = fs.readFileSync(file, 'utf8');
  if (src.includes(to)) {
    console.log(`[fix-baileys] ${label}: ja aplicado`);
    return;
  }
  if (!src.includes(from)) {
    console.log(`[fix-baileys] ${label}: AVISO trecho-alvo nao encontrado (Baileys mudou?) — revisar`);
    return;
  }
  fs.writeFileSync(file, src.replace(from, to));
  console.log(`[fix-baileys] ${label}: aplicado`);
}

// 1) Platform WEB -> MACOS (o fix do QR)
ensure(
  libPath('lib/Utils/validate-connection.js'),
  'proto.ClientPayload.UserAgent.Platform.WEB,',
  'proto.ClientPayload.UserAgent.Platform.MACOS,',
  'platform-macos'
);

// 2) waveform PTT (requiresOriginalForSomeProcessing inclui o waveform)
ensure(
  libPath('lib/Utils/messages.js'),
  'const requiresOriginalForSomeProcessing = requiresDurationComputation || requiresThumbnailComputation;',
  'const requiresOriginalForSomeProcessing = requiresDurationComputation || requiresThumbnailComputation || requiresWaveformProcessing;',
  'waveform-ptt'
);

console.log('[fix-baileys] concluido');
