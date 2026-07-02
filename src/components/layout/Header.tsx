// src/components/layout/Header.tsx
import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Menu, Sun, Moon, LogOut, Settings } from "lucide-react";
import { useTheme } from "../../contexts/ThemeContext";

interface HeaderProps {
  title: string;
  userInitial?: string;
  userEmail?: string;
  onSignOut: () => void;
  onMenuClick: () => void;
}

export default function Header({ title, userInitial, userEmail, onSignOut, onMenuClick }: HeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const menuRef = useRef<HTMLDivElement>(null);

  // Fecha o menu ao clicar fora
  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [menuOpen]);

  return (
    <header className="h-16 bg-luxury-paper/80 dark:bg-[#070707]/80 backdrop-blur-xl border-b border-black/5 dark:border-white/5 px-4 md:px-8 flex items-center justify-between sticky top-0 z-30">
      {/* Lado esquerdo */}
      <div className="flex items-center gap-3">
        {/* Botão Menu - apenas mobile */}
        <button
          onClick={onMenuClick}
          className="lg:hidden p-2 -ml-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300"
          aria-label="Abrir menu"
        >
          <Menu size={24} />
        </button>

        <h2 className="text-lg font-bold tracking-tight capitalize truncate text-luxury-black dark:text-white">{title}</h2>
      </div>

      {/* Lado direito (busca global removida — não buscava nada e roubava espaço) */}
      <div className="flex items-center gap-2 md:gap-4">
        {/* Botão de Tema */}
        <button
          onClick={toggleTheme}
          className="p-2.5 rounded-full bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-yellow-400 transition-all duration-200"
          title={theme === "dark" ? "Modo claro" : "Modo escuro"}
        >
          {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
        </button>

        {/* Avatar com dropdown - único caminho de logout no mobile */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="w-9 h-9 rounded-full bg-gradient-to-br from-gold-400 to-gold-600 flex items-center justify-center text-white font-bold text-sm shadow-sm hover:shadow-md hover:scale-105 transition-all"
            aria-label="Menu da conta"
            aria-expanded={menuOpen}
          >
            {userInitial || "U"}
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-12 w-60 bg-white dark:bg-[#161616] rounded-2xl shadow-xl shadow-black/10 border border-black/5 dark:border-white/10 overflow-hidden z-40">
              {/* Header do menu - info do usuário */}
              <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
                <div className="text-xs text-gray-500 dark:text-gray-400">Logado como</div>
                <div className="text-sm font-semibold text-gray-900 dark:text-white truncate">
                  {userEmail || "Usuário"}
                </div>
              </div>

              {/* Links */}
              <Link
                to="/configuracoes"
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/60 transition-colors"
              >
                <Settings size={16} className="text-gray-500 dark:text-gray-400" />
                Configurações
              </Link>

              <button
                onClick={() => {
                  setMenuOpen(false);
                  onSignOut();
                }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors border-t border-gray-100 dark:border-gray-700"
              >
                <LogOut size={16} />
                Sair
              </button>
            </div>
          )}
        </div>
      </div>

    </header>
  );
}
