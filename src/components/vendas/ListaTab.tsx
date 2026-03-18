import React, { useState, useMemo } from "react";
import { format } from "date-fns";
import { Search, ChevronUp, ChevronDown } from "lucide-react";
import { Deal, PipelineStage, Client } from "../../types";
import { DealDetailDrawer } from "./DealDetailDrawer";

interface ListaTabProps {
  deals: Deal[];
  stages: PipelineStage[];
  clients: Client[];
  onUpdate: (options?: { silent?: boolean }) => void | Promise<void>;
}

type SortField = "title" | "value" | "stage" | "expected_close_date";
type SortOrder = "asc" | "desc";

export function ListaTab({ deals, stages, clients, onUpdate }: ListaTabProps) {
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("title");
  const [sortOrder, setSortOrder] = useState<SortOrder>("asc");
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null);

  const clientMap = useMemo(() => {
    const map = new Map<number, Client>();
    clients.forEach((c) => map.set(c.id, c));
    return map;
  }, [clients]);

  const stageMap = useMemo(() => {
    const map = new Map<string, PipelineStage>();
    stages.forEach((s) => map.set(s.id, s));
    return map;
  }, [stages]);

  const filteredDeals = useMemo(() => {
    let result = deals.filter((d) => {
      if (!search) return true;
      const searchLower = search.toLowerCase();
      const client = d.client_id ? clientMap.get(d.client_id) : null;
      return (
        d.title.toLowerCase().includes(searchLower) ||
        client?.name.toLowerCase().includes(searchLower) ||
        d.client_name?.toLowerCase().includes(searchLower)
      );
    });

    result.sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case "title":
          comparison = a.title.localeCompare(b.title);
          break;
        case "value":
          comparison = (a.value || 0) - (b.value || 0);
          break;
        case "stage": {
          const stageA = stageMap.get(a.stage)?.position || 0;
          const stageB = stageMap.get(b.stage)?.position || 0;
          comparison = stageA - stageB;
          break;
        }
        case "expected_close_date": {
          const dateA = a.expected_close_date || "";
          const dateB = b.expected_close_date || "";
          comparison = dateA.localeCompare(dateB);
          break;
        }
      }
      return sortOrder === "asc" ? comparison : -comparison;
    });

    return result;
  }, [deals, search, sortField, sortOrder, clientMap, stageMap]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortOrder("asc");
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null;
    return sortOrder === "asc" ? <ChevronUp size={14} /> : <ChevronDown size={14} />;
  };

  return (
    <>
      <div className="h-full flex flex-col">
        {/* Search */}
        <div className="mb-4">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar negócios..."
              className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm outline-none focus:border-gray-400"
            />
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto border border-gray-200 rounded-lg">
          <table className="w-full">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th
                  onClick={() => handleSort("title")}
                  className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100"
                >
                  <div className="flex items-center gap-1">
                    Nome <SortIcon field="title" />
                  </div>
                </th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">
                  Cliente
                </th>
                <th
                  onClick={() => handleSort("value")}
                  className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100"
                >
                  <div className="flex items-center gap-1">
                    Valor <SortIcon field="value" />
                  </div>
                </th>
                <th
                  onClick={() => handleSort("stage")}
                  className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100"
                >
                  <div className="flex items-center gap-1">
                    Etapa <SortIcon field="stage" />
                  </div>
                </th>
                <th
                  onClick={() => handleSort("expected_close_date")}
                  className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase cursor-pointer hover:bg-gray-100"
                >
                  <div className="flex items-center gap-1">
                    Previsão <SortIcon field="expected_close_date" />
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredDeals.map((deal) => {
                const client = deal.client_id ? clientMap.get(deal.client_id) : null;
                const stage = stageMap.get(deal.stage);
                return (
                  <tr
                    key={deal.id}
                    onClick={() => setSelectedDeal(deal)}
                    className="hover:bg-gray-50 cursor-pointer"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900 text-sm">{deal.title}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm text-gray-600">
                        {client?.name || deal.client_name || "-"}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-gray-900">
                        R$ {(deal.value || 0).toLocaleString("pt-BR")}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded-full">
                        {stage?.name || deal.stage}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm text-gray-600">
                        {deal.expected_close_date
                          ? format(new Date(deal.expected_close_date), "dd/MM/yyyy")
                          : "-"}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredDeals.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-500 text-sm">
                    Nenhum negócio encontrado
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-3 text-xs text-gray-500">
          {filteredDeals.length} negócio(s) encontrado(s)
        </div>
      </div>

      <DealDetailDrawer
        deal={selectedDeal}
        client={selectedDeal?.client_id ? clientMap.get(selectedDeal.client_id) : undefined}
        stages={stages}
        onClose={() => setSelectedDeal(null)}
        onUpdate={onUpdate}
      />
    </>
  );
}
