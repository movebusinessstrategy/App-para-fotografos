import React from "react";
import AdminPage from "../AdminPage";

export default function PermissoesTab() {
  return (
    <div>
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Permissões de acesso</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Controle o que cada membro da equipe pode ver e editar dentro do app.
        </p>
      </div>
      <AdminPage lockedTab="permissions" embedded />
    </div>
  );
}
