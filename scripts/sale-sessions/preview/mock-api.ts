export async function authFetch(url: string, options: RequestInit = {}) {
  if (url.endsWith('/convert')) {
    const body = JSON.parse(String(options.body));
    document.getElementById('submitted')!.textContent = JSON.stringify(body, null, 2);
    return Response.json({ items_saved: true, jobs: body.sessions.map((s: any, i: number) => ({ id:i+1, job_type:s.job_type, job_date:s.schedule_later ? null : s.job_date, calendar_sync_status:'skipped' })) });
  }
  return Response.json([]);
}
