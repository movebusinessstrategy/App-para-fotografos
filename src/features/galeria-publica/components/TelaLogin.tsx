import React, { useState } from "react";
import { Eye, EyeOff, Loader2, Lock, ShieldCheck } from "lucide-react";

import { ErroApiPublica, publicPost, salvarSessao } from "../api";
import { nomeEstudio } from "../utils";

interface LoginInfo {
  title: string;
  studio_name: string;
  studio_logo_url?: string | null;
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

// Tela bonita de login que a cliente vê quando a galeria exige acesso.
// Mostra o nome do estúdio, título da galeria e pede e-mail + senha que
// o estúdio cadastrou pra ela.
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
        `/api/public/gallery/${shareToken}/login`,
        { email: email.trim().toLowerCase(), password },
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

  const estudio = nomeEstudio(info.studio_name);
  const [logoErro, setLogoErro] = useState(false);
  const mostrarLogo = !!info.studio_logo_url && !logoErro;

  return (
    <div className="h-full overflow-y-auto bg-brand-50 text-neutral-900">
      <div className="min-h-full flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-sm">
          <div className="flex flex-col items-center text-center mb-6">
            {mostrarLogo ? (
              <img
                src={info.studio_logo_url!}
                alt={estudio}
                onError={() => setLogoErro(true)}
                className="h-16 max-w-[180px] object-contain mb-4"
              />
            ) : (
              <div className="w-14 h-14 rounded-full bg-brand-600/10 text-brand-600 flex items-center justify-center mb-4">
                <ShieldCheck size={26} />
              </div>
            )}
            <div className="text-xs uppercase tracking-wide text-brand-700">{estudio}</div>
            <h1 className="mt-1 text-xl font-medium text-neutral-900">{info.title}</h1>
            <p className="mt-2 text-sm text-neutral-500">
              Esta galeria é privada. Entre com o e-mail e senha que o estúdio enviou pra você.
            </p>
          </div>

          <form
            onSubmit={submeter}
            className="bg-white rounded-2xl border border-brand-200 p-5 space-y-3 shadow-sm"
          >
            <div>
              <label className="block text-xs font-medium text-neutral-600 mb-1">E-mail</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="seu@email.com"
                className="w-full px-3 py-2.5 rounded-lg border border-neutral-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/30 focus:border-brand-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-600 mb-1">Senha</label>
              <div className="relative">
                <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                <input
                  type={showPwd ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  className="w-full pl-9 pr-10 py-2.5 rounded-lg border border-neutral-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/30 focus:border-brand-600"
                />
                <button
                  type="button"
                  onClick={() => setShowPwd(!showPwd)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-neutral-400 hover:text-neutral-700"
                  aria-label={showPwd ? "Ocultar senha" : "Mostrar senha"}
                >
                  {showPwd ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            {erro && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                {erro}
              </div>
            )}

            <button
              type="submit"
              disabled={enviando}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-medium text-sm rounded-lg transition-colors disabled:opacity-60"
            >
              {enviando ? <Loader2 size={15} className="animate-spin" /> : null}
              Entrar
            </button>

            <p className="text-[11px] text-neutral-400 text-center pt-1">
              Não tem o acesso? Fale com o {estudio}.
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
