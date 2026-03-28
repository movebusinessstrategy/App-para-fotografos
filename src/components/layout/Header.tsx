// src/components/layout/Header.tsx
import React, { useState } from "react";
import { Menu, Search, X, Sun, Moon } from "lucide-react";
import { useTheme } from "../../contexts/ThemeContext";

interface HeaderProps {
  title: string;
  userInitial?: string;
  onSignOut: () => void;
  onMenuClick: () => void;
}

export default function Header({ title, userInitial, onSignOut, onMenuClick }: HeaderProps) {
  const [showMobileSearch, setShowMobileSearch] = useState(false);
  const { theme, toggleTheme } = useTheme();

  return (
    <header className="h-16 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-4 md:px-8 flex items-center justify-between sticky top-0 z-30">
      {/* Lado esquerdo */}
      <div className="flex items-center gap-3">
        {/* Botão Menu - apenas mobile */}
        <button 
          onClick={onMenuClick}
          className="lg:hidden p-2 -ml-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300"
        >
          <Menu size={24} />
        </button>
        
        <h2 className="text-lg font-semibold capitalize truncate text-gray-900 dark:text-white">{title}</h2>
      </div>

      {/* Lado direito */}
      <div className="flex items-center gap-2 md:gap-4">
        {/* Busca - Desktop */}
        <div className="relative hidden md:block">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input
            type="text"
            placeholder="Buscar..."
            className="pl-10 pr-4 py-2 bg-gray-100 dark:bg-gray-800 border-none rounded-full text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-indigo-500 w-48 lg:w-64"
          />
        </div>

        {/* Busca - Mobile (toggle) */}
        <button 
          onClick={() => setShowMobileSearch(!showMobileSearch)}
          className="md:hidden p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300"
        >
          {showMobileSearch ? <X size={20} /> : <Search size={20} />}
        </button>

        {/* Botão de Tema */}
        <button
          onClick={toggleTheme}
          className="p-2.5 rounded-full bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-yellow-400 transition-all duration-200"
          title={theme === "dark" ? "Modo claro" : "Modo escuro"}
        >
          {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
        </button>

        {/* Avatar e Logout */}
        <div className="flex items-center gap-2 md:gap-3">
          <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center text-indigo-700 dark:text-indigo-300 font-bold text-xs">
            {userInitial || "U"}
          </div>
          <button 
            onClick={onSignOut} 
            className="text-sm text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 font-medium hidden sm:block"
          >
            Sair
          </button>
        </div>
      </div>

      {/* Busca Mobile - Expandida */}
      {showMobileSearch && (
        <div className="absolute top-full left-0 right-0 p-4 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 md:hidden">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input
              type="text"
              placeholder="Buscar..."
              autoFocus
              className="w-full pl-10 pr-4 py-2 bg-gray-100 dark:bg-gray-800 border-none rounded-full text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>
      )}
    </header>
  );
}
