import type React from "react";
import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "../integrations/supabase/client";
import { Eye, EyeOff, Loader2, ArrowLeft, ArrowRight } from "lucide-react";
import { CONNECTION_ERROR, withTimeout } from '../utils/requestTimeout';

function loginErrorMessage(error: { message: string; status?: number }) {
  if (error.message === 'Invalid login credentials') return 'Email ou senha incorretos';
  if (!error.status || error.status >= 500) return CONNECTION_ERROR;
  return error.message;
}

const Login = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  // Pré-aquece o backend: dispara um ping no momento que a tela de login
  // carrega. Assim, quando o usuário termina de digitar e clica em Entrar,
  // o servidor já tá acordado (Render free tier dorme após 15min).
  useEffect(() => {
    const base = (import.meta.env.VITE_API_BASE_URL as string) || '';
    fetch(`${base}/api/health`, { method: 'GET', cache: 'no-store' }).catch(() => {});
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const { data, error } = await withTimeout(supabase.auth.signInWithPassword({
        email,
        password,
      }), 30_000);

      if (error) {
        setError(loginErrorMessage(error));
        return;
      }

      if (data.user) {
        navigate("/dashboard");
      }
    } catch (err) {
      setError(CONNECTION_ERROR);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen relative flex items-center justify-center p-4 bg-luxury-paper text-luxury-black font-sans antialiased overflow-hidden">
      {/* Fundo: grid técnico + brilho dourado (mesma identidade da landing) */}
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

      {/* Voltar ao site */}
      <Link
        to="/"
        className="absolute top-5 left-5 inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-luxury-black transition-colors"
      >
        <ArrowLeft size={16} /> Voltar ao site
      </Link>

      <div className="relative w-full max-w-md">
        <div className="bg-white rounded-[1.75rem] shadow-xl shadow-black/[0.06] border border-black/5 p-8 sm:p-9">
          {/* Header */}
          <div className="text-center mb-7">
            <div className="flex items-center justify-center mb-5">
              <img src="/logo-light.png" alt="CRM Trilha" className="h-9 w-auto" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight mb-1">Bem-vindo de volta</h1>
            <p className="text-gray-500 text-sm">Entre na sua conta para continuar</p>
          </div>

          {/* Error */}
          {error && (
            <div className="mb-4 p-3 bg-rose-50 border border-rose-200 text-rose-600 rounded-xl text-sm">
              {error}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-[13px] font-semibold text-gray-700 mb-1.5">
                Email
              </label>
              <input
                id="email"
                type="email"
                placeholder="seu@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={loading}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl bg-white text-luxury-black placeholder-gray-400 focus:ring-2 focus:ring-gold-400/50 focus:border-gold-400 outline-none transition disabled:bg-gray-50 disabled:cursor-not-allowed"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-[13px] font-semibold text-gray-700 mb-1.5">
                Senha
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={loading}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl bg-white text-luxury-black placeholder-gray-400 focus:ring-2 focus:ring-gold-400/50 focus:border-gold-400 outline-none transition disabled:bg-gray-50 disabled:cursor-not-allowed pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 transition-colors"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <div className="text-right">
              <Link
                to="/recuperar-senha"
                className="text-[13px] font-medium text-gold-600 hover:text-gold-700 transition-colors"
              >
                Esqueceu a senha?
              </Link>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 px-4 bg-gold-500 hover:bg-gold-600 text-white font-semibold rounded-full shadow-lg shadow-gold-500/25 transition-all hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 flex items-center justify-center"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Entrando...
                </>
              ) : (
                <>
                  Entrar
                  <ArrowRight size={17} className="ml-1.5" />
                </>
              )}
            </button>
          </form>
        </div>

        {/* Criar conta */}
        <p className="text-center text-sm text-gray-500 mt-6">
          Não tem uma conta?{" "}
          <Link to="/cadastro" className="font-semibold text-gold-600 hover:text-gold-700 transition-colors">
            Criar conta grátis
          </Link>
        </p>
      </div>
    </div>
  );
};

export default Login;
