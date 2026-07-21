// Kanban da Nota Fiscal — mesmo visual do board de Produção (colunas w-72/w-80,
// cards rounded-xl com hover, pills, dark mode). 3 colunas: Fazer nota,
// Faltando dados, Nota emitida. Card clica → drawer lateral (no pai).
import React from "react";
import { Camera, Calendar, CheckCircle2, Download, FileText, Receipt, Trash2 } from "lucide-react";
import { cn } from "../../utils/cn";
import { Elegivel, Invoice, brl, dataBr, baixarArquivo } from "./fiscalShared";

const COL_DOT: Record<string, string> = {
  fazer: "#D4A94A",     // gold-500
  faltando: "#f59e0b",  // amber-500
  emitida: "#10b981",   // emerald-500
};

export function FiscalKanban({ prontos, incompletos, emitidas, onAbrirElegivel, onAbrirNota, onDispensar, onExcluirNota }: {
  prontos: Elegivel[];
  incompletos: Elegivel[];
  emitidas: Invoice[];
  onAbrirElegivel: (i: Elegivel) => void;
  onAbrirNota: (n: Invoice) => void;
  onDispensar: (i: Elegivel) => void;
  onExcluirNota: (n: Invoice) => void;
}) {
  return (
    <div className="flex gap-4 overflow-x-auto pb-4 items-start">
      <Coluna titulo="Fazer nota" dot={COL_DOT.fazer} qtd={prontos.length}
        vazio="Nenhum ensaio esperando nota.">
        {prontos.map((it) => (
          <CardElegivel key={it.job_id} it={it} onAbrir={() => onAbrirElegivel(it)} onDispensar={() => onDispensar(it)} />
        ))}
      </Coluna>

      <Coluna titulo="Faltando dados" dot={COL_DOT.faltando} qtd={incompletos.length}
        vazio="Nenhum cadastro incompleto.">
        {incompletos.map((it) => (
          <CardElegivel key={it.job_id} it={it} onAbrir={() => onAbrirElegivel(it)} onDispensar={() => onDispensar(it)} />
        ))}
      </Coluna>

      <Coluna titulo="Nota emitida" dot={COL_DOT.emitida} qtd={emitidas.length}
        vazio="As notas emitidas aparecem aqui.">
        {emitidas.map((n) => (
          <CardNota key={n.id} n={n} onAbrir={() => onAbrirNota(n)} onExcluir={() => onExcluirNota(n)} />
        ))}
      </Coluna>
    </div>
  );
}

function Coluna({ titulo, dot, qtd, vazio, children }: {
  titulo: string; dot: string; qtd: number; vazio: string; children: React.ReactNode;
}) {
  return (
    <div className="flex w-80 flex-shrink-0 flex-col rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800 max-h-[calc(100vh-230px)]">
      <div className="border-b border-gray-200 dark:border-gray-700 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: dot }} />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate flex-1">{titulo}</h3>
          <span className="rounded-full bg-gray-100 dark:bg-gray-700 px-2 py-0.5 text-xs font-bold text-gray-600 dark:text-gray-300 flex-shrink-0">
            {qtd}
          </span>
        </div>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {qtd === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 dark:border-gray-700 p-4 text-center text-xs text-gray-400">
            {vazio}
          </div>
        ) : children}
      </div>
    </div>
  );
}

function CardElegivel({ it, onAbrir, onDispensar }: { it: Elegivel; onAbrir: () => void; onDispensar: () => void }) {
  return (
    <div className={cn(
      "overflow-hidden rounded-xl border shadow-sm transition-shadow cursor-pointer hover:shadow-md group/card active:opacity-70",
      "border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900",
    )}>
      <div onClick={onAbrir} className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
              {it.client_name || "(sem nome)"}
            </p>
            <p className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
              <Camera size={10} className="flex-shrink-0" /> {it.job_name || "Ensaio"}
            </p>
          </div>
          <span className="text-xs font-bold text-gray-700 dark:text-gray-200 flex-shrink-0">
            {it.valor > 0 ? brl(it.valor) : "—"}
          </span>
        </div>
        <div className="flex items-center justify-between mt-2">
          <p className="flex items-center gap-1 text-[10px] text-gray-400 dark:text-gray-500">
            <Calendar size={10} /> {dataBr(it.job_date)}
          </p>
          <span className="flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 truncate max-w-[130px]">
            {it.stage_name}
          </span>
        </div>
        {it.faltas.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {it.faltas.map((f) => (
              <span key={f} className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400">
                falta {f === "cpf" ? "CPF" : f}
              </span>
            ))}
          </div>
        )}
      </div>
      {/* Ações (aparecem no hover) */}
      <div className="mt-0 px-3 pb-2.5 flex gap-1 opacity-0 group-hover/card:opacity-100 transition-opacity">
        <button onClick={onAbrir}
          className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[11px] font-semibold text-gray-400 hover:bg-gold-50 dark:hover:bg-gold-900/20 hover:text-gold-600 dark:hover:text-gold-400 transition-colors">
          <Receipt size={12} /> Abrir e emitir
        </button>
        <button onClick={(e) => { e.stopPropagation(); onDispensar(); }} title="Tirar da fila (não precisa de nota)"
          className="p-1.5 rounded-lg text-gray-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-500 transition-colors">
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

function CardNota({ n, onAbrir, onExcluir }: { n: Invoice; onAbrir: () => void; onExcluir: () => void }) {
  return (
    <div className={cn(
      "overflow-hidden rounded-xl border shadow-sm transition-shadow cursor-pointer hover:shadow-md group/card active:opacity-70",
      "border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900",
    )}>
      <div onClick={onAbrir} className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{n.tomador_nome || "—"}</p>
            <p className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              <CheckCircle2 size={10} className="text-emerald-500 flex-shrink-0" />
              {n.numero ? `Nota nº ${n.numero}` : "Autorizada"}
            </p>
          </div>
          <span className="text-xs font-bold text-gray-700 dark:text-gray-200 flex-shrink-0">{brl(n.valor)}</span>
        </div>
        <div className="flex items-center justify-between mt-2">
          <p className="flex items-center gap-1 text-[10px] text-gray-400 dark:text-gray-500">
            <Calendar size={10} /> {new Date(n.emitida_em || n.created_at).toLocaleDateString("pt-BR")}
          </p>
          {n.ambiente === "sandbox" && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400">
              teste
            </span>
          )}
        </div>
      </div>
      <div className="px-3 pb-2.5 flex gap-1 opacity-0 group-hover/card:opacity-100 transition-opacity">
        <button onClick={(e) => { e.stopPropagation(); baixarArquivo(`/api/fiscal/nfse/${n.id}/pdf`, `nfse-${n.numero || n.id}.pdf`); }}
          className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[11px] font-semibold text-gray-400 hover:bg-gold-50 dark:hover:bg-gold-900/20 hover:text-gold-600 dark:hover:text-gold-400 transition-colors">
          <Download size={12} /> PDF
        </button>
        <button onClick={(e) => { e.stopPropagation(); baixarArquivo(`/api/fiscal/nfse/${n.id}/xml`, `nfse-${n.numero || n.id}.xml`); }}
          className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[11px] font-semibold text-gray-400 hover:bg-gold-50 dark:hover:bg-gold-900/20 hover:text-gold-600 dark:hover:text-gold-400 transition-colors">
          <FileText size={12} /> XML
        </button>
        <button onClick={(e) => { e.stopPropagation(); onExcluir(); }} title="Excluir registro"
          className="p-1.5 rounded-lg text-gray-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-500 transition-colors">
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}
