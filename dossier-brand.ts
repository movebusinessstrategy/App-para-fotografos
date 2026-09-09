import { readFile } from 'node:fs/promises';
import { normalizeDossierLogo } from './dossier-pdf.js';

// Marca aprovada para substituir o link de visualização legado do Pitori.
const PITORI_LEGACY_LOGO_ID = '1WzWueHNV_hL3ANvUcr-VzQO-gZgmiVnM';
export function usesPitoriDossierBrand(studioName: string, logoUrl: string): boolean {
  const name = studioName.normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase();
  if (name !== 'estudio pitori') return false;
  try {
    const url = new URL(logoUrl);
    return url.hostname === 'drive.google.com' && url.pathname === `/file/d/${PITORI_LEGACY_LOGO_ID}/view`;
  } catch { return false; }
}

export async function loadDossierLogo(studioName: string, logoUrl: string, download: (url: string) => Promise<Buffer | null>) {
  if (!logoUrl) return null;
  const bytes = usesPitoriDossierBrand(studioName, logoUrl)
    ? await readFile(new URL('./public/branding/pitori-dossier.png', import.meta.url))
    : await download(logoUrl);
  return bytes ? normalizeDossierLogo(bytes) : null;
}
