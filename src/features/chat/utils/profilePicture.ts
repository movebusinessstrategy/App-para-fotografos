import { authFetch } from '../../../utils/authFetch';

export const photoCache = new Map<string, string | null>();

type PhotoTask = { phone: string; resolve: (url: string | null) => void };
const photoQueue: PhotoTask[] = [];
let photoQueueRunning = false;

async function runPhotoQueue() {
  if (photoQueueRunning) return;
  photoQueueRunning = true;
  while (photoQueue.length > 0) {
    const task = photoQueue.shift()!;
    try {
      const clean = task.phone.replace(/\D/g, '');
      const r = await authFetch(`/api/inbox/profile-picture/${clean}`);
      const d = r.ok ? await r.json() : null;
      const url = d?.url ?? null;
      photoCache.set(task.phone, url);
      task.resolve(url);
    } catch {
      photoCache.set(task.phone, null);
      task.resolve(null);
    }
    // Throttle para não sobrecarregar o WhatsApp
    if (photoQueue.length > 0) await new Promise(r => setTimeout(r, 400));
  }
  photoQueueRunning = false;
}

export function fetchProfilePicture(phone: string): Promise<string | null> {
  if (photoCache.has(phone)) return Promise.resolve(photoCache.get(phone) ?? null);
  return new Promise((resolve) => {
    photoQueue.push({ phone, resolve });
    runPhotoQueue();
  });
}
