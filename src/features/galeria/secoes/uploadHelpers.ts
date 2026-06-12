// Helpers de upload (HEIC → JPEG, downscale, pool) compartilhados entre
// a página da galeria e qualquer outro lugar que precise subir foto.

export async function runPool(limit: number, tasks: (() => Promise<void>)[]) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (next < tasks.length) {
      const task = tasks[next++];
      await task();
    }
  });
  await Promise.all(workers);
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export const isHeic = (f: File) =>
  /heic|heif/i.test(f.type) || /\.heic$|\.heif$/i.test(f.name);

export async function convertHeic(file: File): Promise<File> {
  const heic2any = (await import("heic2any")).default as (
    opts: { blob: Blob; toType?: string; quality?: number },
  ) => Promise<Blob | Blob[]>;
  const out = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.92 });
  const blob = Array.isArray(out) ? out[0] : out;
  const newName = file.name.replace(/\.heic$|\.heif$/i, ".jpg");
  return new File([blob], newName, { type: "image/jpeg" });
}

// Resoluções de upload: lado maior em px. Menor resolução = menos espaço
// no armazenamento da conta (a marca d'água/preview de 1600px independe).
export type UploadResolution = "alta" | "media" | "baixa";

export const RESOLUTIONS: Record<UploadResolution, { label: string; maxDim: number; hint: string }> = {
  alta:  { label: "Alta",  maxDim: 3000, hint: "~1–3 MB por foto · melhor pra ampliações" },
  media: { label: "Média", maxDim: 2200, hint: "~0,5–1,5 MB · ótima pra seleção (recomendada)" },
  baixa: { label: "Baixa", maxDim: 1600, hint: "~0,3–0,8 MB · ocupa o mínimo de espaço" },
};

const RES_STORAGE_KEY = "gp_upload_resolution";

export function getSavedResolution(): UploadResolution {
  try {
    const v = localStorage.getItem(RES_STORAGE_KEY);
    if (v === "alta" || v === "media" || v === "baixa") return v;
  } catch { /* sem localStorage */ }
  return "media";
}

export function saveResolution(r: UploadResolution): void {
  try { localStorage.setItem(RES_STORAGE_KEY, r); } catch { /* idem */ }
}

export async function downscaleIfHuge(file: File, maxDim: number): Promise<File> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("imagem inválida"));
      el.src = url;
    });
    if (img.width <= maxDim && img.height <= maxDim) return file;
    const scale = maxDim / Math.max(img.width, img.height);
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, w, h);
    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.9),
    );
    if (!blob) return file;
    const newName = file.name.replace(/\.[^.]+$/, ".jpg");
    return new File([blob], newName, { type: "image/jpeg" });
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function prepareFile(file: File, resolution: UploadResolution = "media"): Promise<File> {
  const step1 = isHeic(file) ? await convertHeic(file) : file;
  return downscaleIfHuge(step1, RESOLUTIONS[resolution].maxDim);
}
