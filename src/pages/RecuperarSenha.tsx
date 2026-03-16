import type React from "react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../integrations/supabase/client";
import { Loader2, ArrowLeft, Mail } from "lucide-react";

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
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-4">
      <div className="w-full max-w-md bg-white rounded-xl shadow-lg p-8">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="mx-auto mb-4 h-12 w-12 rounded-xl bg-purple-600 flex items-center justify-center">
            {emailSent ? (
              <Mail className="text-white" size={24} />
            ) : (
              <span className="text-white font-bold text-xl">FP</span>
            )}
          </div>
          <h1 className="text-2xl font-bold text-gray-900">
            {emailSent ? "Email enviado!" : "Recuperar senha"}
          </h1>
          <p className="text-gray-500 mt-1">
            {emailSent
              ? "Verifique sua caixa de entrada e siga as instruções para redefinir sua senha."
              : "Digite seu email para receber o link de recuperação"}
          </p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded-lg text-sm">
            {error}
          </div>
        )}

        {!emailSent ? (
          <form onSubmit={handleRecuperarSenha} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
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
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition disabled:bg-gray-100 disabled:cursor-not-allowed"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2 px-4 bg-purple-600 hover:bg-purple-700 text-white font-medium rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Enviando...
                </>
              ) : (
                "Enviar link de recuperação"
              )}
            </button>

            <Link
              to="/login"
              className="text-sm text-center text-purple-600 hover:text-purple-700 hover:underline flex items-center justify-center gap-1"
            >
              <ArrowLeft size={16} />
              Voltar para o login
            </Link>
          </form>
        ) : (
          <div className="space-y-4">
            <button
              onClick={() => setEmailSent(false)}
              className="w-full py-2 px-4 border border-gray-300 hover:bg-gray-50 text-gray-700 font-medium rounded-lg transition"
            >
              Enviar novamente
            </button>

            <Link
              to="/login"
              className="text-sm text-center text-purple-600 hover:text-purple-700 hover:underline flex items-center justify-center gap-1"
            >
              <ArrowLeft size={16} />
              Voltar para o login
            </Link>
          </div>
        )}
      </div>
    </div>
  );
};

export default RecuperarSenha;
