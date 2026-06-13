// Upload de fotos próprias pro álbum. Reusa os helpers da galeria
// (prepareFile/runPool/chunk/isHeic) e fala com as rotas /api/albums/:id/assets.
import { authFetch } from "../../../utils/authFetch";
import {
  chunk, isHeic, prepareFile, runPool,
} from "../../galeria/secoes/uploadHelpers";

export interface AlbumUploadProgress { done: number; total: number }

interface SignedUpload { asset_id: string; signed_url: string }

// Sobe um arquivo no signed URL e dispara o process do servidor.
async function uploadOne(
  albumId: string,
  upload: SignedUpload,
  file: File,
  errors: string[],
  onTick: () => void,
): Promise<void> {
  try {
    const put = await fetch(upload.signed_url, {
      method: "PUT",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    if (!put.ok) throw new Error("upload");
    const proc = await authFetch(`/api/albums/${albumId}/assets/${upload.asset_id}/process`, {
      method: "POST",
    });
    if (!proc.ok) throw new Error("process");
  } catch {
    errors.push(file.name);
  } finally {
    onTick();
  }
}

// Sobe um lote (assina, sobe em paralelo limitado, processa).
async function uploadBatch(
  albumId: string,
  batch: File[],
  errors: string[],
  onTick: () => void,
): Promise<void> {
  const res = await authFetch(`/api/albums/${albumId}/assets/sign-upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files: batch.map((f) => ({ name: f.name, size: f.size, type: f.type })) }),
  });
  if (!res.ok) {
    batch.forEach((f) => errors.push(f.name));
    batch.forEach(onTick);
    return;
  }
  const { uploads } = (await res.json()) as { uploads: SignedUpload[] };
  await runPool(2, batch.map((file, i) => () => uploadOne(albumId, uploads[i], file, errors, onTick)));
}

// Prepara um lote (HEIC→JPEG + downscale). Erros viram nome no array.
async function prepareBatch(
  rawBatch: File[],
  errors: string[],
  onTick: () => void,
): Promise<File[]> {
  const out: File[] = [];
  for (const file of rawBatch) {
    try {
      out.push(await prepareFile(file, "media"));
    } catch {
      errors.push(file.name);
      onTick();
    }
  }
  return out;
}

// Sobe N arquivos pro álbum. Retorna os nomes que falharam.
export async function uploadAlbumFiles(
  albumId: string,
  fileList: FileList | File[] | null,
  setProgress: (p: AlbumUploadProgress | null) => void,
): Promise<string[]> {
  const raw = Array.from(fileList || []).filter(
    (f) => f.type.startsWith("image/") || isHeic(f),
  );
  if (raw.length === 0) return [];

  const errors: string[] = [];
  let done = 0;
  const total = raw.length;
  setProgress({ done, total });
  const onTick = () => { done += 1; setProgress({ done, total }); };

  for (const rawBatch of chunk(raw, 20)) {
    const batch = await prepareBatch(rawBatch, errors, onTick);
    if (batch.length === 0) continue;
    await uploadBatch(albumId, batch, errors, onTick);
  }
  return errors;
}
