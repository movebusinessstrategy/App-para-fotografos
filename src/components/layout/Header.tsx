import React from "react";
import { Search } from "lucide-react";

interface HeaderProps {
  title: string;
  userInitial?: string;
  onSignOut: () => void;
}

export default function Header({ title, userInitial, onSignOut }: HeaderProps) {
  return (
    <header className="h-16 bg-white border-b border-gray-200 px-8 flex items-center justify-between sticky top-0 z-10">
      <h2 className="text-lg font-semibold capitalize">{title}</h2>
      <div className="flex items-center gap-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input
            type="text"
            placeholder="Buscar..."
            className="pl-10 pr-4 py-2 bg-gray-100 border-none rounded-full text-sm focus:ring-2 focus:ring-indigo-500 w-64"
          />
        </div>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold text-xs">
            {userInitial || "U"}
          </div>
          <button onClick={onSignOut} className="text-sm text-gray-500 hover:text-red-600 font-medium">
            Sair
          </button>
        </div>
      </div>
    </header>
  );
}
