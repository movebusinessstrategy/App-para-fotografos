import type React from "react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../integrations/supabase/client";
import { Loader2, ArrowLeft, ArrowRight, Mail } from "lucide-react";

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

const RecuperarSenha = () => {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [error, setError] = useState("");

  const handleRecuperarSenha = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/redefinir-senha`,
      });

      if (error) {
        setError(error.message);
        return;
      }

      setEmailSent(true);
    } catch (err) {
      setError("Ocorreu um erro inesperado. Tente novamente.");
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
            {emailSent && (
              <div className="mx-auto mb-4 h-12 w-12 rounded-2xl bg-gold-50 text-gold-600 flex items-center justify-center"><Mail size={24} /></div>
            )}
            <h1 className="text-2xl font-bold tracking-tight mb-1">
              {emailSent ? "Email enviado!" : "Recuperar senha"}
            </h1>
            <p className="text-gray-500 text-sm">
              {emailSent
                ? "Verifique sua caixa de entrada e siga o link para criar uma nova senha."
                : "Digite seu email para receber o link de recuperação"}
            </p>
          </div>

          {/* Error */}
          {error && (
            <div className="mb-4 p-3 bg-rose-50 border border-rose-200 text-rose-600 rounded-xl text-sm">{error}</div>
          )}

          {!emailSent ? (
            <form onSubmit={handleRecuperarSenha} className="space-y-4">
              <div>
                <label htmlFor="email" className="block text-[13px] font-semibold text-gray-700 mb-1.5">Email</label>
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

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 px-4 bg-gold-500 hover:bg-gold-600 text-white font-semibold rounded-full shadow-lg shadow-gold-500/25 transition-all hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 flex items-center justify-center"
              >
                {loading ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Enviando…</>) : (<>Enviar link de recuperação<ArrowRight size={17} className="ml-1.5" /></>)}
              </button>
            </form>
          ) : (
            <button
              onClick={() => setEmailSent(false)}
              className="w-full py-3 px-4 border border-gray-200 hover:bg-gray-50 text-gray-700 font-medium rounded-full transition"
            >
              Enviar novamente
            </button>
          )}
        </div>

        <p className="text-center text-sm text-gray-500 mt-6">
          <Link to="/login" className="inline-flex items-center gap-1.5 font-medium text-gray-500 hover:text-luxury-black transition-colors">
            <ArrowLeft size={15} /> Voltar para o login
          </Link>
        </p>
      </div>
    </div>
  );
};

export default RecuperarSenha;
