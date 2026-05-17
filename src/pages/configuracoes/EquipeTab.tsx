import React from "react";
import AdminPage from "../AdminPage";

export default function EquipeTab() {
  return (
    <div>
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Equipe</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Adicione membros à sua conta. Cada um pode acessar com email e senha próprios.
        </p>
      </div>
      <AdminPage lockedTab="members" embedded />
    </div>
  );
}
