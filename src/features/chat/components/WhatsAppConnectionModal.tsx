import React, { useEffect, useState } from 'react';
import { X, MessageCircle, CheckCircle2, Smartphone } from 'lucide-react';
import { authFetch } from '../../../utils/authFetch';
import { ConfirmModal } from '../../../components/ui/ConfirmModal';

// ── Conexões do WhatsApp — DENTRO do chat (engrenagem do header) ────────────
// Um card por número, espelhados: fica claro QUAL número é o do Atendimento e
// qual é o do Pós-venda, cada um com conectar (QR), desconectar e limpar
// sessão ali mesmo. Pedido explícito do usuário: isso mora no CHAT, não em
// Configurações → Integrações (lá ficou só a API oficial da Meta).

// Card do número PRINCIPAL (aba 💬 Atendimento do chat)
function AtendimentoCard() {
  const [status, setStatus] = useState<{ connected: boolean; phone: string | null } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDisc, setConfirmDisc] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const loadStatus = async () => {
    try {
      const r = await authFetch('/api/whatsapp/slots');
      if (!r.ok) return;
      const d = await r.json().catch(() => ({} as any));
      const main = (d.slots || []).find((s: any) => s.slot === 'main');
      if (main) setStatus({ connected: main.status === 'open', phone: main.phone });
    } catch { /* silencioso */ }
  };

  useEffect(() => {
    loadStatus();
    const t = setInterval(loadStatus, 5000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => { if (status?.connected) setQr(null); }, [status?.connected]);

  // fresh=true = "Limpar sessão": apaga as creds no servidor e força QR novo
  const conectar = async (fresh = false) => {
    setBusy(true);
    setQr(null);
    try {
      const r = await authFetch('/api/whatsapp/instance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fresh }),
      });
      const d = await r.json().catch(() => ({} as any));
      const base64 = d.base64 || d.qrcode?.base64 || null;
      if (base64) setQr(base64);
      else if (d.state === 'open' || d.instance?.state === 'open') loadStatus();
      else if (d.error) alert(d.error);
    } finally {
      setBusy(false);
    }
  };

  const desconectar = async () => {
    setConfirmDisc(false);
    setBusy(true);
    try {
      await authFetch('/api/whatsapp/instance', { method: 'DELETE' });
      setQr(null);
      await loadStatus();
    } finally {
      setBusy(false);
    }
  };

  const connected = !!status?.connected;
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/15 flex items-center justify-center">
            <MessageCircle size={20} className="text-emerald-600 dark:text-emerald-400" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white">💬 WhatsApp do Atendimento (principal)</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {connected
                ? <>Conectado{status?.phone ? <> — <strong className="text-gray-700 dark:text-gray-200">+{status.phone}</strong></> : ''} · este número recebe os leads — aba <strong>💬 Atendimento</strong></>
                : <>Número principal do estúdio, conectado por QR Code. As conversas dele aparecem na aba <strong>💬 Atendimento</strong>.</>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {connected ? (
            <>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 text-xs font-semibold">
                <CheckCircle2 size={13} /> Conectado
              </span>
              <button
                onClick={() => setConfirmDisc(true)}
                disabled={busy}
                className="px-3 py-1.5 text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg disabled:opacity-60"
              >
                Desconectar
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => conectar(false)}
                disabled={busy}
                className="px-3.5 py-2 text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg disabled:opacity-60"
              >
                {busy ? 'Gerando QR…' : qr ? 'Gerar novo QR' : 'Conectar (QR Code)'}
              </button>
              <button
                onClick={() => setConfirmReset(true)}
                disabled={busy}
                title="Apaga as credenciais salvas deste número e gera um QR de pareamento novo"
                className="px-2.5 py-2 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg disabled:opacity-60"
              >
                Limpar sessão
              </button>
            </>
          )}
        </div>
      </div>
      {!connected && qr && (
        <div className="mt-4 flex flex-col items-center gap-2">
          <img
            src={qr}
            alt="QR Code do WhatsApp do Atendimento"
            className="w-52 h-52 rounded-xl border border-gray-200 dark:border-gray-700 bg-white p-2"
          />
          <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
            No celular do <strong>atendimento</strong>: WhatsApp → Aparelhos conectados → Conectar aparelho
          </p>
        </div>
      )}
      <ConfirmModal
        open={confirmDisc}
        title="Desconectar o WhatsApp do Atendimento?"
        message="O número principal sai do sistema e você vai precisar escanear o QR de novo pra reconectar. As conversas ficam salvas."
        confirmText="Desconectar"
        variant="warning"
        onConfirm={desconectar}
        onCancel={() => setConfirmDisc(false)}
      />
      <ConfirmModal
        open={confirmReset}
        title="Limpar sessão do Atendimento?"
        message="Apaga as credenciais salvas do número principal e gera um QR de pareamento novo. Use se o QR não estiver aparecendo."
        confirmText="Limpar e gerar QR"
        variant="warning"
        onConfirm={() => { setConfirmReset(false); conectar(true); }}
        onCancel={() => setConfirmReset(false)}
      />
    </div>
  );
}

// Card do 2º número (aba 🤝 Pós-venda do chat)
function PosVendaCard() {
  const [pvStatus, setPvStatus] = useState<{ connected: boolean; state: string; phone: string | null } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const loadStatus = async () => {
    try {
      const r = await authFetch('/api/whatsapp/posvenda/status');
      if (r.ok) setPvStatus(await r.json());
    } catch { /* silencioso */ }
  };

  useEffect(() => {
    loadStatus();
    const t = setInterval(loadStatus, 5000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => { if (pvStatus?.connected) setQr(null); }, [pvStatus?.connected]);

  const conectar = async () => {
    setBusy(true);
    setQr(null);
    try {
      const r = await authFetch('/api/whatsapp/posvenda/qrcode');
      const d = await r.json().catch(() => ({} as any));
      if (d.base64) setQr(d.base64);
      else if (d.state === 'open') loadStatus();
      else alert(d.error || 'Não foi possível gerar o QR. Tente de novo.');
    } finally {
      setBusy(false);
    }
  };

  const desconectar = async () => {
    setBusy(true);
    try {
      await authFetch('/api/whatsapp/posvenda/disconnect', { method: 'POST' });
      setQr(null);
      await loadStatus();
    } finally {
      setBusy(false);
    }
  };

  const resetar = async () => {
    setConfirmReset(false);
    setBusy(true);
    try {
      await authFetch('/api/whatsapp/posvenda/reset', { method: 'POST' });
      setQr(null);
      await loadStatus();
    } finally {
      setBusy(false);
    }
  };

  const connected = !!pvStatus?.connected;
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-teal-500/15 flex items-center justify-center">
            <Smartphone size={20} className="text-teal-600 dark:text-teal-400" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white">🤝 WhatsApp do Pós-venda (2º número)</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {connected
                ? <>Conectado{pvStatus?.phone ? <> — <strong className="text-gray-700 dark:text-gray-200">+{pvStatus.phone}</strong></> : ''} · este número é o do pós-venda — aba <strong>🤝 Pós-venda</strong></>
                : <>2º número da conta, usado pela equipe depois da venda. As conversas dele aparecem só na aba <strong>🤝 Pós-venda</strong> (a Lia não atende por ele).</>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {connected ? (
            <>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 text-xs font-semibold">
                <CheckCircle2 size={13} /> Conectado
              </span>
              <button
                onClick={desconectar}
                disabled={busy}
                className="px-3 py-1.5 text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg disabled:opacity-60"
              >
                Desconectar
              </button>
            </>
          ) : (
            <>
              <button
                onClick={conectar}
                disabled={busy}
                className="px-3.5 py-2 text-sm font-semibold bg-teal-600 hover:bg-teal-700 text-white rounded-lg disabled:opacity-60"
              >
                {busy ? 'Gerando QR…' : qr ? 'Gerar novo QR' : 'Conectar 2º número'}
              </button>
              <button
                onClick={() => setConfirmReset(true)}
                disabled={busy}
                title="Apaga as credenciais salvas deste número"
                className="px-2.5 py-2 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg disabled:opacity-60"
              >
                Limpar sessão
              </button>
            </>
          )}
        </div>
      </div>
      {!connected && qr && (
        <div className="mt-4 flex flex-col items-center gap-2">
          <img
            src={qr}
            alt="QR Code do WhatsApp Pós-venda"
            className="w-52 h-52 rounded-xl border border-gray-200 dark:border-gray-700 bg-white p-2"
          />
          <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
            No celular do <strong>pós-venda</strong>: WhatsApp → Aparelhos conectados → Conectar aparelho
          </p>
        </div>
      )}
      <ConfirmModal
        open={confirmReset}
        title="Limpar sessão do pós-venda?"
        message="Apaga as credenciais salvas deste 2º número. Você vai precisar escanear o QR de novo."
        confirmText="Limpar"
        variant="warning"
        onConfirm={resetar}
        onCancel={() => setConfirmReset(false)}
      />
    </div>
  );
}

export function WhatsAppConnectionModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-gray-50 dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-5 space-y-3"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">Conexões do WhatsApp</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Um número por aba do chat — conecte, desconecte ou troque o QR aqui mesmo.
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700"
            title="Fechar"
          >
            <X size={18} />
          </button>
        </div>
        <AtendimentoCard />
        <PosVendaCard />
      </div>
    </div>
  );
}
