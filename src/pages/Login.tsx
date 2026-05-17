import type React from "react";
import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "../integrations/supabase/client";
import { Eye, EyeOff, Loader2 } from "lucide-react";

const Login = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        setError(
          error.message === "Invalid login credentials"
            ? "Email ou senha incorretos"
            : error.message
        );
        return;
      }

      if (data.user) {
        navigate("/dashboard");
      }
    } catch (err) {
      setError("Ocorreu um erro inesperado. Tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "linear-gradient(135deg, #1a1207 0%, #2d1f08 40%, #1a1207 100%)" }}>
      <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-8 border border-gray-100 dark:border-gray-800">
        {/* Header */}
        <div className="text-center mb-7">
          <div className="flex items-center justify-center gap-2.5 mb-5">
            <svg width="40" height="40" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M17 4C17 4 7 5.5 4.5 17H17V4Z" fill="#F1C665"/>
              <path d="M19 4C19 4 29 5.5 31.5 17H19V4Z" fill="#D4A94A"/>
              <path d="M17 32C17 32 7 30.5 4.5 19H17V32Z" fill="#D4A94A"/>
              <path d="M19 32C19 32 29 30.5 31.5 19H19V32Z" fill="#F1C665"/>
            </svg>
            <span className="text-2xl font-extrabold tracking-tight text-gray-900 dark:text-white">
              Foto<span style={{ color: "#D4A94A" }}>MOVE</span>
            </span>
          </div>
          <p className="text-gray-500 dark:text-gray-400 text-sm">
            Entre na sua conta para continuar
          </p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-4 p-3 bg-red-100 dark:bg-red-500/20 border border-red-400 dark:border-red-500/30 text-red-700 dark:text-red-400 rounded-lg text-sm">
            {error}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
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
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-gold-400 dark:focus:ring-gold-400 focus:border-transparent outline-none transition disabled:bg-gray-100 dark:disabled:bg-gray-800/50 disabled:cursor-not-allowed"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
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
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:ring-2 focus:ring-gold-400 dark:focus:ring-gold-400 focus:border-transparent outline-none transition disabled:bg-gray-100 dark:disabled:bg-gray-800/50 disabled:cursor-not-allowed pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <div className="text-right">
            <Link
              to="/recuperar-senha"
              className="text-sm text-gold-500 dark:text-gold-400 hover:text-gold-600 dark:hover:text-gold-300 hover:underline transition-colors"
            >
              Esqueceu a senha?
            </Link>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 px-4 bg-gold-500 dark:bg-gold-400 hover:bg-gold-600 dark:hover:bg-gold-500 text-white font-medium rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Entrando...
              </>
            ) : (
              "Entrar"
            )}
          </button>

          <p className="text-sm text-center text-gray-600 dark:text-gray-400">
            Não tem uma conta?{" "}
            <Link
              to="/cadastro"
              className="text-gold-500 dark:text-gold-400 hover:text-gold-600 dark:hover:text-gold-300 hover:underline font-medium transition-colors"
            >
              Criar conta
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
};

export default Login;
