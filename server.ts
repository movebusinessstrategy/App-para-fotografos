import express from 'express';
import { createServer as createViteServer } from 'vite';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';
import dotenv from 'dotenv';
import Papa from 'papaparse';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database('focalpoint.db');

// Migration to add new columns if they don't exist
const columns = db.prepare("PRAGMA table_info(clients)").all() as any[];
const columnNames = columns.map(c => (c as any).name);
const newColumns = [
  'phone', 'email', 'birth_date', 'cpf', 'cep', 'address', 'neighborhood', 
  'city', 'state', 'age', 'child_name', 'instagram', 'closing_date', 
  'notes', 'first_contact_date', 'last_contact_date', 'lead_source', 'status'
];

newColumns.forEach(col => {
  if (!columnNames.includes(col)) {
    try {
      let type = 'TEXT';
      if (col === 'age') type = 'INTEGER';
      let defaultValue = '';
      if (col === 'status') defaultValue = " DEFAULT 'active'";
      
      db.prepare(`ALTER TABLE clients ADD COLUMN ${col} ${type}${defaultValue}`).run();
    } catch (e) {
      console.error(`Error adding column ${col}:`, e);
    }
  }
});

// Migration to add status to jobs if it doesn't exist
const jobColumns = db.prepare("PRAGMA table_info(jobs)").all() as any[];
const jobColumnNames = jobColumns.map(c => (c as any).name);
if (!jobColumnNames.includes('status')) {
  try {
    db.prepare("ALTER TABLE jobs ADD COLUMN status TEXT DEFAULT 'scheduled'").run();
    console.log('Added status column to jobs table');
  } catch (e) {
    console.error('Error adding status column to jobs:', e);
  }
}
if (!jobColumnNames.includes('job_time')) {
  try {
    db.prepare("ALTER TABLE jobs ADD COLUMN job_time TEXT").run();
    console.log('Added job_time column to jobs table');
  } catch (e) {
    console.error('Error adding job_time column to jobs:', e);
  }
}
if (!jobColumnNames.includes('google_event_id')) {
  try {
    db.prepare("ALTER TABLE jobs ADD COLUMN google_event_id TEXT").run();
    console.log('Added google_event_id column to jobs table');
  } catch (e) {
    console.error('Error adding google_event_id column to jobs:', e);
  }
}
if (!jobColumnNames.includes('job_end_time')) {
  try {
    db.prepare("ALTER TABLE jobs ADD COLUMN job_end_time TEXT").run();
    console.log('Added job_end_time column to jobs table');
  } catch (e) {
    console.error('Error adding job_end_time column to jobs:', e);
  }
}

// Migration to add trigger_job_id to opportunities if it doesn't exist
const oppColumns = db.prepare("PRAGMA table_info(opportunities)").all() as any[];
const oppColumnNames = oppColumns.map(c => (c as any).name);
if (!oppColumnNames.includes('trigger_job_id')) {
  try {
    db.prepare("ALTER TABLE opportunities ADD COLUMN trigger_job_id INTEGER").run();
    console.log('Added trigger_job_id column to opportunities table');
  } catch (e) {
    console.error('Error adding trigger_job_id column:', e);
  }
}

// Initialize Database Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    birth_date TEXT,
    cpf TEXT,
    cep TEXT,
    address TEXT,
    neighborhood TEXT,
    city TEXT,
    state TEXT,
    age INTEGER,
    child_name TEXT,
    instagram TEXT,
    closing_date TEXT,
    notes TEXT,
    first_contact_date TEXT,
    last_contact_date TEXT,
    lead_source TEXT,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER,
    job_type TEXT NOT NULL,
    job_date TEXT,
    job_time TEXT,
    job_end_time TEXT,
    job_name TEXT,
    amount REAL,
    payment_method TEXT,
    payment_status TEXT,
    status TEXT DEFAULT 'scheduled',
    notes TEXT,
    google_event_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id)
  );

  CREATE TABLE IF NOT EXISTS google_auth (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    access_token TEXT,
    refresh_token TEXT,
    expiry_date INTEGER
  );

  CREATE TABLE IF NOT EXISTS funnel_stages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    position INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_name TEXT NOT NULL,
    job_type_interest TEXT,
    contact_date TEXT,
    estimated_value REAL,
    status TEXT,
    notes TEXT,
    stage_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (stage_id) REFERENCES funnel_stages(id)
  );

  CREATE TABLE IF NOT EXISTS opportunity_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trigger_job_type TEXT NOT NULL,
    target_job_type TEXT NOT NULL,
    days_offset INTEGER NOT NULL,
    is_active INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS opportunities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER,
    trigger_job_id INTEGER,
    type TEXT NOT NULL,
    suggested_date TEXT NOT NULL,
    status TEXT DEFAULT 'future',
    notes TEXT,
    estimated_value REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id),
    FOREIGN KEY (trigger_job_id) REFERENCES jobs(id)
  );
`);

// Seed default funnel stages if empty
const stagesCount = db.prepare('SELECT COUNT(*) as count FROM funnel_stages').get() as { count: number };
if (stagesCount.count === 0) {
  const insertStage = db.prepare('INSERT INTO funnel_stages (name, position) VALUES (?, ?)');
  ['Novo Lead', 'Primeiro Contato', 'Atendimento', 'Proposta Enviada', 'Negociação', 'Fechado', 'Perdido'].forEach((name, index) => {
    insertStage.run(name, index);
  });

  // Seed some sample data
  db.prepare("INSERT INTO clients (name, phone, email, lead_source) VALUES ('Maria Silva', '(11) 98888-7777', 'maria@email.com', 'Instagram')").run();
  db.prepare("INSERT INTO clients (name, phone, email, lead_source) VALUES ('João Santos', '(11) 97777-6666', 'joao@email.com', 'WhatsApp')").run();
  
  db.prepare("INSERT INTO jobs (client_id, job_type, job_date, job_name, amount, payment_method, payment_status) VALUES (1, 'Gestante', '2026-03-05', 'Ensaio Maria', 850, 'Pix', 'paid')").run();
  db.prepare("INSERT INTO jobs (client_id, job_type, job_date, job_name, amount, payment_method, payment_status) VALUES (2, 'Newborn', '2026-03-15', 'Ensaio João Jr', 1200, 'Cartão', 'pending')").run();

  db.prepare("INSERT INTO leads (client_name, job_type_interest, contact_date, estimated_value, status, stage_id) VALUES ('Ana Oliveira', 'Aniversário', '2026-03-08', 1500, 'open', 1)").run();
  db.prepare("INSERT INTO leads (client_name, job_type_interest, contact_date, estimated_value, status, stage_id) VALUES ('Pedro Rocha', 'Marca Pessoal', '2026-03-09', 600, 'open', 2)").run();
}

// Seed default opportunity rules if empty
const rulesCount = db.prepare('SELECT COUNT(*) as count FROM opportunity_rules').get() as { count: number };
if (rulesCount.count === 0) {
  const insertRule = db.prepare('INSERT INTO opportunity_rules (trigger_job_type, target_job_type, days_offset) VALUES (?, ?, ?)');
  [
    ['Onboard', 'Gestante', 30],
    ['Gestante', 'Newborn', 30],
    ['Newborn', 'Acompanhamento Trimestral', 60],
    ['Newborn', 'Smash the Cake', 270],
    ['Newborn', 'Aniversário', 270]
  ].forEach(([trigger, target, days]) => {
    const exists = db.prepare('SELECT id FROM opportunity_rules WHERE trigger_job_type = ? AND target_job_type = ?').get(trigger, target);
    if (!exists) {
      insertRule.run(trigger, target, days);
    } else {
      // Update existing rule if it matches trigger/target but has different days
      db.prepare('UPDATE opportunity_rules SET days_offset = ? WHERE trigger_job_type = ? AND target_job_type = ?').run(days, trigger, target);
    }
  });
}

const calculateTier = (jobCount: number, totalInvested: number) => {
  if (jobCount >= 10 || totalInvested >= 15000) return 'Diamond';
  if (jobCount >= 7 || totalInvested >= 5000) return 'Platinum';
  if (jobCount >= 4 || totalInvested >= 1500) return 'Gold';
  if (jobCount >= 2 || totalInvested >= 500) return 'Silver';
  return 'Bronze';
};

const getPriority = (suggestedDate: string) => {
  const today = new Date();
  const target = new Date(suggestedDate);
  const diffTime = target.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays > 15) return 'future';
  if (diffDays >= -15) return 'active';
  return 'urgent';
};

const generateOpportunities = (clientId: number, jobType: string, jobDate: string, jobId?: number) => {
  try {
    const rules = db.prepare('SELECT * FROM opportunity_rules WHERE trigger_job_type = ? AND is_active = 1').all(jobType) as any[];
    
    rules.forEach(rule => {
      const suggestedDate = new Date(jobDate);
      if (isNaN(suggestedDate.getTime())) return;
      
      suggestedDate.setDate(suggestedDate.getDate() + rule.days_offset);
      const dateStr = suggestedDate.toISOString().split('T')[0];

      // Check if client already has a job of the target type after the trigger job date
      const alreadyHasJob = db.prepare('SELECT id FROM jobs WHERE client_id = ? AND job_type = ? AND job_date >= ?')
        .get(clientId, rule.target_job_type, jobDate);
      
      if (alreadyHasJob) return;

      // Check if opportunity already exists for this client and type to avoid duplicates
      // Check by trigger_job_id if available, otherwise by type and suggested_date
      let existing;
      if (jobId) {
        existing = db.prepare('SELECT id FROM opportunities WHERE client_id = ? AND type = ? AND trigger_job_id = ?')
          .get(clientId, rule.target_job_type, jobId);
      } else {
        existing = db.prepare('SELECT id FROM opportunities WHERE client_id = ? AND type = ? AND suggested_date = ?')
          .get(clientId, rule.target_job_type, dateStr);
      }
      
      if (!existing) {
        db.prepare('INSERT INTO opportunities (client_id, trigger_job_id, type, suggested_date, status, notes) VALUES (?, ?, ?, ?, ?, ?)')
          .run(clientId, jobId || null, rule.target_job_type, dateStr, 'future', `Gerada automaticamente a partir do ensaio ${jobType}`);
      }
    });
  } catch (error) {
    console.error('Error generating opportunities:', error);
  }
};

// Migration to ensure both Smash the Cake and Aniversário exist
try {
  // If we previously renamed everything to 'Aniversário', we might need to recreate 'Smash the Cake' rules
  // The seeding logic above with the 'UPDATE' will handle the days_offset, but we need to make sure 
  // the rules actually exist in the DB.
} catch (e) {
  console.error('Error during opportunity type migration:', e);
}

// Function to generate opportunities for all existing jobs (backfill)
const backfillOpportunities = () => {
  const allJobs = db.prepare('SELECT * FROM jobs').all() as any[];
  allJobs.forEach(job => {
    generateOpportunities(job.client_id, job.job_type, job.job_date, job.id);
  });
  
  // Recalculate dates for all linked opportunities to match new rules
  const allOpps = db.prepare('SELECT opportunities.*, jobs.job_date, jobs.job_type FROM opportunities JOIN jobs ON opportunities.trigger_job_id = jobs.id').all() as any[];
  allOpps.forEach(opp => {
    const rule = db.prepare('SELECT days_offset FROM opportunity_rules WHERE trigger_job_type = ? AND target_job_type = ?').get(opp.job_type, opp.type) as any;
    if (rule) {
      const suggestedDate = new Date(opp.job_date);
      suggestedDate.setDate(suggestedDate.getDate() + rule.days_offset);
      const dateStr = suggestedDate.toISOString().split('T')[0];
      if (opp.suggested_date !== dateStr) {
        db.prepare('UPDATE opportunities SET suggested_date = ? WHERE id = ?').run(dateStr, opp.id);
      }
    }
  });
  
  console.log('Backfill and date sync of opportunities completed.');
};

// Call backfill on startup
backfillOpportunities();

if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
  console.warn('WARNING: GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is missing in environment variables.');
}

const cleanCredential = (val: string | undefined) => {
  if (!val) return undefined;
  // Remove common copy-paste prefixes like "Status" and trim whitespace
  return val.replace(/^Status\s*/i, '').trim();
};

const GOOGLE_CLIENT_ID = cleanCredential(process.env.GOOGLE_CLIENT_ID);
const GOOGLE_CLIENT_SECRET = cleanCredential(process.env.GOOGLE_CLIENT_SECRET);

const getRedirectUri = (req: express.Request) => {
  // Use APP_URL from environment as it is the most reliable source in this environment
  if (process.env.APP_URL) {
    return `${process.env.APP_URL.replace(/\/$/, '')}/api/auth/google/callback`;
  }
  
  // Fallback for local development
  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.get('host');
  const baseUrl = `${protocol}://${host}`;
  return `${baseUrl.replace(/\/$/, '')}/api/auth/google/callback`;
};

const getOAuth2Client = (redirectUri?: string) => {
  const clientId = cleanCredential(process.env.GOOGLE_CLIENT_ID);
  const clientSecret = cleanCredential(process.env.GOOGLE_CLIENT_SECRET);
  
  return new google.auth.OAuth2(
    clientId,
    clientSecret,
    redirectUri
  );
};

const getGoogleAuth = () => {
  const auth = db.prepare('SELECT * FROM google_auth WHERE id = 1').get() as any;
  if (!auth || !auth.access_token) return null;
  
  const client = getOAuth2Client();
  client.setCredentials({
    access_token: auth.access_token,
    refresh_token: auth.refresh_token,
    expiry_date: auth.expiry_date
  });
  
  return client;
};

const deleteGoogleCalendarEvent = async (eventId: string) => {
  const auth = getGoogleAuth();
  if (!auth) return;

  const calendar = google.calendar({ version: 'v3', auth });
  try {
    await calendar.events.delete({
      calendarId: 'primary',
      eventId: eventId,
    });
  } catch (error: any) {
    // If event already deleted, ignore
    if (error.code !== 410 && error.code !== 404) {
      console.error('Error deleting Google Calendar event:', error);
    }
  }
};

const pullFromGoogleCalendar = async () => {
  const auth = getGoogleAuth();
  if (!auth) return 0;

  const calendar = google.calendar({ version: 'v3', auth });
  try {
    const now = new Date();
    const timeMin = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days ago
    const timeMax = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString(); // 1 year ahead

    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime',
    });

    const events = response.data.items || [];
    let importedCount = 0;

    for (const event of events) {
      if (!event.id) continue;

      // Check if already exists
      const existingJob = db.prepare('SELECT id FROM jobs WHERE google_event_id = ?').get(event.id);
      if (existingJob) continue;

      const summary = event.summary || 'Sem Título';
      const parts = summary.split(' - ');
      let clientName = parts[0];
      let jobType = parts.length > 1 ? parts[1] : 'Evento Externo';

      // Try to find client by name
      let client = db.prepare('SELECT id FROM clients WHERE name = ?').get(clientName) as any;
      
      const start = event.start?.dateTime || event.start?.date;
      const end = event.end?.dateTime || event.end?.date;
      if (!start) continue;

      const startDate = start.split('T')[0];
      const startTime = start.includes('T') ? start.split('T')[1].substring(0, 5) : null;
      const endTime = (end && end.includes('T')) ? end.split('T')[1].substring(0, 5) : null;

      db.prepare(`
        INSERT INTO jobs (client_id, job_type, job_date, job_time, job_end_time, job_name, google_event_id, status, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        client?.id || null,
        jobType,
        startDate,
        startTime,
        endTime,
        summary,
        event.id,
        'scheduled',
        event.description || ''
      );
      importedCount++;
    }

    return importedCount;
  } catch (error) {
    console.error('Error pulling from Google Calendar:', error);
    return 0;
  }
};

const syncJobToGoogleCalendar = async (jobId: number) => {
  const auth = getGoogleAuth();
  if (!auth) return;

  const job = db.prepare(`
    SELECT jobs.*, clients.name as client_name, clients.email as client_email 
    FROM jobs 
    LEFT JOIN clients ON jobs.client_id = clients.id 
    WHERE jobs.id = ?
  `).get(jobId) as any;

  if (!job || !job.job_date) return;

  // If job is cancelled, delete from calendar if it exists
  if (job.status === 'cancelled' && job.google_event_id) {
    await deleteGoogleCalendarEvent(job.google_event_id);
    db.prepare('UPDATE jobs SET google_event_id = NULL WHERE id = ?').run(jobId);
    return;
  }

  // Don't sync cancelled jobs that don't have an event yet
  if (job.status === 'cancelled') return;

  const calendar = google.calendar({ version: 'v3', auth });
  
  const startDateTime = job.job_time 
    ? `${job.job_date}T${job.job_time}:00` 
    : `${job.job_date}T09:00:00`;
  
  let endDateTime;
  if (job.job_end_time) {
    endDateTime = new Date(`${job.job_date}T${job.job_end_time}:00`).toISOString();
  } else {
    // Default duration 1 hour
    endDateTime = new Date(new Date(startDateTime).getTime() + 60 * 60 * 1000).toISOString();
  }

  const summary = job.client_name 
    ? `${job.client_name} - ${job.job_type}`
    : (job.job_name || job.job_type);

  const event = {
    summary,
    description: job.notes || (job.client_name ? `Ensaio ${job.job_type} para ${job.client_name}` : job.job_type),
    start: {
      dateTime: new Date(startDateTime).toISOString(),
      timeZone: 'America/Sao_Paulo',
    },
    end: {
      dateTime: endDateTime,
      timeZone: 'America/Sao_Paulo',
    },
    attendees: job.client_email ? [{ email: job.client_email }] : [],
  };

  try {
    if (job.google_event_id) {
      try {
        await calendar.events.patch({
          calendarId: 'primary',
          eventId: job.google_event_id,
          requestBody: event,
        });
      } catch (patchError: any) {
        // If the event type cannot be changed or event not found, try to insert a new one
        if (patchError.message?.includes('Event type cannot be changed') || patchError.code === 404) {
          const res = await calendar.events.insert({
            calendarId: 'primary',
            requestBody: event,
          });
          if (res.data.id) {
            db.prepare('UPDATE jobs SET google_event_id = ? WHERE id = ?').run(res.data.id, jobId);
          }
        } else {
          throw patchError;
        }
      }
    } else {
      const res = await calendar.events.insert({
        calendarId: 'primary',
        requestBody: event,
      });
      if (res.data.id) {
        db.prepare('UPDATE jobs SET google_event_id = ? WHERE id = ?').run(res.data.id, jobId);
      }
    }
  } catch (error) {
    console.error('Error syncing to Google Calendar:', error);
  }
};

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  // API Routes
  
  // Google Auth
  app.get('/api/auth/google/config-check', (req, res) => {
    const clientId = cleanCredential(process.env.GOOGLE_CLIENT_ID) || '';
    res.json({
      hasClientId: !!clientId,
      hasClientSecret: !!cleanCredential(process.env.GOOGLE_CLIENT_SECRET),
      clientIdPreview: clientId ? `${clientId.substring(0, 10)}...${clientId.substring(clientId.length - 10)}` : 'none',
      clientIdLength: clientId.length,
      currentRedirectUri: getRedirectUri(req),
      envAppUrl: process.env.APP_URL || 'not set'
    });
  });

  app.get('/api/auth/google/url', (req, res) => {
    const redirectUri = getRedirectUri(req);
    console.log('Generating Auth URL with redirect_uri:', redirectUri);
    
    const client = getOAuth2Client(redirectUri);
    const url = client.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.readonly'],
      prompt: 'consent',
      redirect_uri: redirectUri
    });
    res.json({ url });
  });

  app.get('/api/auth/google/callback', async (req, res) => {
    const { code } = req.query;
    const redirectUri = getRedirectUri(req);
    console.log('Handling callback with redirect_uri:', redirectUri);
    
    try {
      const client = getOAuth2Client(redirectUri);
      const { tokens } = await client.getToken({
        code: code as string,
        redirect_uri: redirectUri
      });
      
      db.prepare('INSERT OR REPLACE INTO google_auth (id, access_token, refresh_token, expiry_date) VALUES (1, ?, ?, ?)')
        .run(tokens.access_token, tokens.refresh_token, tokens.expiry_date);
      
      res.send(`
        <html>
          <body>
            <script>
              window.opener.postMessage({ type: 'GOOGLE_AUTH_SUCCESS' }, '*');
              window.close();
            </script>
            <p>Autenticação concluída com sucesso! Esta janela fechará automaticamente.</p>
          </body>
        </html>
      `);
    } catch (error) {
      console.error('Error exchanging code for tokens:', error);
      res.status(500).send('Erro na autenticação com o Google.');
    }
  });

  app.get('/api/auth/google/status', (req, res) => {
    const auth = db.prepare('SELECT id FROM google_auth WHERE id = 1 AND access_token IS NOT NULL').get();
    res.json({ connected: !!auth });
  });

  app.post('/api/auth/google/disconnect', (req, res) => {
    db.prepare('DELETE FROM google_auth WHERE id = 1').run();
    res.json({ success: true });
  });

  app.post('/api/auth/google/sync-all', async (req, res) => {
    const auth = getGoogleAuth();
    if (!auth) return res.status(401).json({ error: 'Google account not connected' });

    try {
      // 1. Pull from Google
      const importedCount = await pullFromGoogleCalendar();
      
      // 2. Push to Google
      const jobs = db.prepare("SELECT id FROM jobs WHERE status != 'cancelled'").all() as any[];
      for (const job of jobs) {
        await syncJobToGoogleCalendar(job.id);
      }
      res.json({ success: true, pushed: jobs.length, pulled: importedCount });
    } catch (error) {
      console.error('Error syncing all jobs:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Clients
  app.get('/api/clients', (req, res) => {
    const clients = db.prepare('SELECT * FROM clients ORDER BY name ASC').all() as any[];
    const clientsWithStats = clients.map(client => {
      const stats = db.prepare('SELECT COUNT(*) as count, SUM(amount) as total FROM jobs WHERE client_id = ?').get(client.id) as any;
      const jobs = db.prepare('SELECT * FROM jobs WHERE client_id = ? ORDER BY job_date DESC').all(client.id);
      const opportunities = db.prepare(`
        SELECT opportunities.* 
        FROM opportunities 
        LEFT JOIN jobs ON opportunities.trigger_job_id = jobs.id
        WHERE opportunities.client_id = ? 
        AND opportunities.status = 'future' 
        AND (opportunities.trigger_job_id IS NULL OR jobs.status = 'completed' OR jobs.job_date < date('now'))
        AND opportunities.suggested_date <= date('now', '+30 days')
        ORDER BY suggested_date ASC
      `).all(client.id) as any[];
      
      const opportunitiesWithPriority = opportunities
        .map(opp => ({
          ...opp,
          priority: getPriority(opp.suggested_date)
        }));
        // Removed the 60-day future filter to ensure all opportunities are visible

      const jobCount = stats.count || 0;
      const totalInvested = stats.total || 0;
      return {
        ...client,
        jobs,
        opportunities: opportunitiesWithPriority,
        total_invested: totalInvested,
        tier: calculateTier(jobCount, totalInvested)
      };
    });
    res.json(clientsWithStats);
  });

  app.get('/api/clients/export/csv', (req, res) => {
    const clients = db.prepare('SELECT * FROM clients ORDER BY name ASC').all();
    const csv = Papa.unparse(clients);
    res.header('Content-Type', 'text/csv');
    res.attachment('clientes.csv');
    res.send(csv);
  });

app.post('/api/clients/import/csv', (req, res) => {
  const { csvData } = req.body;
  if (!csvData) {
    return res.status(400).json({ error: 'No CSV data provided' });
  }

  try {
    const results = Papa.parse(csvData, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false
    });

    const rows = results.data as any[];
    let importedClientsCount = 0;
    let updatedClientsCount = 0;
    let importedJobsCount = 0;
    let updatedJobsCount = 0;

    const formatDate = (dateStr: string | null | undefined) => {
      if (!dateStr || typeof dateStr !== 'string') return null;
      const clean = dateStr.trim();
      if (!clean) return null;

      const parts = clean.split('/');
      if (parts.length === 3) {
        const day = parts[0].padStart(2, '0');
        const month = parts[1].padStart(2, '0');
        const year = parts[2];
        return `${year}-${month}-${day}`;
      }

      return clean;
    };

    const formatTime = (timeStr: string | null | undefined) => {
      if (!timeStr || typeof timeStr !== 'string') return null;

      const clean = timeStr.trim().toLowerCase();
      if (!clean) return null;

      if (clean.includes('h')) {
        const normalized = clean.replace('h', ':');
        const [h, m] = normalized.split(':');
        return `${String(h || '00').padStart(2, '0')}:${String(m || '00').padStart(2, '0')}`;
      }

      if (clean.includes(':')) {
        const [h, m] = clean.split(':');
        return `${String(h || '00').padStart(2, '0')}:${String(m || '00').padStart(2, '0')}`;
      }

      if (/^\d+$/.test(clean)) {
        return `${clean.padStart(2, '0')}:00`;
      }

      return clean;
    };

    const formatAmount = (amountStr: any) => {
  if (amountStr === null || amountStr === undefined) return 0;

  if (typeof amountStr === 'number') return amountStr;

  if (typeof amountStr === 'string') {
    let clean = amountStr.replace('R$', '').trim();

    if (!clean) return 0;

    // Caso tenha texto junto, tenta extrair todos os números possíveis
    const matches = clean.match(/[\d.,]+/g);

    if (!matches || matches.length === 0) return 0;

    // Pega o maior número encontrado, para casos tipo "1150 ou 1490"
    const parsedNumbers = matches
      .map((value) => {
        let v = value.trim();

        if (v.includes('.') && v.includes(',')) {
          v = v.replace(/\./g, '').replace(',', '.');
        } else if (v.includes(',')) {
          v = v.replace(',', '.');
        } else if (v.includes('.') && v.split('.').pop()?.length === 3) {
          v = v.replace(/\./g, '');
        }

        const num = parseFloat(v);
        return isNaN(num) ? 0 : num;
      })
      .filter((num) => num > 0);

    if (parsedNumbers.length === 0) return 0;

    return Math.max(...parsedNumbers);
  }

  return 0;
};

    const normalizePhone = (phone: any) => {
      if (!phone) return null;
      return String(phone).replace(/\D/g, '') || null;
    };

    const getValFromRow = (row: any, keys: string[]) => {
      for (const wantedKey of keys) {
        const cleanWanted = wantedKey.trim().toLowerCase();
        const foundKey = Object.keys(row).find(
          (k) => k.trim().toLowerCase() === cleanWanted
        );
        if (foundKey) return row[foundKey];
      }
      return null;
    };

    db.transaction(() => {
      for (const row of rows) {
        const name = getValFromRow(row, ['NOME', 'name'])?.toString().trim();
        if (!name) continue;

        const phone = normalizePhone(getValFromRow(row, ['Telefone', 'phone']));
        const email = getValFromRow(row, ['E-MAIL', 'email'])?.toString().trim() || null;
        const birth_date = formatDate(getValFromRow(row, ['NASCIMENTO', 'birth_date'])?.toString());
        const cpf = getValFromRow(row, ['CPF', 'cpf'])?.toString().trim() || null;
        const cep = getValFromRow(row, ['CEP', 'cep'])?.toString().trim() || null;
        const address = getValFromRow(row, ['Endereco', 'address'])?.toString().trim() || null;
        const neighborhood = getValFromRow(row, ['Bairro', 'neighborhood'])?.toString().trim() || null;
        const city = getValFromRow(row, ['Cidade', 'city'])?.toString().trim() || null;
        const state = getValFromRow(row, ['UF', 'state'])?.toString().trim() || null;
        const age = getValFromRow(row, ['IDADE', 'age'])?.toString().trim() || null;
        const child_name = getValFromRow(row, ['Filho(a)', 'child_name'])?.toString().trim() || null;
        const instagram = getValFromRow(row, ['Instagram', 'instagram'])?.toString().trim() || null;
        const closing_date = formatDate(getValFromRow(row, ['Data de Fechamento', 'closing_date'])?.toString());
        const lead_source = getValFromRow(row, ['Como Conheceu', 'lead_source'])?.toString().trim() || null;

        const ensaio = getValFromRow(row, ['ENSAIO', 'job_type'])?.toString().trim() || null;
        const pacote = getValFromRow(row, ['PACOTE', 'notes'])?.toString().trim() || null;
        const dataEnsaio = formatDate(getValFromRow(row, ['DATA DO ENSAIO', 'job_date'])?.toString());
        const horario = formatTime(getValFromRow(row, ['HORÁRIO', 'job_time'])?.toString());
        const valor = formatAmount(getValFromRow(row, [' VALOR ', 'VALOR', 'amount']));
        const pago = getValFromRow(row, [' PAGO ', 'PAGO', 'payment_status'])?.toString().trim() || null;
        const video = getValFromRow(row, ['VIDEO'])?.toString().trim() || null;
        const contratoE = getValFromRow(row, ['CONTRATO E.'])?.toString().trim() || null;
        const contratoA = getValFromRow(row, ['CONTRATO A.'])?.toString().trim() || null;

        let clientId: number;

        const existing =
  db.prepare("SELECT id FROM clients WHERE cpf = ? AND cpf IS NOT NULL AND cpf != ''").get(cpf) as any ||
  db.prepare("SELECT id FROM clients WHERE phone = ? AND phone IS NOT NULL AND phone != ''").get(phone) as any ||
  db.prepare('SELECT id FROM clients WHERE name = ?').get(name) as any;

        if (existing) {
          clientId = existing.id;

          db.prepare(`
            UPDATE clients SET
              name = COALESCE(?, name),
              phone = COALESCE(?, phone),
              email = COALESCE(?, email),
              birth_date = COALESCE(?, birth_date),
              cpf = COALESCE(?, cpf),
              cep = COALESCE(?, cep),
              address = COALESCE(?, address),
              neighborhood = COALESCE(?, neighborhood),
              city = COALESCE(?, city),
              state = COALESCE(?, state),
              age = COALESCE(?, age),
              child_name = COALESCE(?, child_name),
              instagram = COALESCE(?, instagram),
              closing_date = COALESCE(?, closing_date),
              lead_source = COALESCE(?, lead_source)
            WHERE id = ?
          `).run(
            name || null,
            phone || null,
            email || null,
            birth_date || null,
            cpf || null,
            cep || null,
            address || null,
            neighborhood || null,
            city || null,
            state || null,
            age || null,
            child_name || null,
            instagram || null,
            closing_date || null,
            lead_source || null,
            clientId
          );

          updatedClientsCount++;
        } else {
          const info = db.prepare(`
            INSERT INTO clients (
              name, phone, email, birth_date, cpf, cep, address, neighborhood, city, state, age, child_name, instagram, closing_date, lead_source, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
          `).run(
            name,
            phone || null,
            email || null,
            birth_date || null,
            cpf || null,
            cep || null,
            address || null,
            neighborhood || null,
            city || null,
            state || null,
            age || null,
            child_name || null,
            instagram || null,
            closing_date || null,
            lead_source || null
          );

          clientId = info.lastInsertRowid as number;
          importedClientsCount++;
        }

        if (ensaio || dataEnsaio || valor > 0) {
          const today = new Date().toISOString().split('T')[0];
          const jobStatus = dataEnsaio && dataEnsaio < today ? 'completed' : 'scheduled';

          const jobNotes = [
            pacote ? `Pacote: ${pacote}` : '',
            video ? `Vídeo: ${video}` : '',
            contratoE ? `Contrato E.: ${contratoE}` : '',
            contratoA ? `Contrato A.: ${contratoA}` : ''
          ].filter(Boolean).join(' | ');

          const jobName = pacote
            ? `${ensaio || 'Ensaio'} - ${pacote}`
            : (ensaio || 'Ensaio');

          const existingJob = db.prepare(`
            SELECT id FROM jobs
            WHERE client_id = ?
              AND COALESCE(job_type, '') = COALESCE(?, '')
              AND COALESCE(job_date, '') = COALESCE(?, '')
              AND COALESCE(job_time, '') = COALESCE(?, '')
          `).get(
            clientId,
            ensaio || null,
            dataEnsaio || null,
            horario || null
          ) as any;

          if (existingJob) {
            db.prepare(`
              UPDATE jobs SET
                job_name = COALESCE(?, job_name),
                job_type = COALESCE(?, job_type),
                job_date = COALESCE(?, job_date),
                job_time = COALESCE(?, job_time),
                amount = ?,
                payment_status = ?,
                notes = COALESCE(?, notes),
                status = ?
              WHERE id = ?
            `).run(
              jobName || null,
              ensaio || 'Outros',
              dataEnsaio || null,
              horario || null,
              valor || 0,
              pago ? (pago.toLowerCase().includes('sim') ? 'paid' : 'pending') : 'pending',
              jobNotes || null,
              jobStatus,
              existingJob.id
            );

            updatedJobsCount++;
          } else {
            db.prepare(`
              INSERT INTO jobs (
                client_id, job_name, job_type, job_date, job_time, amount, payment_status, notes, status
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              clientId,
              jobName || null,
              ensaio || 'Outros',
              dataEnsaio || null,
              horario || null,
              valor || 0,
              pago ? (pago.toLowerCase().includes('sim') ? 'paid' : 'pending') : 'pending',
              jobNotes || null,
              jobStatus
            );

            importedJobsCount++;
          }
        }
      }
    })();

    res.json({
      success: true,
      importedClientsCount,
      updatedClientsCount,
      importedJobsCount,
      updatedJobsCount
    });
  } catch (error) {
    console.error('Error importing CSV:', error);
    res.status(500).json({ error: 'Failed to parse or import CSV data' });
  }
});

  app.post('/api/clients', (req, res) => {
    const { 
      name, phone, email, birth_date, cpf, cep, address, neighborhood, city, state, age, child_name, instagram, closing_date,
      notes, first_contact_date, last_contact_date, lead_source, status 
    } = req.body;
    const info = db.prepare(`
      INSERT INTO clients (
        name, phone, email, birth_date, cpf, cep, address, neighborhood, city, state, age, child_name, instagram, closing_date,
        notes, first_contact_date, last_contact_date, lead_source, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      name, phone, email, birth_date, cpf, cep, address, neighborhood, city, state, age, child_name, instagram, closing_date,
      notes, first_contact_date, last_contact_date, lead_source, status || 'active'
    );
    res.json({ id: info.lastInsertRowid });
  });

  app.get('/api/clients/:id', (req, res) => {
    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id) as any;
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }
    const jobs = db.prepare('SELECT * FROM jobs WHERE client_id = ? ORDER BY job_date DESC').all(req.params.id);
    const opportunities = db.prepare(`
      SELECT opportunities.* 
      FROM opportunities 
      LEFT JOIN jobs ON opportunities.trigger_job_id = jobs.id
      WHERE opportunities.client_id = ? 
      AND (opportunities.trigger_job_id IS NULL OR jobs.status = 'completed' OR jobs.job_date < date('now'))
      AND (opportunities.status != 'future' OR opportunities.suggested_date <= date('now', '+30 days'))
      ORDER BY suggested_date ASC
    `).all(req.params.id) as any[];
    
    const opportunitiesWithPriority = opportunities.map(opp => ({
      ...opp,
      priority: getPriority(opp.suggested_date)
    }));

    const stats = db.prepare('SELECT COUNT(*) as count, SUM(amount) as total FROM jobs WHERE client_id = ?').get(req.params.id) as any;
    const jobCount = stats.count || 0;
    const totalInvested = stats.total || 0;
    
    res.json({ 
      ...client, 
      jobs,
      opportunities: opportunitiesWithPriority,
      total_invested: totalInvested,
      tier: calculateTier(jobCount, totalInvested)
    });
  });

  app.put('/api/clients/:id', (req, res) => {
    const { 
      name, phone, email, birth_date, cpf, cep, address, neighborhood, city, state, age, child_name, instagram, closing_date,
      notes, first_contact_date, last_contact_date, lead_source, status 
    } = req.body;
    db.prepare(`
      UPDATE clients SET 
        name = ?, phone = ?, email = ?, birth_date = ?, cpf = ?, cep = ?, address = ?, neighborhood = ?, city = ?, state = ?, 
        age = ?, child_name = ?, instagram = ?, closing_date = ?, notes = ?, first_contact_date = ?, last_contact_date = ?, 
        lead_source = ?, status = ? 
      WHERE id = ?
    `).run(
      name, phone, email, birth_date, cpf, cep, address, neighborhood, city, state, age, child_name, instagram, closing_date,
      notes, first_contact_date, last_contact_date, lead_source, status, req.params.id
    );
    res.json({ success: true });
  });

  app.delete('/api/clients/:id', (req, res) => {
    db.prepare('DELETE FROM jobs WHERE client_id = ?').run(req.params.id);
    db.prepare('DELETE FROM clients WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  });

  // Jobs
  app.get('/api/jobs', async (req, res) => {
    // Automatically pull from Google Calendar when jobs are requested
    // We don't await it to keep the response fast, but it will sync in the background
    pullFromGoogleCalendar().catch(err => console.error('Background sync error:', err));

    const jobs = db.prepare(`
      SELECT jobs.*, clients.name as client_name 
      FROM jobs 
      LEFT JOIN clients ON jobs.client_id = clients.id 
      ORDER BY job_date DESC
    `).all();
    res.json(jobs);
  });

  app.post('/api/jobs', (req, res) => {
    const { client_id, job_type, job_date, job_time, job_end_time, job_name, amount, payment_method, payment_status, status, notes } = req.body;
    const info = db.prepare('INSERT INTO jobs (client_id, job_type, job_date, job_time, job_end_time, job_name, amount, payment_method, payment_status, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(client_id || null, job_type, job_date, job_time, job_end_time, job_name, amount, payment_method, payment_status, status || 'scheduled', notes);
    
    const jobId = Number(info.lastInsertRowid);
    // Generate opportunities based on the new job
    if (client_id) {
      generateOpportunities(client_id, job_type, job_date, jobId);
    }
    
    // Sync to Google Calendar
    syncJobToGoogleCalendar(jobId);
    
    res.json({ id: jobId });
  });

  app.put('/api/jobs/:id', (req, res) => {
    const { client_id, job_type, job_date, job_time, job_end_time, job_name, amount, payment_method, payment_status, status, notes } = req.body;
    const oldJob = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id) as any;
    
    if (!oldJob) return res.status(404).json({ error: 'Job not found' });

    db.prepare('UPDATE jobs SET client_id = ?, job_type = ?, job_date = ?, job_time = ?, job_end_time = ?, job_name = ?, amount = ?, payment_method = ?, payment_status = ?, status = ?, notes = ? WHERE id = ?')
      .run(client_id || null, job_type, job_date, job_time, job_end_time, job_name, amount, payment_method, payment_status, status || oldJob.status, notes, req.params.id);
    
    const jobId = Number(req.params.id);
    // Update linked opportunities suggested dates
    if (client_id) {
      const linkedOpportunities = db.prepare('SELECT * FROM opportunities WHERE trigger_job_id = ?').all(jobId) as any[];
      
      linkedOpportunities.forEach(opp => {
        // Use the current job_type (which might have just been updated)
        const rule = db.prepare('SELECT * FROM opportunity_rules WHERE trigger_job_type = ? AND target_job_type = ?').get(job_type, opp.type) as any;
        if (rule) {
          const suggestedDate = new Date(job_date);
          if (!isNaN(suggestedDate.getTime())) {
            suggestedDate.setDate(suggestedDate.getDate() + rule.days_offset);
            const dateStr = suggestedDate.toISOString().split('T')[0];
            db.prepare('UPDATE opportunities SET suggested_date = ? WHERE id = ?').run(dateStr, opp.id);
          }
        }
      });

      // If type or date changed, generate new ones that might be missing
      if (oldJob.job_type !== job_type || oldJob.job_date !== job_date) {
        generateOpportunities(client_id || oldJob.client_id, job_type, job_date, jobId);
      }
    }

    // Sync to Google Calendar
    syncJobToGoogleCalendar(jobId);

    res.json({ success: true });
  });

  app.delete('/api/jobs/:id', async (req, res) => {
    try {
      const job = db.prepare('SELECT google_event_id FROM jobs WHERE id = ?').get(req.params.id) as any;
      if (job && job.google_event_id) {
        await deleteGoogleCalendarEvent(job.google_event_id);
      }
      
      // Delete linked opportunities first
      db.prepare('DELETE FROM opportunities WHERE trigger_job_id = ?').run(req.params.id);
      db.prepare('DELETE FROM jobs WHERE id = ?').run(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting job:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Funnel & Leads
  app.get('/api/funnel', (req, res) => {
    const stages = db.prepare('SELECT * FROM funnel_stages ORDER BY position ASC').all();
    const leads = db.prepare('SELECT * FROM leads').all();
    res.json({ stages, leads });
  });

  app.post('/api/leads', (req, res) => {
    const { client_name, job_type_interest, contact_date, estimated_value, status, notes, stage_id } = req.body;
    const info = db.prepare('INSERT INTO leads (client_name, job_type_interest, contact_date, estimated_value, status, notes, stage_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(client_name, job_type_interest, contact_date, estimated_value, status, notes, stage_id);
    res.json({ id: info.lastInsertRowid });
  });

  app.put('/api/leads/:id', (req, res) => {
    const { stage_id, status } = req.body;
    if (stage_id !== undefined) {
      db.prepare('UPDATE leads SET stage_id = ? WHERE id = ?').run(stage_id, req.params.id);
    }
    if (status !== undefined) {
      db.prepare('UPDATE leads SET status = ? WHERE id = ?').run(status, req.params.id);
    }
    res.json({ success: true });
  });

  app.delete('/api/leads/:id', (req, res) => {
    db.prepare('DELETE FROM leads WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  });

  // Opportunities
  app.get('/api/opportunities', (req, res) => {
    const opportunities = db.prepare(`
      SELECT opportunities.*, clients.name as client_name 
      FROM opportunities 
      JOIN clients ON opportunities.client_id = clients.id 
      LEFT JOIN jobs ON opportunities.trigger_job_id = jobs.id
      WHERE opportunities.status NOT IN ('converted', 'dismissed')
      AND (opportunities.trigger_job_id IS NULL OR jobs.status = 'completed' OR jobs.job_date < date('now'))
      AND opportunities.suggested_date <= date('now', '+30 days')
      ORDER BY suggested_date ASC
    `).all() as any[];
    
    const opportunitiesWithPriority = opportunities
      .map(opp => ({
        ...opp,
        priority: getPriority(opp.suggested_date)
      }));
      // Removed the 60-day future filter to ensure all opportunities (including delayed ones) are visible
    
    res.json(opportunitiesWithPriority);
  });

  app.put('/api/opportunities/:id', (req, res) => {
    const { status, notes, estimated_value } = req.body;
    const updates = [];
    const params = [];
    
    if (status !== undefined) { updates.push('status = ?'); params.push(status); }
    if (notes !== undefined) { updates.push('notes = ?'); params.push(notes); }
    if (estimated_value !== undefined) { updates.push('estimated_value = ?'); params.push(estimated_value); }
    
    if (updates.length > 0) {
      params.push(req.params.id);
      db.prepare(`UPDATE opportunities SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    }
    res.json({ success: true });
  });

  // Opportunity Rules
  app.get('/api/opportunity-rules', (req, res) => {
    const rules = db.prepare('SELECT * FROM opportunity_rules').all();
    res.json(rules);
  });

  app.put('/api/opportunity-rules/:id', (req, res) => {
    const { trigger_job_type, target_job_type, days_offset, is_active } = req.body;
    db.prepare(`
      UPDATE opportunity_rules 
      SET trigger_job_type = ?, target_job_type = ?, days_offset = ?, is_active = ? 
      WHERE id = ?
    `).run(trigger_job_type, target_job_type, days_offset, is_active, req.params.id);
    res.json({ success: true });
  });

  app.post('/api/opportunity-rules', (req, res) => {
    const { trigger_job_type, target_job_type, days_offset } = req.body;
    const info = db.prepare('INSERT INTO opportunity_rules (trigger_job_type, target_job_type, days_offset) VALUES (?, ?, ?)')
      .run(trigger_job_type, target_job_type, days_offset);
    res.json({ id: info.lastInsertRowid });
  });

  app.delete('/api/opportunity-rules/:id', (req, res) => {
    db.prepare('DELETE FROM opportunity_rules WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  });

  // Dashboard Stats
  app.get('/api/stats', (req, res) => {
  const totalClientsBase = db.prepare('SELECT COUNT(*) as count FROM clients').get() as any;

  const totalClientsMonth = db.prepare(`
    SELECT COUNT(*) as count 
    FROM clients 
    WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')
  `).get() as any;

  const totalJobsMonth = db.prepare(`
    SELECT COUNT(*) as count 
    FROM jobs 
    WHERE job_date IS NOT NULL
      AND job_date != ''
      AND strftime('%Y-%m', job_date) = strftime('%Y-%m', 'now')
  `).get() as any;

  const activeLeads = db.prepare(`
    SELECT COUNT(*) as count 
    FROM leads 
    WHERE status != 'closed' AND status != 'lost'
  `).get() as any;

  const revenueByType = db.prepare(`
    SELECT job_type, SUM(amount) as total 
    FROM jobs 
    GROUP BY job_type
  `).all();

  const dailyRevenue = db.prepare(`
    SELECT job_date as date, SUM(amount) as total
    FROM jobs
    WHERE job_date IS NOT NULL
      AND job_date != ''
      AND amount IS NOT NULL
    GROUP BY job_date
    ORDER BY job_date ASC
  `).all();

  res.json({
    totalClientsBase: totalClientsBase.count || 0,
    totalClientsMonth: totalClientsMonth.count || 0,
    totalJobsMonth: totalJobsMonth.count || 0,
    activeLeads: activeLeads.count || 0,
    revenueByType,
    dailyRevenue
  });
});

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
