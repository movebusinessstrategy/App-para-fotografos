import React from "react";
import { Camera, CreditCard, Heart, ImageOff, Loader2 } from "lucide-react";
import { formatarBRL } from "../utils";

// Telas de estado da galeria pública (carregando / token inválido / em preparação /
// pagamento / sucesso). Todas em tela cheia, mobile-first, fundo claro neutro.

function TelaCentral({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full overflow-y-auto bg-[#F5EFE6] text-neutral-900">
      <div className="min-h-full flex flex-col items-center justify-center px-6 py-12 text-center">
        {children}
      </div>
    </div>
  );
}

function IconeRedondo({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-16 h-16 rounded-full bg-[#6F4E37]/10 text-[#6F4E37] flex items-center justify-center mb-5">
      {children}
    </div>
  );
}

export function TelaCarregando() {
  return (
    <TelaCentral>
      <Loader2 size={32} className="animate-spin text-[#6F4E37]" />
      <p className="mt-4 text-sm text-neutral-500">Carregando galeria…</p>
    </TelaCentral>
  );
}

export function TelaTokenInvalido() {
  return (
    <TelaCentral>
      <IconeRedondo>
        <ImageOff size={28} />
      </IconeRedondo>
      <h1 className="font-serif text-2xl">Galeria não encontrada</h1>
      <p className="mt-2 text-sm text-neutral-500 max-w-xs">
        Este link não existe ou expirou. Confirme com seu fotógrafo o link correto.
      </p>
    </TelaCentral>
  );
}

export function TelaPreparacao({ estudio }: { estudio?: string | null }) {
  return (
    <TelaCentral>
      <IconeRedondo>
        <Camera size={28} />
      </IconeRedondo>
      <h1 className="font-serif text-2xl">Galeria em preparação</h1>
      <p className="mt-2 text-sm text-neutral-500 max-w-xs">
        {estudio ? `${estudio} ainda está` : "Seu fotógrafo ainda está"} preparando suas fotos.
        Volte em breve!
      </p>
    </TelaCentral>
  );
}

export function TelaSucesso({ estudio }: { estudio?: string | null }) {
  return (
    <TelaCentral>
      <IconeRedondo>
        <Heart size={28} className="fill-[#6F4E37]" />
      </IconeRedondo>
      <h1 className="font-serif text-3xl">Seleção enviada!</h1>
      <p className="mt-2 text-sm text-neutral-500 max-w-xs">
        {estudio || "Seu fotógrafo"} já recebeu suas escolhas e vai dar continuidade ao seu
        ensaio. Obrigado!
      </p>
    </TelaCentral>
  );
}

type PropsTelaPagamento = {
  valor: number;
  orderCode?: string | null;
  paymentUrl?: string | null;
};

export function TelaPagamento({ valor, orderCode, paymentUrl }: PropsTelaPagamento) {
  return (
    <TelaCentral>
      <IconeRedondo>
        <CreditCard size={28} />
      </IconeRedondo>
      <h1 className="font-serif text-2xl">Falta só o pagamento</h1>
      <p className="mt-2 text-sm text-neutral-500 max-w-xs">
        Suas fotos extras somam <strong className="text-neutral-800">{formatarBRL(valor)}</strong>.
        {orderCode ? ` Pedido ${orderCode}.` : ""}
      </p>
      {paymentUrl && (
        <a
          href={paymentUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-6 inline-flex items-center gap-2 rounded-full bg-[#6F4E37] px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-[#6F4E37]/30 hover:bg-[#553A29] transition-colors"
        >
          <CreditCard size={16} />
          Pagar com Mercado Pago
        </a>
      )}
      <p className="mt-5 flex items-center gap-2 text-xs text-neutral-400">
        <Loader2 size={13} className="animate-spin" />
        Aguardando confirmação do pagamento…
      </p>
    </TelaCentral>
  );
}
