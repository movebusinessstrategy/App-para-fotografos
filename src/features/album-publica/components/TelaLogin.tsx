import React, { useState } from "react";
import { Eye, EyeOff, Loader2, Lock, ShieldCheck } from "lucide-react";

import { ErroApiPublica, publicPost, salvarSessao } from "../api";

interface LoginInfo {
  title: string;
  studio_name?: string | null;
}

interface RespostaLogin {
  session_token: string;
  user: { id: string; email: string; name: string | null; role: "owner" | "guest" };
}

interface TelaLoginProps {
  shareToken: string;
  info: LoginInfo;
  onSucesso: () => void;
}

const STAGE_BG = "radial-gradient(125% 85% at 50% -5%, #211e1a 0%, #131210 45%, #0a0a0a 100%)";

// Tela de login que a cliente vê quando o álbum é privado. Tema premium da
// marca: palco escuro, acento dourado, serifada elegante.
export function TelaLogin({ shareToken, info, onSucesso }: TelaLoginProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const submeter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (enviando) return;
    setErro(null);
    setEnviando(true);
    try {
      const resp = await publicPost<RespostaLogin>(
        `/api/public/album/${shareToken}/login`,
        { email: email.trim().toLowerCase(), password },
        shareToken,
      );
      salvarSessao(shareToken, resp.session_token);
      onSucesso();
    } catch (e) {
      if (e instanceof ErroApiPublica) {
        setErro(e.status === 401 ? "E-mail ou senha incorretos." : e.message);
      } else {
        setErro("Não foi possível entrar agora. Tente de novo.");
      }
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto text-luxury-cream" style={{ background: STAGE_BG }}>
      <div className="min-h-full flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-sm animate-album-rise">
          <div className="mb-7 flex flex-col items-center text-center">
            <div className="relative mb-5 flex items-center justify-center">
              <div
                className="absolute h-20 w-20 rounded-full blur-2xl"
                style={{ background: "radial-gradient(circle, rgba(241,198,101,.35), rgba(241,198,101,0) 70%)" }}
              />
              <div className="relative flex h-14 w-14 items-center justify-center rounded-full border border-gold-400/30 bg-white/5 text-gold-400 backdrop-blur-sm">
                <ShieldCheck size={24} />
              </div>
            </div>
            {info.studio_name && (
              <div className="text-[11px] font-semibold uppercase tracking-[0.3em] text-gold-400/80">
                {info.studio_name}
              </div>
            )}
            <h1 className="mt-2 font-serif text-3xl font-light">{info.title}</h1>
            <p className="mt-3 text-sm text-luxury-cream/55">
              Este álbum é exclusivo. Entre com o e-mail e a senha que o estúdio enviou pra você.
            </p>
          </div>

          <form
            onSubmit={submeter}
            className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl backdrop-blur-md"
          >
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-luxury-cream/50">E-mail</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="seu@email.com"
                className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-luxury-cream placeholder:text-luxury-cream/30 focus:border-gold-400/60 focus:outline-none focus:ring-2 focus:ring-gold-400/20"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-luxury-cream/50">Senha</label>
              <div className="relative">
                <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-luxury-cream/30" />
                <input
                  type={showPwd ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  className="w-full rounded-lg border border-white/10 bg-black/30 py-2.5 pl-9 pr-10 text-sm text-luxury-cream placeholder:text-luxury-cream/30 focus:border-gold-400/60 focus:outline-none focus:ring-2 focus:ring-gold-400/20"
                />
                <button
                  type="button"
                  onClick={() => setShowPwd(!showPwd)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-luxury-cream/40 hover:text-luxury-cream"
                  aria-label={showPwd ? "Ocultar senha" : "Mostrar senha"}
                >
                  {showPwd ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            {erro && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                {erro}
              </div>
            )}

            <button
              type="submit"
              disabled={enviando}
              className="bg-gold-gradient flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-luxury-black transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {enviando ? <Loader2 size={15} className="animate-spin" /> : null}
              Entrar no álbum
            </button>

            <p className="pt-1 text-center text-[11px] text-luxury-cream/35">
              Não tem o acesso? Fale com {info.studio_name || "seu fotógrafo"}.
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
