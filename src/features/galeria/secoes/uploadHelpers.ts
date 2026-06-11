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

const MAX_DIMENSION = 3000;
const MAX_BYTES_TO_RESIZE = 3 * 1024 * 1024;

export async function downscaleIfHuge(file: File): Promise<File> {
  if (file.size < MAX_BYTES_TO_RESIZE) return file;
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("imagem inválida"));
      el.src = url;
    });
    if (img.width <= MAX_DIMENSION && img.height <= MAX_DIMENSION) return file;
    const scale = MAX_DIMENSION / Math.max(img.width, img.height);
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

export async function prepareFile(file: File): Promise<File> {
  const step1 = isHeic(file) ? await convertHeic(file) : file;
  return downscaleIfHuge(step1);
}
