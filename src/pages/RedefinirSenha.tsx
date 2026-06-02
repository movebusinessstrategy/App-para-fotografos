import type React from "react";
import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "../integrations/supabase/client";
import { Eye, EyeOff, Loader2, Lock, CheckCircle2, AlertTriangle, ArrowRight, ArrowLeft } from "lucide-react";

type Status = "checking" | "ready" | "invalid" | "done";

const GridBackdrop = () => (
  <div className="pointer-events-none absolute inset-0 overflow-hidden">
    <div
      className="absolute inset-0"
      style={{
        backgroundImage:
          "linear-gradient(to right, rgba(17,17,17,0.05) 1px, transparent 1px), linear-gradient(to bottom, rgba(17,17,17,0.05) 1px, transparent 1px)",
        backgroundSize: "46px 46px",
        WebkitMaskImage: "radial-gradient(ellipse 75% 70% at 50% 0%, #000 45%, transparent 100%)",
        maskImage: "radial-gradient(ellipse 75% 70% at 50% 0%, #000 45%, transparent 100%)",
      }}
    />
    <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[680px] h-[420px] bg-gold-200/30 rounded-full blur-[130px]" />
  </div>
);

const RedefinirSenha = () => {
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status>("checking");
  const [linkError, setLinkError] = useState("");

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState("");

  // Detecta a sessão de recuperação que o Supabase cria a partir do link do email.
  useEffect(() => {
    // 1. Link inválido/expirado vem como erro no hash da URL.
    const hash = window.location.hash || "";
    if (hash.includes("error")) {
      const params = new URLSearchParams(hash.replace(/^#/, ""));
      const desc = params.get("error_description");
      setLinkError(desc ? decodeURIComponent(desc.replace(/\+/g, " ")) : "O link é inválido ou já expirou.");
      setStatus("invalid");
      return;
    }

    // 2. O client processa o token da URL automaticamente e cria a sessão.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || session) setStatus("ready");
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setStatus("ready");
    });

    // 3. Se em alguns segundos não houver sessão, o link não é válido.
    const t = setTimeout(() => {
      setStatus((s) => (s === "checking" ? "invalid" : s));
    }, 3500);

    return () => { subscription.unsubscribe(); clearTimeout(t); };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    if (password.length < 6) { setFormError("A senha precisa ter ao menos 6 caracteres."); return; }
    if (password !== confirm) { setFormError("As senhas não coincidem."); return; }

    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) { setFormError(error.message); return; }
      setStatus("done");
      setTimeout(() => navigate("/dashboard"), 2200);
    } catch {
      setFormError("Ocorreu um erro inesperado. Tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen relative flex items-center justify-center p-4 bg-luxury-paper text-luxury-black font-sans antialiased overflow-hidden">
      <GridBackdrop />

      <div className="relative w-full max-w-md">
        <div className="bg-white rounded-[1.75rem] shadow-xl shadow-black/[0.06] border border-black/5 p-8 sm:p-9">
          {/* Header */}
          <div className="text-center mb-7">
            <div className="flex items-center justify-center mb-5">
              <img src="/logo-light.png" alt="CRM Trilha" className="h-9 w-auto" />
            </div>
            {status === "done" ? (
              <>
                <div className="mx-auto mb-4 h-12 w-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center"><CheckCircle2 size={26} /></div>
                <h1 className="text-2xl font-bold tracking-tight mb-1">Senha redefinida!</h1>
                <p className="text-gray-500 text-sm">Tudo certo. Você já está entrando na sua conta…</p>
              </>
            ) : status === "invalid" ? (
              <>
                <div className="mx-auto mb-4 h-12 w-12 rounded-2xl bg-rose-50 text-rose-500 flex items-center justify-center"><AlertTriangle size={26} /></div>
                <h1 className="text-2xl font-bold tracking-tight mb-1">Link inválido ou expirado</h1>
                <p className="text-gray-500 text-sm">{linkError || "Peça um novo link de recuperação para continuar."}</p>
              </>
            ) : (
              <>
                <h1 className="text-2xl font-bold tracking-tight mb-1">Criar nova senha</h1>
                <p className="text-gray-500 text-sm">Escolha uma senha nova para a sua conta</p>
              </>
            )}
          </div>

          {/* Conteúdo conforme o status */}
          {status === "checking" && (
            <div className="flex items-center justify-center gap-2 py-6 text-gray-400 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Validando o link…
            </div>
          )}

          {status === "invalid" && (
            <Link to="/recuperar-senha" className="group block text-center w-full py-3 px-4 bg-gold-500 hover:bg-gold-600 text-white font-semibold rounded-full shadow-lg shadow-gold-500/25 transition-all hover:-translate-y-0.5">
              Pedir novo link
              <ArrowRight size={17} className="inline ml-1.5 group-hover:translate-x-0.5 transition-transform" />
            </Link>
          )}

          {status === "ready" && (
            <form onSubmit={handleSubmit} className="space-y-4">
              {formError && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-600 rounded-xl text-sm">{formError}</div>
              )}

              <div>
                <label htmlFor="password" className="block text-[13px] font-semibold text-gray-700 mb-1.5">Nova senha</label>
                <div className="relative">
                  <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Mínimo de 6 caracteres"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    disabled={loading}
                    className="w-full pl-10 pr-10 py-2.5 border border-gray-200 rounded-xl bg-white text-luxury-black placeholder-gray-400 focus:ring-2 focus:ring-gold-400/50 focus:border-gold-400 outline-none transition disabled:bg-gray-50"
                  />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 transition-colors">
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor="confirm" className="block text-[13px] font-semibold text-gray-700 mb-1.5">Confirmar nova senha</label>
                <div className="relative">
                  <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    id="confirm"
                    type={showPassword ? "text" : "password"}
                    placeholder="Repita a senha"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                    disabled={loading}
                    className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl bg-white text-luxury-black placeholder-gray-400 focus:ring-2 focus:ring-gold-400/50 focus:border-gold-400 outline-none transition disabled:bg-gray-50"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 px-4 bg-gold-500 hover:bg-gold-600 text-white font-semibold rounded-full shadow-lg shadow-gold-500/25 transition-all hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 flex items-center justify-center"
              >
                {loading ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Salvando…</>) : (<>Redefinir senha<ArrowRight size={17} className="ml-1.5" /></>)}
              </button>
            </form>
          )}
        </div>

        {status !== "done" && (
          <p className="text-center text-sm text-gray-500 mt-6">
            <Link to="/login" className="inline-flex items-center gap-1.5 font-medium text-gray-500 hover:text-luxury-black transition-colors">
              <ArrowLeft size={15} /> Voltar para o login
            </Link>
          </p>
        )}
      </div>
    </div>
  );
};

export default RedefinirSenha;
