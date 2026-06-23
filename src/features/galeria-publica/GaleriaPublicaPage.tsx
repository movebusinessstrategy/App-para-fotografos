import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { ErroApiPublica, lerSessao, limparSessao, publicGet, publicPost } from "./api";
import { BarraInferior } from "./components/BarraInferior";
import { CabecalhoGaleria } from "./components/CabecalhoGaleria";
import { GradeFotos } from "./components/GradeFotos";
import { Lightbox } from "./components/Lightbox";
import { ModalFinalizar } from "./components/ModalFinalizar";
import { ResumoFinalizado } from "./components/ResumoFinalizado";
import { TelaLogin } from "./components/TelaLogin";
import {
  TelaCarregando,
  TelaPagamento,
  TelaPreparacao,
  TelaSucesso,
  TelaTokenInvalido,
} from "./components/Telas";
import { useStatusPagamento } from "./hooks/useStatusPagamento";
import type {
  FotoPublica,
  GaleriaPublica,
  MapaSelecoes,
  RespostaFinalize,
  RespostaGaleriaPublica,
  TotaisSelecao,
} from "./types";
import { calcularTotais, lerProtecao, totaisDoServidor } from "./utils";

export type CupomStatus = "idle" | "loading" | "ok" | "invalid";

type Fase = "galeria" | "pagamento" | "sucesso";

type DadosPagamento = {
  url: string | null;
  orderCode: string | null;
  valor: number;
};

// Página pública da galeria de proofing — a cliente final abre /g/:token no
// celular, escolhe as fotos com coração, comenta e finaliza (com Mercado Pago
// se passar do pacote). Sem auth: tudo via share_token nas rotas públicas.
export default function GaleriaPublicaPage() {
  const { token } = useParams<{ token: string }>();

  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(false);
  const [galeria, setGaleria] = useState<GaleriaPublica | null>(null);
  const [fotos, setFotos] = useState<FotoPublica[]>([]);
  const [selecoes, setSelecoes] = useState<MapaSelecoes>({});
  const [loginInfo, setLoginInfo] = useState<{ title: string; studio_name: string } | null>(null);
  const [tentativaLogin, setTentativaLogin] = useState(0);

  const [fase, setFase] = useState<Fase>("galeria");
  const [pagamento, setPagamento] = useState<DadosPagamento | null>(null);
  const [modalAberto, setModalAberto] = useState(false);
  const [finalizando, setFinalizando] = useState(false);
  const [erroFinalizar, setErroFinalizar] = useState<string | null>(null);

  // Cupom (modo discount_mode === 'coupon'): validação é server-side via /totals.
  const [cupom, setCupom] = useState("");
  const [cupomStatus, setCupomStatus] = useState<CupomStatus>("idle");
  const [totaisServidor, setTotaisServidor] = useState<TotaisSelecao | null>(null);

  useEffect(() => {
    if (!token) {
      setErro(true);
      setCarregando(false);
      return;
    }
    let ativo = true;
    setCarregando(true);
    setLoginInfo(null);
    publicGet<RespostaGaleriaPublica>(`/api/public/gallery/${token}`, token)
      .then((dados) => {
        if (!ativo) return;
        setGaleria(dados.gallery);
        setFotos(dados.photos || []);
        setSelecoes(dados.selections || {});
      })
      .catch(async (e) => {
        if (!ativo) return;
        // 401 = require_login + sem session válida → busca info e mostra tela de login.
        if (e instanceof ErroApiPublica && e.status === 401) {
          limparSessao(token);
          try {
            const info = await publicGet<{ title: string; studio_name: string }>(
              `/api/public/gallery/${token}/login-info`,
            );
            if (ativo) setLoginInfo(info);
          } catch {
            if (ativo) setErro(true);
          }
        } else {
          setErro(true);
        }
      })
      .finally(() => ativo && setCarregando(false));
    return () => {
      ativo = false;
    };
  }, [token, tentativaLogin]);

  useEffect(() => {
    if (!galeria) return;
    document.title = galeria.studio_name
      ? `${galeria.title} · ${galeria.studio_name}`
      : galeria.title;
  }, [galeria]);

  const totais = useMemo(
    () => calcularTotais(selecoes, galeria?.included_count ?? 0, galeria?.extra_price ?? 0, galeria ?? undefined),
    [selecoes, galeria]
  );

  // Modo cupom: o desconto vem do servidor (não dá pra validar código no cliente).
  const mostrarCupom = galeria?.discount_mode === "coupon" || !!galeria?.has_coupons;
  const usarServidor = mostrarCupom && cupomStatus === "ok" && !!totaisServidor;
  const totaisModal = usarServidor ? (totaisServidor as TotaisSelecao) : totais;

  const aplicarCupom = async () => {
    const code = cupom.trim();
    if (!code) { setCupomStatus("idle"); setTotaisServidor(null); return; }
    setCupomStatus("loading");
    try {
      const resp = await publicPost<any>(`/api/public/gallery/${token}/totals`, { coupon: code }, token);
      const t = totaisDoServidor(resp, galeria?.included_count ?? 0);
      if (t.cupomAplicado) { setTotaisServidor(t); setCupomStatus("ok"); }
      else { setTotaisServidor(null); setCupomStatus("invalid"); }
    } catch {
      setTotaisServidor(null);
      setCupomStatus("invalid");
    }
  };

  const abrirModal = () => {
    // Cupom vale por sessão do modal — zera ao abrir (a seleção pode ter mudado).
    setCupom("");
    setCupomStatus("idle");
    setTotaisServidor(null);
    setModalAberto(true);
  };

  const aplicarSelecao = (fotoId: string, selected: boolean, comment: string | null) =>
    setSelecoes((prev) => ({ ...prev, [fotoId]: { selected, comment } }));

  // Coração: atualização otimista com rollback se o POST falhar.
  const alternarSelecao = (fotoId: string) => {
    const atual = selecoes[fotoId];
    const novo = !atual?.selected;
    const comentario = atual?.comment ?? null;
    aplicarSelecao(fotoId, novo, comentario);
    publicPost(`/api/public/gallery/${token}/select`, {
      photo_id: fotoId,
      selected: novo,
      comment: comentario ?? undefined,
    }, token).catch(() => aplicarSelecao(fotoId, !novo, comentario));
  };

  // Comentário do lightbox (já chega debounced de lá).
  const salvarComentario = (fotoId: string, texto: string) => {
    const atual = selecoes[fotoId];
    if ((atual?.comment ?? "") === texto) return;
    const selected = Boolean(atual?.selected);
    aplicarSelecao(fotoId, selected, texto);
    publicPost(`/api/public/gallery/${token}/select`, {
      photo_id: fotoId,
      selected,
      comment: texto,
    }, token).catch(() => aplicarSelecao(fotoId, selected, atual?.comment ?? null));
  };

  const confirmarFinalizacao = async () => {
    setFinalizando(true);
    setErroFinalizar(null);
    try {
      const resp = await publicPost<RespostaFinalize>(
        `/api/public/gallery/${token}/finalize`,
        cupomStatus === "ok" && cupom.trim() ? { coupon: cupom.trim() } : undefined,
        token,
      );
      setModalAberto(false);
      if (resp.payment_url && resp.finalized === false) {
        // Pagamento pendente: a seleção SÓ fecha quando o MP confirmar.
        setPagamento({
          url: resp.payment_url,
          orderCode: resp.order_code ?? null,
          valor: resp.amount,
        });
        setFase("pagamento");
      } else {
        setGaleria((g) => (g ? { ...g, status: "selected" } : g));
        setFase("sucesso");
      }
    } catch {
      setErroFinalizar("Não foi possível finalizar agora. Tente novamente.");
    } finally {
      setFinalizando(false);
    }
  };

  if (carregando) return <TelaCarregando />;
  if (loginInfo && token) {
    return (
      <TelaLogin
        shareToken={token}
        info={loginInfo}
        onSucesso={() => { setLoginInfo(null); setTentativaLogin((n) => n + 1); }}
      />
    );
  }
  if (erro || !galeria || !token) return <TelaTokenInvalido />;
  if (galeria.status === "draft") return <TelaPreparacao estudio={galeria.studio_name} />;
  if (fase === "sucesso") return <TelaSucesso estudio={galeria.studio_name} />;
  if (fase === "pagamento") {
    return (
      <PaginaPagamento
        token={token}
        pagamento={pagamento}
        onPago={() => {
          setGaleria((g) => (g ? { ...g, status: "selected" } : g));
          setFase("sucesso");
        }}
      />
    );
  }

  return (
    <ConteudoGaleria
      token={token}
      galeria={galeria}
      fotos={fotos}
      selecoes={selecoes}
      totais={totais}
      totaisModal={totaisModal}
      modalAberto={modalAberto}
      finalizando={finalizando}
      erroFinalizar={erroFinalizar}
      mostrarCupom={mostrarCupom}
      cupom={cupom}
      cupomStatus={cupomStatus}
      onCupomChange={setCupom}
      onAplicarCupom={aplicarCupom}
      onToggle={alternarSelecao}
      onComentario={salvarComentario}
      onAbrirModal={abrirModal}
      onFecharModal={() => setModalAberto(false)}
      onConfirmarFinalizacao={confirmarFinalizacao}
    />
  );
}

type PropsConteudo = {
  token: string;
  galeria: GaleriaPublica;
  fotos: FotoPublica[];
  selecoes: MapaSelecoes;
  totais: TotaisSelecao;
  totaisModal: TotaisSelecao;
  modalAberto: boolean;
  finalizando: boolean;
  erroFinalizar: string | null;
  mostrarCupom: boolean;
  cupom: string;
  cupomStatus: CupomStatus;
  onCupomChange: (v: string) => void;
  onAplicarCupom: () => void;
  onToggle: (fotoId: string) => void;
  onComentario: (fotoId: string, texto: string) => void;
  onAbrirModal: () => void;
  onFecharModal: () => void;
  onConfirmarFinalizacao: () => void;
};

function ConteudoGaleria(p: PropsConteudo) {
  const finalizado = p.galeria.status === "selected" || p.galeria.status === "delivered";
  const protecao = lerProtecao(p.galeria.protection);
  const [indiceAberto, setIndiceAberto] = useState<number | null>(null);

  return (
    <div className="h-full overflow-y-auto overscroll-contain bg-[#FAF8F6] text-neutral-900">
      <CabecalhoGaleria galeria={p.galeria} mostrarAvisoProtecao={protecao.aviso} />

      {finalizado && <ResumoFinalizado token={p.token} totais={p.totais} />}

      <main className={finalizado ? "pb-10" : "pb-32"}>
        {p.fotos.length === 0 ? (
          <p className="px-6 py-16 text-center text-sm text-neutral-400">
            As fotos ainda estão sendo preparadas. Volte em breve!
          </p>
        ) : (
          <GradeFotos
            fotos={p.fotos}
            selecoes={p.selecoes}
            bloquearImagens={protecao.bloquear}
            podeEditar={!finalizado}
            onAbrir={setIndiceAberto}
            onToggle={p.onToggle}
          />
        )}
      </main>

      {!finalizado && (
        <BarraInferior
          totais={p.totais}
          finalizando={p.finalizando}
          onFinalizar={p.onAbrirModal}
        />
      )}

      {indiceAberto != null && p.fotos[indiceAberto] && (
        <Lightbox
          fotos={p.fotos}
          indice={indiceAberto}
          selecoes={p.selecoes}
          bloquearImagens={protecao.bloquear}
          podeEditar={!finalizado}
          onFechar={() => setIndiceAberto(null)}
          onNavegar={setIndiceAberto}
          onToggle={p.onToggle}
          onComentario={p.onComentario}
        />
      )}

      {p.modalAberto && (
        <ModalFinalizar
          totais={p.totaisModal}
          precoExtra={p.galeria.extra_price}
          finalizando={p.finalizando}
          erro={p.erroFinalizar}
          mostrarCupom={p.mostrarCupom}
          cupom={p.cupom}
          cupomStatus={p.cupomStatus}
          onCupomChange={p.onCupomChange}
          onAplicarCupom={p.onAplicarCupom}
          onConfirmar={p.onConfirmarFinalizacao}
          onFechar={p.onFecharModal}
        />
      )}
    </div>
  );
}

function PaginaPagamento({
  token,
  pagamento,
  onPago,
}: {
  token: string;
  pagamento: DadosPagamento | null;
  onPago: () => void;
}) {
  const { status, url } = useStatusPagamento(token, true);

  useEffect(() => {
    if (status === "paid") onPago();
  }, [status, onPago]);

  return (
    <TelaPagamento
      valor={pagamento?.valor ?? 0}
      orderCode={pagamento?.orderCode}
      paymentUrl={pagamento?.url ?? url}
    />
  );
}
