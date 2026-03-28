import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from "react";
import {
  ArrowLeft,
  BarChart3,
  Check,
  ChevronDown,
  Edit2,
  Flame,
  Instagram,
  LayoutGrid,
  MessageCircle,
  Phone,
  Plus,
  Search,
  Tag,
  Target,
  TrendingUp,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { ChatMessages } from "./ChatMessages";
import { ChatInput } from "./ChatInput";
import { QuickReplies } from "./QuickReplies";
import { LeadPanelDados } from "./LeadPanelDados";
import { LeadEditModal } from "./LeadEditModal";
import { ConnectChannelModal } from "./ConnectChannelModal";
import { Lead, Message, PipelineStage } from "../../types/vendas";
import { quickReplies } from "../../data/mockLeads";
import { authFetch } from "../../utils/authFetch";

const BADGE_COLORS = [
  "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300",
  "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  "bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300",
  "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300",
  "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300",
  "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
];

interface ApiStage {
  id: string;
  name: string;
  position: number;
  is_final: boolean;
  is_won: boolean;
}

interface StageConfigItem {
  value: PipelineStage;
  label: string;
  isFinal: boolean;
  isWon: boolean;
  color: string;
  position: number;
}

type DetailTab = "chat" | "dados";
type InboxFilter = "all" | "unread";
type ChannelFilter = "all" | "whatsapp" | "instagram";
type WorkspaceTab = "conversas" | "kanban" | "analise";

const LS_KEY = "fp_wa_leads_v1";

const brlFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 0,
});

const timeAgo = (date: Date) => {
  const diff = Math.round((Date.now() - date.getTime()) / 60000);
  if (diff < 60) return `${Math.max(1, diff)} min`;
  const h = Math.round(diff / 60);
  if (h < 24) return `${h} h`;
  return `${Math.round(h / 24)} d`;
};

const normalizeDigits = (value: unknown) => {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).replace(/\D/g, "");
};

const normalizeTag = (value: string) => value.trim().replace(/^#/, "").toLowerCase();

const formatCurrency = (value: number) => brlFormatter.format(value || 0);

const parseChatDate = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 1_000_000_000_000 ? value : value * 1000;
    return new Date(ms);
  }

  if (typeof value === "string") {
    const asNumber = Number(value);
    if (Number.isFinite(asNumber) && asNumber > 0) {
      const ms = asNumber > 1_000_000_000_000 ? asNumber : asNumber * 1000;
      return new Date(ms);
    }

    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  return new Date();
};

const parseLiveMessageText = (message: any) => {
  const candidates = [message?.text, message?.message, message?.content];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const parsed = candidate.trim();
    if (parsed) return parsed;
  }
  return "";
};

const dateReviver = (_key: string, value: unknown) => {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
    return new Date(value);
  }
  return value;
};

const sanitizeLead = (lead: Lead): Lead => {
  const tags = Array.isArray(lead.tags)
    ? lead.tags.map((tag) => normalizeTag(tag)).filter(Boolean)
    : [];

  const messages = Array.isArray(lead.messages)
    ? lead.messages.map((message) => ({
      ...message,
      timestamp: message.timestamp instanceof Date ? message.timestamp : new Date(message.timestamp),
    }))
    : [];

  return {
    ...lead,
    tags,
    messages,
    unreadCount: Number.isFinite(lead.unreadCount) ? lead.unreadCount : 0,
    createdAt: lead.createdAt instanceof Date ? lead.createdAt : new Date(lead.createdAt),
    updatedAt: lead.updatedAt instanceof Date ? lead.updatedAt : new Date(lead.updatedAt),
  };
};

const loadLeadsFromStorage = (): Lead[] => {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw, dateReviver) as Lead[];
    return Array.isArray(parsed) ? parsed.map(sanitizeLead) : [];
  } catch {
    return [];
  }
};

export function Pipeline() {
  const [leads, setLeads] = useState<Lead[]>(loadLeadsFromStorage);
  const [salesStages, setSalesStages] = useState<ApiStage[]>([]);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [activeDetailTab, setActiveDetailTab] = useState<DetailTab>("chat");
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>("conversas");
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [waConnected, setWaConnected] = useState(false);
  const [igConnected, setIgConnected] = useState(false);
  const [search, setSearch] = useState("");
  const [inboxFilter, setInboxFilter] = useState<InboxFilter>("all");
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>("all");
  const [tagFilter, setTagFilter] = useState<string>("all");
  const [stageSelectorOpen, setStageSelectorOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [tagDraft, setTagDraft] = useState("");
  const statusIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    authFetch("/api/pipeline/stages")
      .then((response) => (response.ok ? response.json() : []))
      .then((data: ApiStage[]) => {
        if (Array.isArray(data) && data.length > 0) {
          setSalesStages(data);
        }
      })
      .catch(() => {});
  }, []);

  const stageConfig = useMemo<StageConfigItem[]>(() => {
    const source = salesStages.length > 0
      ? salesStages
      : [
        { id: "lead", name: "Lead Novo", position: 0, is_final: false, is_won: false },
        { id: "negotiation", name: "Em Negociação", position: 1, is_final: false, is_won: false },
        { id: "won", name: "Fechado Ganho", position: 2, is_final: true, is_won: true },
        { id: "lost", name: "Perdido", position: 3, is_final: true, is_won: false },
      ];

    return [...source]
      .sort((a, b) => a.position - b.position)
      .map((stage, index) => ({
        value: stage.id,
        label: stage.name,
        isFinal: stage.is_final,
        isWon: stage.is_won,
        position: stage.position,
        color: stage.is_final
          ? (stage.is_won
            ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
            : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300")
          : BADGE_COLORS[index % BADGE_COLORS.length],
      }));
  }, [salesStages]);

  const stageLabel = useCallback(
    (stage: PipelineStage) => stageConfig.find((item) => item.value === stage)?.label ?? stage,
    [stageConfig]
  );

  const stageBadgeColor = useCallback(
    (stage: PipelineStage) => stageConfig.find((item) => item.value === stage)?.color ?? "bg-gray-100 text-gray-600",
    [stageConfig]
  );

  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(leads));
    } catch {
      // Ignora erro de armazenamento
    }
  }, [leads]);

  const activeLeads = useMemo(
    () => leads.filter((lead) => (lead.status || "pipeline") !== "archived"),
    [leads]
  );

  const knownStageIds = useMemo(() => new Set(stageConfig.map((stage) => stage.value)), [stageConfig]);
  const stageIndexMap = useMemo(
    () => new Map(stageConfig.map((stage, index) => [stage.value, index])),
    [stageConfig]
  );
  const firstStageId = stageConfig[0]?.value ?? "lead";

  const availableTags = useMemo(() => {
    const tags = new Set<string>();
    activeLeads.forEach((lead) => {
      lead.tags.forEach((tag) => {
        const normalized = normalizeTag(tag);
        if (normalized) tags.add(normalized);
      });
    });
    return Array.from(tags).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [activeLeads]);

  const selectedLead = useMemo(
    () => leads.find((lead) => lead.id === selectedLeadId) ?? null,
    [leads, selectedLeadId]
  );

  const selectedWhatsappPhone = useMemo(
    () => (selectedLead?.channel === "whatsapp" ? normalizeDigits(selectedLead.phone) : ""),
    [selectedLead]
  );

  const filteredLeads = useMemo(() => {
    return activeLeads
      .filter((lead) => channelFilter === "all" || lead.channel === channelFilter)
      .filter((lead) => inboxFilter === "all" || (lead.unreadCount ?? 0) > 0)
      .filter((lead) => tagFilter === "all" || lead.tags.some((tag) => normalizeTag(tag) === tagFilter))
      .filter((lead) => {
        if (!search.trim()) return true;
        const query = search.toLowerCase();
        const tagsAsText = lead.tags.join(" ").toLowerCase();
        return (
          lead.name.toLowerCase().includes(query)
          || lead.serviceType.toLowerCase().includes(query)
          || lead.phone?.includes(query)
          || lead.instagramHandle?.toLowerCase().includes(query)
          || tagsAsText.includes(query)
        );
      })
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }, [activeLeads, channelFilter, inboxFilter, tagFilter, search]);

  const waCnt = useMemo(() => activeLeads.filter((lead) => lead.channel === "whatsapp").length, [activeLeads]);
  const igCnt = useMemo(() => activeLeads.filter((lead) => lead.channel === "instagram").length, [activeLeads]);
  const totalUnread = useMemo(
    () => activeLeads.reduce((sum, lead) => sum + (lead.unreadCount ?? 0), 0),
    [activeLeads]
  );

  const leadsByStage = useMemo(() => {
    const map = new Map<PipelineStage, Lead[]>();
    stageConfig.forEach((stage) => map.set(stage.value, []));

    activeLeads.forEach((lead) => {
      const bucket = knownStageIds.has(lead.stage) ? lead.stage : firstStageId;
      if (!map.has(bucket)) map.set(bucket, []);
      map.get(bucket)?.push(lead);
    });

    map.forEach((stageLeads) => {
      stageLeads.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    });

    return map;
  }, [activeLeads, firstStageId, knownStageIds, stageConfig]);

  const analytics = useMemo(() => {
    const wonStageIds = new Set(stageConfig.filter((stage) => stage.isFinal && stage.isWon).map((stage) => stage.value));
    const lostStageIds = new Set(stageConfig.filter((stage) => stage.isFinal && !stage.isWon).map((stage) => stage.value));

    const wonLeads = activeLeads.filter((lead) => wonStageIds.has(lead.stage));
    const lostLeads = activeLeads.filter((lead) => lostStageIds.has(lead.stage));
    const openLeads = activeLeads.filter((lead) => !wonStageIds.has(lead.stage) && !lostStageIds.has(lead.stage));

    const closedCount = wonLeads.length + lostLeads.length;
    const conversionRate = closedCount > 0 ? (wonLeads.length / closedCount) * 100 : 0;

    const activeStages = stageConfig.filter((stage) => !stage.isFinal);
    const hotStageThreshold = Math.max(0, activeStages.length - 2);

    const hotLeads = openLeads
      .filter((lead) => (stageIndexMap.get(lead.stage) ?? 0) >= hotStageThreshold)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, 5);

    const byStage = stageConfig.map((stage) => {
      const stageLeads = leadsByStage.get(stage.value) || [];
      return {
        stage,
        count: stageLeads.length,
        value: stageLeads.reduce((sum, lead) => sum + (lead.estimatedValue || 0), 0),
      };
    });

    return {
      openLeads,
      wonLeads,
      lostLeads,
      hotLeads,
      conversionRate,
      potentialValue: openLeads.reduce((sum, lead) => sum + (lead.estimatedValue || 0), 0),
      byStage,
    };
  }, [activeLeads, leadsByStage, stageConfig, stageIndexMap]);

  const checkChannelStatus = useCallback(async () => {
    try {
      const waRes = await authFetch("/api/whatsapp/status");
      const waData = await waRes.json().catch(() => ({}));
      const nowConnected = (waData?.instance?.state ?? waData?.state ?? "") === "open";
      setWaConnected((prev) => {
        if (!prev && nowConnected) {
          authFetch("/api/whatsapp/sync-history", { method: "POST" }).catch(() => {});
        }
        return nowConnected;
      });

      // Instagram: só verifica se o endpoint responder OK (503 = não configurado, ignora silenciosamente)
      const igRes = await authFetch("/api/instagram/status").catch(() => null);
      if (igRes && igRes.ok) {
        const igData = await igRes.json().catch(() => ({}));
        setIgConnected((igData?.instance?.state ?? igData?.state ?? "") === "open");
      }
    } catch {
      // Sem servidor ativo
    }
  }, []);

  const pollLiveContacts = useCallback(async () => {
    if (!waConnected) return;
    try {
      const response = await authFetch("/api/whatsapp/live-contacts");
      if (!response.ok) return;

      const contacts: Array<{
        phone: string;
        name?: string;
        lastMessage: string;
        lastMessageTime: number;
        fromMe: boolean;
        unreadCount: number;
      }> = await response.json().catch(() => []);

      if (!Array.isArray(contacts) || contacts.length === 0) return;

      setLeads((prev) => {
        const updated = [...prev];

        contacts.forEach((contact) => {
          if (!contact.phone) return;

          const msgId = `webhook-${contact.phone}-${contact.lastMessageTime}`;
          const newMessage: Message = {
            id: msgId,
            content: contact.lastMessage,
            timestamp: new Date(contact.lastMessageTime),
            isFromClient: !contact.fromMe,
            status: contact.fromMe ? "delivered" : undefined,
          };

          const existingIndex = updated.findIndex(
            (lead) => lead.channel === "whatsapp" && normalizeDigits(lead.phone ?? "") === contact.phone
          );

          if (existingIndex >= 0) {
            const lead = updated[existingIndex];
            const hasMessage = lead.messages.some((message) => message.id === msgId);
            updated[existingIndex] = {
              ...lead,
              name: contact.name || lead.name,
              messages: hasMessage ? lead.messages : [...lead.messages, newMessage],
              unreadCount: contact.unreadCount,
              updatedAt: new Date(contact.lastMessageTime),
            };
            return;
          }

          updated.push({
            id: `wa-${contact.phone}`,
            name: contact.name || `Contato ${contact.phone.slice(-4)}`,
            phone: contact.phone,
            channel: "whatsapp",
            source: "WhatsApp",
            status: "inbox",
            stage: firstStageId,
            serviceType: "WhatsApp",
            estimatedValue: 0,
            tags: ["whatsapp"],
            notes: "Lead recebido via WhatsApp.",
            messages: [newMessage],
            unreadCount: contact.unreadCount,
            createdAt: new Date(contact.lastMessageTime),
            updatedAt: new Date(contact.lastMessageTime),
          });
        });

        return updated;
      });
    } catch {
      // Ignora erro de polling
    }
  }, [firstStageId, waConnected]);

  useEffect(() => {
    checkChannelStatus();
    statusIntervalRef.current = setInterval(checkChannelStatus, 30_000);
    return () => {
      if (statusIntervalRef.current) clearInterval(statusIntervalRef.current);
    };
  }, [checkChannelStatus]);

  useEffect(() => {
    if (!waConnected) return undefined;
    pollLiveContacts();
    const interval = setInterval(pollLiveContacts, 10_000);
    return () => clearInterval(interval);
  }, [pollLiveContacts, waConnected]);

  useEffect(() => {
    if (!selectedLeadId) return;
    if (!leads.some((lead) => lead.id === selectedLeadId)) {
      setSelectedLeadId(null);
    }
  }, [leads, selectedLeadId]);

  useEffect(() => {
    if (!waConnected || !selectedLeadId || !selectedWhatsappPhone) return undefined;

    const syncSelectedChatMessages = async () => {
      try {
        const response = await authFetch(`/api/whatsapp/messages/${selectedWhatsappPhone}?limit=100`);
        if (!response.ok) return;

        const payload = await response.json().catch(() => ({}));
        const rawMessages = Array.isArray(payload?.messages) ? payload.messages : [];
        if (rawMessages.length === 0) return;

        setLeads((prev) => prev.map((lead) => {
          if (lead.id !== selectedLeadId) return lead;

          const knownIds = new Set(lead.messages.map((message) => message.id));
          const parsed = rawMessages
            .map((rawMessage: any, index: number): Message | null => {
              const content = parseLiveMessageText(rawMessage);
              if (!content) return null;

              const timestamp = parseChatDate(
                rawMessage?.timestamp
                ?? rawMessage?.momment
                ?? rawMessage?.moment
                ?? rawMessage?.createdAt
              );

              const messageIdRaw = rawMessage?.id ?? rawMessage?.messageId;
              const messageId = (typeof messageIdRaw === "string" && messageIdRaw.trim())
                ? messageIdRaw.trim()
                : `wa-live-${selectedWhatsappPhone}-${timestamp.getTime()}-${index}`;

              return {
                id: messageId,
                content,
                timestamp,
                isFromClient: !Boolean(rawMessage?.fromMe),
                status: rawMessage?.fromMe ? "delivered" : undefined,
              };
            })
            .filter((message): message is Message => !!message);

          const newMessages = parsed.filter((message) => !knownIds.has(message.id));
          if (newMessages.length === 0) return lead;

          const latestTimestamp = newMessages.reduce(
            (latest, message) => Math.max(latest, message.timestamp.getTime()),
            lead.updatedAt.getTime()
          );

          return {
            ...lead,
            messages: [...lead.messages, ...newMessages],
            updatedAt: new Date(latestTimestamp),
            unreadCount: 0,
          };
        }));
      } catch (error) {
        console.warn("[WA] selected chat sync error:", error);
      }
    };

    syncSelectedChatMessages();
    const interval = setInterval(syncSelectedChatMessages, 5_000);
    return () => clearInterval(interval);
  }, [selectedLeadId, selectedWhatsappPhone, waConnected]);

  const handleSelectLead = useCallback((id: string) => {
    setSelectedLeadId(id);
    setActiveDetailTab("chat");
    setDraft("");
    setStageSelectorOpen(false);
    setLeads((prev) => prev.map((lead) => (lead.id === id ? { ...lead, unreadCount: 0 } : lead)));

    const selected = leads.find((lead) => lead.id === id);
    if (selected?.channel === "whatsapp" && selected.phone) {
      const phone = normalizeDigits(selected.phone);
      authFetch(`/api/whatsapp/mark-read/${phone}`, { method: "POST" }).catch(() => {});
    }
  }, [leads]);

  const moveLeadToStage = useCallback((leadId: string, stage: PipelineStage) => {
    setLeads((prev) => prev.map((lead) => (
      lead.id === leadId
        ? { ...lead, stage, status: "pipeline", updatedAt: new Date() }
        : lead
    )));
  }, []);

  const handleMoveSelectedLeadStage = (stage: PipelineStage) => {
    if (!selectedLeadId) return;
    moveLeadToStage(selectedLeadId, stage);
    setStageSelectorOpen(false);
  };

  const handleAddTagToLead = useCallback((leadId: string, rawTag: string) => {
    const parsedTag = normalizeTag(rawTag);
    if (!parsedTag) return;

    setLeads((prev) => prev.map((lead) => {
      if (lead.id !== leadId) return lead;
      const currentTags = lead.tags.map((tag) => normalizeTag(tag)).filter(Boolean);
      if (currentTags.includes(parsedTag)) return lead;
      return {
        ...lead,
        tags: [...currentTags, parsedTag],
        updatedAt: new Date(),
      };
    }));
  }, []);

  const handleRemoveTagFromLead = useCallback((leadId: string, tagToRemove: string) => {
    const parsedTag = normalizeTag(tagToRemove);

    setLeads((prev) => prev.map((lead) => {
      if (lead.id !== leadId) return lead;
      return {
        ...lead,
        tags: lead.tags.map((tag) => normalizeTag(tag)).filter((tag) => tag && tag !== parsedTag),
      };
    }));
  }, []);

  const handleDiscard = (id: string) => {
    setLeads((prev) => prev.map((lead) => (lead.id === id ? { ...lead, status: "archived" } : lead)));
    if (selectedLeadId === id) setSelectedLeadId(null);
  };

  const handleSendMessage = async (text: string) => {
    if (!selectedLeadId || !selectedLead) return;

    const messageId = `msg-${Date.now()}`;
    const now = new Date();

    setLeads((prev) => prev.map((lead) => (
      lead.id === selectedLeadId
        ? {
          ...lead,
          messages: [...lead.messages, {
            id: messageId,
            content: text,
            timestamp: now,
            isFromClient: false,
            status: "sent",
          }],
          updatedAt: now,
        }
        : lead
    )));

    setDraft("");

    const canSendReal = selectedLead.channel === "whatsapp" && waConnected && selectedLead.phone;
    if (canSendReal) {
      try {
        await authFetch("/api/whatsapp/send", {
          method: "POST",
          body: JSON.stringify({ number: normalizeDigits(selectedLead.phone), text }),
        });

        setLeads((prev) => prev.map((lead) => (
          lead.id === selectedLeadId
            ? {
              ...lead,
              messages: lead.messages.map((message) => (
                message.id === messageId ? { ...message, status: "delivered" } : message
              )),
            }
            : lead
        )));
      } catch {
        // Mantém status como "sent"
      }
      return;
    }

    setTimeout(() => {
      setLeads((prev) => prev.map((lead) => (
        lead.id === selectedLeadId
          ? {
            ...lead,
            messages: lead.messages.map((message) => (
              message.id === messageId ? { ...message, status: "delivered" } : message
            )),
          }
          : lead
      )));
    }, 800);
  };

  const openEdit = (lead: Lead) => {
    setEditingLead(lead);
    setEditOpen(true);
  };

  const handleSaveLead = (updated: Lead) => {
    const sanitized = sanitizeLead(updated);
    setLeads((prev) => prev.map((lead) => (lead.id === sanitized.id ? sanitized : lead)));
    setEditOpen(false);
    setEditingLead(null);
  };

  const handleDeleteLead = (id: string) => {
    setLeads((prev) => prev.filter((lead) => lead.id !== id));
    setEditOpen(false);
    setEditingLead(null);
    if (selectedLeadId === id) setSelectedLeadId(null);
  };

  const quickFilter: "all" | "unread" | "whatsapp" | "instagram" = useMemo(() => {
    if (inboxFilter === "unread") return "unread";
    if (channelFilter === "whatsapp") return "whatsapp";
    if (channelFilter === "instagram") return "instagram";
    return "all";
  }, [channelFilter, inboxFilter]);

  const handleQuickFilter = (filter: "all" | "unread" | "whatsapp" | "instagram") => {
    if (filter === "all") {
      setInboxFilter("all");
      setChannelFilter("all");
      return;
    }

    if (filter === "unread") {
      setInboxFilter("unread");
      setChannelFilter("all");
      return;
    }

    setInboxFilter("all");
    setChannelFilter(filter);
  };

  const isMobileWithChatOpen = workspaceTab === "conversas" && selectedLeadId !== null;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-start justify-between gap-3 pb-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Vendas</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {filteredLeads.length} conversas
            {totalUnread > 0 && (
              <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-bold text-green-700 dark:bg-green-900/40 dark:text-green-300">
                {totalUnread} não lidas
              </span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setConnectOpen(true)}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
            title="Gerenciar conexões"
          >
            {waConnected || igConnected ? (
              <Wifi size={15} className="text-green-500" />
            ) : (
              <WifiOff size={15} className="text-gray-400" />
            )}
            {waConnected && (
              <span className="flex items-center gap-1 rounded-full bg-green-100 px-1.5 py-0.5 text-[11px] font-bold text-green-700 dark:bg-green-900/30 dark:text-green-400">
                <span className="h-1.5 w-1.5 rounded-full bg-green-500" />WA
              </span>
            )}
            {igConnected && (
              <span className="flex items-center gap-1 rounded-full bg-pink-100 px-1.5 py-0.5 text-[11px] font-bold text-pink-700 dark:bg-pink-900/30 dark:text-pink-400">
                <span className="h-1.5 w-1.5 rounded-full bg-pink-500" />IG
              </span>
            )}
            {!waConnected && !igConnected && <span className="text-xs text-gray-500">Conectar</span>}
          </button>

          <button
            onClick={() => { /* TODO: abrir modal novo lead */ }}
            className="flex items-center gap-2 rounded-lg bg-blue-500 px-3 py-2 text-sm font-semibold text-white transition hover:bg-blue-600"
          >
            <Plus size={15} /> Novo Lead
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden rounded-[22px] border border-gray-200 bg-[#f9fbfa] dark:border-gray-700 dark:bg-[#111b21]">
        <div
          className={`flex shrink-0 border-r border-gray-200/80 dark:border-gray-700 ${
            isMobileWithChatOpen ? "hidden md:flex" : "flex"
          }`}
        >
          <div className="flex w-[58px] flex-col items-center gap-2 border-r border-gray-200/80 py-3 dark:border-gray-700">
            <button
              onClick={() => setWorkspaceTab("conversas")}
              title="Conversas"
              className={`flex h-9 w-9 items-center justify-center rounded-xl transition ${
                workspaceTab === "conversas"
                  ? "bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white"
                  : "text-gray-500 hover:bg-white/70 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
              }`}
            >
              <MessageCircle size={16} />
            </button>
            <button
              onClick={() => setWorkspaceTab("kanban")}
              title="Kanban"
              className={`flex h-9 w-9 items-center justify-center rounded-xl transition ${
                workspaceTab === "kanban"
                  ? "bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white"
                  : "text-gray-500 hover:bg-white/70 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
              }`}
            >
              <LayoutGrid size={16} />
            </button>
            <button
              onClick={() => setWorkspaceTab("analise")}
              title="Insights"
              className={`flex h-9 w-9 items-center justify-center rounded-xl transition ${
                workspaceTab === "analise"
                  ? "bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white"
                  : "text-gray-500 hover:bg-white/70 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
              }`}
            >
              <BarChart3 size={16} />
            </button>
          </div>

          {workspaceTab === "conversas" && (
            <div className="flex w-[330px] min-w-[280px] max-w-[360px] flex-col min-h-0 overflow-hidden">
              <div className="border-b border-gray-100 p-3 dark:border-gray-800">
                <div className="relative">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Pesquisar ou começar nova conversa"
                    className="w-full rounded-xl border border-gray-200 bg-gray-50 py-2.5 pl-10 pr-3 text-sm text-gray-800 placeholder:text-gray-400 focus:border-green-400 focus:bg-white focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 dark:focus:bg-gray-700"
                  />
                </div>

                <div className="mt-2 flex flex-wrap gap-1.5">
                  <button
                    onClick={() => handleQuickFilter("all")}
                    className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${
                      quickFilter === "all"
                        ? "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
                    }`}
                  >
                    Tudo
                  </button>
                  <button
                    onClick={() => handleQuickFilter("unread")}
                    className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${
                      quickFilter === "unread"
                        ? "bg-green-500 text-white"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
                    }`}
                  >
                    Não lidas
                  </button>
                  <button
                    onClick={() => handleQuickFilter("whatsapp")}
                    className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${
                      quickFilter === "whatsapp"
                        ? "bg-green-500 text-white"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
                    }`}
                  >
                    <Phone size={14} /> WA {waCnt}
                  </button>
                  <button
                    onClick={() => handleQuickFilter("instagram")}
                    className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${
                      quickFilter === "instagram"
                        ? "bg-gradient-to-r from-purple-500 to-pink-500 text-white"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
                    }`}
                  >
                    <Instagram size={14} /> IG {igCnt}
                  </button>
                </div>
              </div>

              <div className="border-b border-gray-100 px-3 py-2 dark:border-gray-800">
                <div className="mb-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                  <Tag size={14} /> Etiquetas
                </div>
                <div className="flex gap-1 overflow-x-auto pb-1">
                  <button
                    onClick={() => setTagFilter("all")}
                    className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition ${
                      tagFilter === "all"
                        ? "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900"
                        : "bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400"
                    }`}
                  >
                    Todas
                  </button>
                  {availableTags.map((tag) => (
                    <button
                      key={tag}
                      onClick={() => setTagFilter(tag)}
                      className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition ${
                        tagFilter === tag
                          ? "bg-blue-500 text-white"
                          : "bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400"
                      }`}
                    >
                      #{tag}
                    </button>
                  ))}
                  {availableTags.length === 0 && (
                    <span className="py-0.5 text-[11px] text-gray-400 dark:text-gray-500">
                      Sem etiquetas ainda
                    </span>
                  )}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto">
                {filteredLeads.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-2 p-8 text-center text-sm text-gray-400 dark:text-gray-600">
                    <MessageCircle size={28} className="opacity-40" />
                    Nenhuma conversa encontrada
                  </div>
                ) : (
                  filteredLeads.map((lead) => (
                    <ConversationItem
                      key={lead.id}
                      lead={lead}
                      selected={lead.id === selectedLeadId}
                      onClick={() => handleSelectLead(lead.id)}
                      onDiscard={() => handleDiscard(lead.id)}
                    />
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        <div
          className={`flex flex-1 flex-col overflow-hidden ${
            workspaceTab === "conversas"
              ? (isMobileWithChatOpen ? "flex" : "hidden md:flex")
              : "flex"
          }`}
        >
          {workspaceTab === "conversas" && (
            <>
              {selectedLead ? (
                <>
                  <div className="border-b border-gray-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-[#111b21]">
                    <div className="flex items-start gap-3">
                      <button
                        onClick={() => setSelectedLeadId(null)}
                        className="rounded-full p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 md:hidden"
                      >
                        <ArrowLeft size={18} />
                      </button>

                      <div
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${
                          selectedLead.channel === "whatsapp" ? "bg-green-500" : "bg-gradient-to-br from-purple-500 to-pink-500"
                        }`}
                      >
                        {selectedLead.name.charAt(0).toUpperCase()}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate font-semibold text-gray-900 dark:text-gray-100">{selectedLead.name}</p>
                          {selectedLead.channel === "whatsapp" ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-bold text-green-700 dark:bg-green-900/30 dark:text-green-400">
                              <Phone size={10} />WA
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 px-2 py-0.5 text-[11px] font-bold text-white">
                              <Instagram size={10} />IG
                            </span>
                          )}
                        </div>

                        <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                          {selectedLead.serviceType}
                          {selectedLead.phone && ` • ${selectedLead.phone}`}
                          {selectedLead.instagramHandle && ` • ${selectedLead.instagramHandle}`}
                        </p>

                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          {selectedLead.tags.length > 0 ? selectedLead.tags.map((tag) => (
                            <button
                              key={tag}
                              onClick={() => handleRemoveTagFromLead(selectedLead.id, tag)}
                              className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700 transition hover:bg-blue-200 dark:bg-blue-900/40 dark:text-blue-300 dark:hover:bg-blue-900/60"
                              title="Remover etiqueta"
                            >
                              #{tag} <X size={10} />
                            </button>
                          )) : (
                            <span className="text-[11px] text-gray-400 dark:text-gray-500">Sem etiquetas</span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <div className="hidden items-center gap-1 rounded-full border border-gray-200 bg-white px-2 py-1 dark:border-gray-700 dark:bg-gray-800 xl:flex">
                          <Tag size={12} className="text-gray-400" />
                          <input
                            value={tagDraft}
                            onChange={(event) => setTagDraft(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                handleAddTagToLead(selectedLead.id, tagDraft);
                                setTagDraft("");
                              }
                            }}
                            placeholder="Nova etiqueta"
                            className="w-24 bg-transparent text-xs text-gray-700 placeholder:text-gray-400 focus:outline-none dark:text-gray-200"
                          />
                          <button
                            onClick={() => {
                              handleAddTagToLead(selectedLead.id, tagDraft);
                              setTagDraft("");
                            }}
                            disabled={!tagDraft.trim()}
                            className="rounded-full bg-blue-500 px-2 py-0.5 text-[10px] font-semibold text-white transition hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-blue-300"
                          >
                            Adicionar
                          </button>
                        </div>

                        <div className="relative">
                          <button
                            onClick={() => setStageSelectorOpen((value) => !value)}
                            className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold transition hover:opacity-80 ${stageBadgeColor(selectedLead.stage)}`}
                          >
                            {stageLabel(selectedLead.stage)}
                            <ChevronDown size={12} />
                          </button>

                          {stageSelectorOpen && (
                            <div className="absolute right-0 top-full z-20 mt-1 min-w-[180px] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-800">
                              <p className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                                Mover para
                              </p>
                              {stageConfig.map((stage) => (
                                <button
                                  key={stage.value}
                                  onClick={() => handleMoveSelectedLeadStage(stage.value)}
                                  className={`flex w-full items-center gap-2 px-3 py-2.5 text-sm transition hover:bg-gray-50 dark:hover:bg-gray-700 ${
                                    selectedLead.stage === stage.value
                                      ? "font-bold text-blue-600 dark:text-blue-400"
                                      : "text-gray-700 dark:text-gray-200"
                                  }`}
                                >
                                  {selectedLead.stage === stage.value ? (
                                    <Check size={14} className="text-blue-500" />
                                  ) : (
                                    <span className="w-3.5" />
                                  )}
                                  {stage.label}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>

                        <button
                          onClick={() => openEdit(selectedLead)}
                          className="rounded-full p-2 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700"
                          title="Editar lead"
                        >
                          <Edit2 size={16} />
                        </button>

                        <button
                          onClick={() => setSelectedLeadId(null)}
                          className="hidden rounded-full p-2 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700 md:flex"
                          title="Fechar conversa"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="flex shrink-0 border-b border-gray-100 bg-white dark:border-gray-800 dark:bg-[#111b21]">
                    {(["chat", "dados"] as const).map((tab) => (
                      <button
                        key={tab}
                        onClick={() => setActiveDetailTab(tab)}
                        className={`flex-1 px-4 py-2.5 text-sm font-semibold transition ${
                          activeDetailTab === tab
                            ? "border-b-2 border-green-500 text-green-600 dark:text-green-400"
                            : "text-gray-500 hover:text-gray-700 dark:text-gray-400"
                        }`}
                      >
                        {tab === "chat" ? "Conversa" : "Dados"}
                      </button>
                    ))}
                  </div>

                  {activeDetailTab === "chat" ? (
                    <div className="flex min-h-0 flex-1 flex-col bg-[#f2eee8] dark:bg-[#0b141a]">
                      <div className="flex-1 overflow-y-auto p-4">
                        <ChatMessages messages={selectedLead.messages} />
                      </div>
                      <div className="shrink-0 border-t border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-[#111b21]">
                        <QuickReplies replies={quickReplies} onSelect={setDraft} />
                        <div className="mt-2">
                          <ChatInput value={draft} onChange={setDraft} onSend={handleSendMessage} />
                        </div>
                        {selectedLead.channel === "whatsapp" && !waConnected && (
                          <p className="mt-1.5 text-center text-[11px] text-amber-600 dark:text-amber-400">
                            WhatsApp desconectado. Mensagens em modo demo. {" "}
                            <button onClick={() => setConnectOpen(true)} className="underline">
                              Conectar
                            </button>
                          </p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="flex-1 overflow-y-auto bg-[#f7f7f8] p-4 dark:bg-[#0b141a]">
                      <LeadPanelDados
                        lead={selectedLead}
                        stageLabel={stageLabel(selectedLead.stage)}
                        onAddTag={(tag) => handleAddTagToLead(selectedLead.id, tag)}
                        onRemoveTag={(tag) => handleRemoveTagFromLead(selectedLead.id, tag)}
                      />
                    </div>
                  )}
                </>
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-[#f2f6f4] text-center text-gray-400 dark:bg-[#0b141a] dark:text-gray-600">
                  <MessageCircle size={48} className="opacity-30" />
                  <p className="text-base font-semibold">WhatsApp Business</p>
                  <p className="text-sm">Selecione uma conversa para começar.</p>
                </div>
              )}
            </>
          )}

          {workspaceTab === "kanban" && (
            <div className="flex min-h-0 flex-1 overflow-x-auto p-4">
              <div className="flex h-full min-w-max gap-3">
                {stageConfig.map((stage) => {
                  const stageLeads = leadsByStage.get(stage.value) || [];
                  return (
                    <div
                      key={stage.value}
                      className="flex w-72 min-w-[260px] flex-col rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
                    >
                      <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2.5 dark:border-gray-700">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${stage.color}`}>
                          {stage.label}
                        </span>
                        <span className="text-xs font-semibold text-gray-400">{stageLeads.length}</span>
                      </div>

                      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
                        {stageLeads.length === 0 && (
                          <p className="py-4 text-center text-xs text-gray-400">Nenhum lead</p>
                        )}

                        {stageLeads.map((lead) => (
                          <button
                            key={lead.id}
                            onClick={() => {
                              setWorkspaceTab("conversas");
                              handleSelectLead(lead.id);
                            }}
                            className="w-full rounded-lg border border-gray-100 bg-gray-50 p-3 text-left transition hover:border-blue-300 hover:bg-blue-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-blue-600 dark:hover:bg-blue-900/20"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
                                {lead.name}
                              </span>
                              {(lead.unreadCount ?? 0) > 0 && (
                                <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-green-500 px-1 text-[10px] font-bold text-white">
                                  {lead.unreadCount}
                                </span>
                              )}
                            </div>

                            <p className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">
                              {lead.messages.at(-1)?.content || "Sem mensagens"}
                            </p>

                            <div className="mt-2">
                              <select
                                value={lead.stage}
                                onChange={(event) => {
                                  event.stopPropagation();
                                  moveLeadToStage(lead.id, event.target.value as PipelineStage);
                                }}
                                onClick={(event) => event.stopPropagation()}
                                className="w-full rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-600 focus:border-blue-400 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                              >
                                {stageConfig.map((option) => (
                                  <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                              </select>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {workspaceTab === "analise" && (
            <div className="flex-1 overflow-y-auto p-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
                  <p className="text-[11px] font-semibold uppercase text-gray-500 dark:text-gray-400">Leads no funil</p>
                  <p className="mt-1 text-xl font-bold text-gray-900 dark:text-gray-100">{analytics.openLeads.length}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{formatCurrency(analytics.potentialValue)}</p>
                </div>

                <div className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
                  <p className="text-[11px] font-semibold uppercase text-gray-500 dark:text-gray-400">Conversão</p>
                  <p className="mt-1 text-xl font-bold text-gray-900 dark:text-gray-100">{analytics.conversionRate.toFixed(1)}%</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">ganhos / fechados</p>
                </div>

                <div className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
                  <p className="text-[11px] font-semibold uppercase text-gray-500 dark:text-gray-400">Fechados ganho</p>
                  <p className="mt-1 text-xl font-bold text-green-600 dark:text-green-400">{analytics.wonLeads.length}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{formatCurrency(analytics.wonLeads.reduce((sum, lead) => sum + (lead.estimatedValue || 0), 0))}</p>
                </div>

                <div className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
                  <p className="text-[11px] font-semibold uppercase text-gray-500 dark:text-gray-400">Perdidos</p>
                  <p className="mt-1 text-xl font-bold text-red-600 dark:text-red-400">{analytics.lostLeads.length}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{formatCurrency(analytics.lostLeads.reduce((sum, lead) => sum + (lead.estimatedValue || 0), 0))}</p>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
                <div className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
                  <div className="mb-3 flex items-center gap-2">
                    <Target size={15} className="text-gray-500" />
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Etapas do funil</h3>
                  </div>
                  <div className="space-y-2">
                    {analytics.byStage.map((item) => {
                      const percent = activeLeads.length > 0 ? (item.count / activeLeads.length) * 100 : 0;
                      return (
                        <div key={item.stage.value}>
                          <div className="mb-1 flex items-center justify-between text-xs">
                            <span className="font-medium text-gray-600 dark:text-gray-300">{item.stage.label}</span>
                            <span className="text-gray-400">{item.count}</span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
                            <div
                              className="h-full rounded-full bg-gray-900 dark:bg-white"
                              style={{ width: `${Math.min(percent, 100)}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
                  <div className="mb-3 flex items-center gap-2">
                    <Flame size={15} className="text-orange-500" />
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Oportunidades quentes</h3>
                  </div>

                  <div className="space-y-2">
                    {analytics.hotLeads.length === 0 && (
                      <p className="text-xs text-gray-400 dark:text-gray-500">Nenhum lead em estágio avançado.</p>
                    )}
                    {analytics.hotLeads.map((lead) => (
                      <button
                        key={lead.id}
                        onClick={() => {
                          setWorkspaceTab("conversas");
                          handleSelectLead(lead.id);
                        }}
                        className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-left transition hover:border-green-300 hover:bg-green-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-green-600 dark:hover:bg-green-900/20"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs font-semibold text-gray-900 dark:text-gray-100">{lead.name}</span>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${stageBadgeColor(lead.stage)}`}>
                            {stageLabel(lead.stage)}
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                          Potencial {formatCurrency(lead.estimatedValue || 0)}
                        </p>
                      </button>
                    ))}
                  </div>

                  <div className="mt-4 rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900">
                    <div className="flex items-center gap-2">
                      <TrendingUp size={15} className="text-emerald-500" />
                      <p className="text-xs text-gray-600 dark:text-gray-300">
                        Acompanhe as etapas no Kanban e concentre follow-up nos leads quentes para aumentar a taxa de fechamento.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {stageSelectorOpen && (
        <div className="fixed inset-0 z-10" onClick={() => setStageSelectorOpen(false)} />
      )}

      <LeadEditModal
        open={editOpen}
        lead={editingLead}
        stages={stageConfig.map((stage) => stage.value)}
        onClose={() => {
          setEditOpen(false);
          setEditingLead(null);
        }}
        onSave={handleSaveLead}
        onDelete={handleDeleteLead}
      />

      <ConnectChannelModal
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
        onStatusChange={(channel, connected) => {
          if (channel === "whatsapp") {
            setWaConnected((prev) => {
              if (!prev && connected) {
                authFetch("/api/whatsapp/sync-history", { method: "POST" }).catch(() => {});
              }
              return connected;
            });
          }
          if (channel === "instagram") setIgConnected(connected);
        }}
      />
    </div>
  );
}

interface ConversationItemProps {
  lead: Lead;
  selected: boolean;
  onClick: () => void;
  onDiscard: () => void;
}

const ConversationItem: React.FC<ConversationItemProps> = ({
  lead,
  selected,
  onClick,
  onDiscard,
}) => {
  const lastMessage = lead.messages[lead.messages.length - 1];
  const isWhatsapp = lead.channel === "whatsapp";

  return (
    <div
      onClick={onClick}
      className={`group relative cursor-pointer border-b border-gray-100 px-4 py-3 transition hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800 ${
        selected ? "bg-green-50 dark:bg-green-900/20" : ""
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${
            isWhatsapp ? "bg-green-500" : "bg-gradient-to-br from-purple-500 to-pink-500"
          }`}
        >
          {lead.name.charAt(0).toUpperCase()}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-1">
            <p className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">{lead.name}</p>
            <div className="flex shrink-0 items-center gap-1">
              <span className="text-[11px] text-gray-400 dark:text-gray-500">{timeAgo(lead.updatedAt)}</span>
              {lead.unreadCount > 0 && (
                <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-green-500 px-1 text-[10px] font-bold text-white">
                  {lead.unreadCount}
                </span>
              )}
            </div>
          </div>

          <div className="mt-0.5 flex items-center gap-1.5">
            <span className="shrink-0 text-[10px] font-semibold text-gray-400 dark:text-gray-500">
              {isWhatsapp ? "WA" : "IG"}
            </span>
            <span className="truncate text-xs text-gray-500 dark:text-gray-400">
              {lastMessage ? lastMessage.content : lead.serviceType}
            </span>
          </div>

          {lead.tags.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {lead.tags.slice(0, 2).map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-500 dark:bg-gray-700 dark:text-gray-300"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <button
        onClick={(event) => {
          event.stopPropagation();
          onDiscard();
        }}
        title="Arquivar lead"
        className="absolute right-2 top-2 hidden rounded-full p-1 text-gray-300 transition hover:bg-red-50 hover:text-red-500 group-hover:flex dark:text-gray-600 dark:hover:bg-red-900/20"
      >
        <X size={13} />
      </button>
    </div>
  );
};
