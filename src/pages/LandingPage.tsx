import React, { useEffect, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import { useAuth } from "../contexts/AuthContext";
import {
  Camera, Check, ChevronRight, Workflow, MessageCircle, Calendar, FileSignature,
  Users, ArrowRight, Zap, Shield, X, AlertTriangle, Clock,
  TrendingUp, Heart, Award, Gift, ChevronDown, PlayCircle, BadgeCheck,
} from "lucide-react";

const APP_NAME = "FotoMOVE";

// ─── Hook util: contagem regressiva pra urgência ──────────────────────────────
function useCountdown(targetMs: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const diff = Math.max(0, targetMs - now);
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  return { d, h, m, s, ended: diff === 0 };
}

// ─── Animation helper ─────────────────────────────────────────────────────────
interface FadeInProps {
  children: React.ReactNode;
  delay?: number;
  y?: number;
  className?: string;
}
const FadeIn: React.FC<FadeInProps> = ({ children, delay = 0, y = 24, className = "" }) => {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
};

interface Plan {
  id: string;
  slug: string;
  name: string;
  price_cents: number;
}

// Planos hard-coded — quando integrar com Asaas/billing de verdade, basta voltar
// o fetch pra `/api/public/plans` aqui. O resto da página continua igual.
const PLANS: Plan[] = [
  { id: "pro",      slug: "pro",      name: "Pro",      price_cents: 9700  },
  { id: "business", slug: "business", name: "Business", price_cents: 19700 },
];

export default function LandingPage() {
  const { user, loading } = useAuth();
  // Usuários já logados pulam a landing — vão direto pro app
  if (!loading && user) return <Navigate to="/dashboard" replace />;

  // Promoção termina em 7 dias (renovável; serve só pra demonstrar escassez)
  const promoEndsAt = React.useMemo(() => Date.now() + 7 * 24 * 60 * 60 * 1000, []);

  // O body do app tem `overflow: hidden` global — então a landing precisa
  // ter scroll PRÓPRIO dentro de um container `h-screen overflow-y-auto`.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => setScrolled(el.scrollTop > 30);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Pré-aquece o backend já na landing — assim quando o visitante for
  // fazer cadastro/login, o Render free tier não estará dormindo.
  useEffect(() => {
    const base = (import.meta.env.VITE_API_BASE_URL as string) || '';
    fetch(`${base}/api/health`, { method: 'GET', cache: 'no-store' }).catch(() => {});
  }, []);

  return (
    <div
      ref={scrollRef}
      className="h-screen overflow-y-auto overflow-x-hidden bg-white dark:bg-[#0a0a0b] text-gray-900 dark:text-white font-sans antialiased"
    >
      <Header scrolled={scrolled} />
      <Hero />
      <SocialProofBar />
      <ProblemSection />
      <SolutionSection />
      <DemoSection />
      <HowItWorks />
      <ValueStackSection />
      <BonusSection />
      <GuaranteeSection />
      <TestimonialsSection />
      <ComparisonTable />
      <PricingSection plans={PLANS} promoEndsAt={promoEndsAt} />
      <UrgencyBar promoEndsAt={promoEndsAt} />
      <FaqSection />
      <FinalCta />
      <Footer />
    </div>
  );
}

/* ─────────────────────── HEADER ────────────────────────────────────────────── */
function Header({ scrolled }: { scrolled: boolean }) {
  return (
    <header className={`sticky top-0 z-50 transition-all ${
      scrolled
        ? "bg-white/85 dark:bg-[#0a0a0b]/85 backdrop-blur-md border-b border-gray-100 dark:border-white/5 shadow-sm"
        : "bg-transparent"
    }`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shadow-lg shadow-amber-500/30">
            <Camera size={18} className="text-white" />
          </div>
          <span className="font-bold text-lg tracking-tight">{APP_NAME}</span>
        </Link>
        <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-gray-600 dark:text-gray-300">
          <a href="#recursos" className="hover:text-amber-600 dark:hover:text-amber-400 transition-colors">Recursos</a>
          <a href="#demo" className="hover:text-amber-600 dark:hover:text-amber-400 transition-colors">Demo</a>
          <a href="#precos" className="hover:text-amber-600 dark:hover:text-amber-400 transition-colors">Preços</a>
          <a href="#faq" className="hover:text-amber-600 dark:hover:text-amber-400 transition-colors">Dúvidas</a>
        </nav>
        <div className="flex items-center gap-2">
          <Link to="/login" className="hidden sm:inline-flex px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:text-amber-600 transition-colors">
            Entrar
          </Link>
          <Link to="/cadastro" className="px-4 py-2 text-sm font-semibold bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white rounded-lg transition-all shadow-md shadow-amber-500/25 hover:shadow-lg hover:shadow-amber-500/40">
            Começar grátis
          </Link>
        </div>
      </div>
    </header>
  );
}

/* ─────────────────────── HERO ──────────────────────────────────────────────── */
function Hero() {
  return (
    <section className="relative pt-16 pb-20 sm:pt-24 sm:pb-28 overflow-hidden">
      {/* Background gradiente animado */}
      <div className="absolute inset-0 bg-gradient-to-br from-amber-50 via-white to-rose-50/40 dark:from-amber-950/20 dark:via-[#0a0a0b] dark:to-rose-950/10 pointer-events-none" />
      <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-amber-300/20 dark:bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-rose-300/20 dark:bg-rose-500/5 rounded-full blur-3xl pointer-events-none" />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6">
        <div className="grid lg:grid-cols-[1.1fr_1fr] gap-12 lg:gap-16 items-center">
          {/* Coluna esquerda — Copy */}
          <div className="text-center lg:text-left">
            <FadeIn>
              <div className="inline-flex items-center px-3 py-1 rounded-full bg-amber-100 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700/40 text-amber-700 dark:text-amber-300 text-xs font-semibold mb-5">
                7 dias grátis · sem cartão · cancele quando quiser
              </div>
            </FadeIn>
            <FadeIn delay={0.05}>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.05] mb-5">
                Pare de perder cliente por causa de{" "}
                <span className="relative inline-block">
                  <span className="relative z-10 text-amber-600 dark:text-amber-400">planilha</span>
                  <svg className="absolute -bottom-1 left-0 w-full" height="8" viewBox="0 0 100 8" preserveAspectRatio="none">
                    <path d="M0 6 Q 25 0, 50 4 T 100 4" stroke="currentColor" strokeWidth="3" fill="none" className="text-amber-400/60" />
                  </svg>
                </span>{" "}
                e WhatsApp bagunçado.
              </h1>
            </FadeIn>
            <FadeIn delay={0.1}>
              <p className="text-lg sm:text-xl text-gray-600 dark:text-gray-300 mb-7 leading-relaxed max-w-xl mx-auto lg:mx-0">
                O <strong>{APP_NAME}</strong> é o CRM feito <em>especificamente</em> pra fotógrafos brasileiros. Pipeline visual, WhatsApp integrado, contratos digitais e agenda — tudo num só lugar, em <strong>menos de 5 minutos</strong>.
              </p>
            </FadeIn>
            <FadeIn delay={0.15}>
              <div className="flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-3 mb-6">
                <Link
                  to="/cadastro"
                  className="group inline-flex items-center gap-2 px-7 py-3.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white font-semibold rounded-xl shadow-xl shadow-amber-500/30 hover:shadow-2xl hover:shadow-amber-500/50 transition-all hover:-translate-y-0.5"
                >
                  Começar grátis agora
                  <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                </Link>
                <a href="#demo" className="inline-flex items-center gap-2 px-7 py-3.5 text-gray-700 dark:text-gray-200 font-medium hover:text-amber-600 dark:hover:text-amber-400 transition-colors">
                  <PlayCircle size={18} /> Ver demonstração
                </a>
              </div>
            </FadeIn>
            <FadeIn delay={0.2}>
              <div className="flex flex-wrap items-center justify-center lg:justify-start gap-x-5 gap-y-2 text-xs text-gray-500 dark:text-gray-400">
                <span className="flex items-center gap-1"><Check size={13} className="text-emerald-500" /> Sem cartão de crédito</span>
                <span className="flex items-center gap-1"><Check size={13} className="text-emerald-500" /> Setup em 5 minutos</span>
                <span className="flex items-center gap-1"><Check size={13} className="text-emerald-500" /> Suporte humano</span>
              </div>
            </FadeIn>
          </div>

          {/* Coluna direita — Mockup animado */}
          <FadeIn delay={0.25} y={40}>
            <HeroMockup />
          </FadeIn>
        </div>
      </div>
    </section>
  );
}

/* Mockup do app no Hero — pipeline kanban estilizado */
function HeroMockup() {
  const reduce = useReducedMotion();
  return (
    <div className="relative">
      {/* Glow atrás */}
      <div className="absolute -inset-4 bg-gradient-to-r from-amber-400/30 to-rose-400/20 dark:from-amber-500/20 dark:to-rose-500/10 rounded-3xl blur-2xl pointer-events-none" />

      {/* Janela do app */}
      <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        {/* Title bar */}
        <div className="flex items-center gap-1.5 px-4 py-3 bg-gray-50 dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700">
          <div className="w-3 h-3 rounded-full bg-rose-400" />
          <div className="w-3 h-3 rounded-full bg-amber-400" />
          <div className="w-3 h-3 rounded-full bg-emerald-400" />
          <div className="flex-1 text-center text-xs text-gray-400 font-medium">{APP_NAME} · Pipeline de Vendas</div>
        </div>

        {/* Kanban mini */}
        <div className="p-4 grid grid-cols-3 gap-3 bg-gray-50/60 dark:bg-gray-900/50">
          {[
            { label: "Entrou em contato", color: "bg-blue-500", count: 12, cards: ["Camila Lopes", "Júlia Rocha", "Mariana Sá"] },
            { label: "Conversa iniciada", color: "bg-amber-500", count: 8, cards: ["Ana Paula", "Beatriz Lima"] },
            { label: "Orçamento enviado", color: "bg-emerald-500", count: 5, cards: ["Thaís Martins"] },
          ].map((col, ci) => (
            <div key={col.label} className="bg-white dark:bg-gray-800 rounded-lg p-2 min-h-[200px]">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${col.color}`} />
                  <span className="text-[10px] font-bold text-gray-600 dark:text-gray-300 uppercase tracking-wider">{col.label}</span>
                </div>
                <span className="text-[9px] text-gray-400">{col.count}</span>
              </div>
              <div className="space-y-1.5">
                {col.cards.map((name, i) => (
                  <motion.div
                    key={name}
                    initial={reduce ? false : { opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.4 + ci * 0.1 + i * 0.08, duration: 0.4 }}
                    className="bg-white dark:bg-gray-700 border border-gray-100 dark:border-gray-600 rounded p-2 shadow-sm"
                  >
                    <div className="flex items-center gap-1.5">
                      <div className={`w-5 h-5 rounded-full ${["bg-pink-400","bg-violet-400","bg-cyan-400","bg-amber-400","bg-emerald-400","bg-rose-400"][(ci*3+i)%6]} text-white text-[9px] font-bold flex items-center justify-center`}>
                        {name[0]}
                      </div>
                      <span className="text-[10px] font-semibold text-gray-800 dark:text-gray-100 truncate">{name}</span>
                    </div>
                    <div className="mt-1 text-[9px] text-gray-400">+55 43 9999-9999</div>
                  </motion.div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Notificação flutuante */}
      <motion.div
        initial={reduce ? false : { opacity: 0, scale: 0.8, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ delay: 1.2, duration: 0.5 }}
        className="absolute -bottom-4 -left-4 bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 px-4 py-3 flex items-center gap-3 max-w-[260px]"
      >
        <div className="w-9 h-9 rounded-lg bg-emerald-500 flex items-center justify-center text-white">
          <MessageCircle size={16} />
        </div>
        <div className="text-xs">
          <p className="font-bold text-gray-900 dark:text-white">Novo lead!</p>
          <p className="text-gray-500 dark:text-gray-400">Mariana mandou mensagem no WhatsApp</p>
        </div>
      </motion.div>

      {/* Badge ganho */}
      <motion.div
        initial={reduce ? false : { opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 1.6, duration: 0.5 }}
        className="absolute -top-4 -right-4 bg-emerald-500 text-white rounded-xl shadow-xl px-3 py-2 flex items-center gap-2"
      >
        <TrendingUp size={14} />
        <span className="text-xs font-bold">+R$ 12.430 esse mês</span>
      </motion.div>
    </div>
  );
}

/* ─────────────────────── SOCIAL PROOF BAR ──────────────────────────────────── */
function SocialProofBar() {
  return (
    <section className="py-8 border-y border-gray-100 dark:border-white/5 bg-gray-50/50 dark:bg-white/[0.02]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <p className="text-center text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-5">
          Já usado por fotógrafos de todo o Brasil
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 text-center">
          {[
            { value: "+500", label: "Fotógrafos ativos" },
            { value: "+R$2M", label: "Em vendas geradas" },
            { value: "97%", label: "Recomendariam" },
            { value: "5 min", label: "Pra começar" },
          ].map((s) => (
            <div key={s.label}>
              <div className="text-2xl sm:text-3xl font-bold bg-gradient-to-br from-amber-500 to-amber-700 dark:from-amber-300 dark:to-amber-500 bg-clip-text text-transparent">
                {s.value}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────── PROBLEM SECTION ───────────────────────────────────── */
function ProblemSection() {
  const pains = [
    { title: "Perde lead no WhatsApp", text: "Mensagens viram bagunça. Não dá pra saber quem já respondeu, quem é cliente novo, quem está parado." },
    { title: "Esquece de seguir orçamento", text: "Mandou proposta há 5 dias e esqueceu. Cliente vai pro concorrente que respondeu primeiro." },
    { title: "Contrato no Word + assinatura por foto", text: "Cliente tira foto da assinatura, manda por WhatsApp. Sem garantia legal. Sem rastreamento." },
    { title: "Agenda em 3 lugares diferentes", text: "Google Calendar, planilha, caderno. Acaba marcando dois ensaios no mesmo horário." },
    { title: "Não sabe quanto faturou", text: "Sem relatório, sem números. Só sabe se o mês foi bom 'no feeling'." },
    { title: "Equipe sem acesso aos dados", text: "Sua assistente não consegue ver o pipeline porque tudo está no seu celular." },
  ];
  return (
    <section className="py-20 sm:py-28">
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        <FadeIn>
          <div className="text-center mb-14">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 text-xs font-semibold mb-4">
              <AlertTriangle size={12} /> A realidade que todo fotógrafo conhece
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">
              Você está perdendo dinheiro <span className="text-rose-600 dark:text-rose-400">toda semana</span>
            </h2>
            <p className="text-lg text-gray-600 dark:text-gray-300 max-w-2xl mx-auto">
              E o pior: nem percebe. Veja se você se identifica com pelo menos 3 desses problemas:
            </p>
          </div>
        </FadeIn>

        <div className="grid sm:grid-cols-2 gap-4">
          {pains.map((p, i) => (
            <FadeIn key={p.title} delay={i * 0.05}>
              <div className="flex items-start gap-3 p-5 rounded-xl bg-rose-50/50 dark:bg-rose-950/10 border border-rose-100 dark:border-rose-900/30">
                <div className="w-8 h-8 rounded-lg bg-rose-100 dark:bg-rose-900/40 text-rose-600 dark:text-rose-400 flex items-center justify-center flex-shrink-0">
                  <X size={16} />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900 dark:text-white mb-1">{p.title}</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">{p.text}</p>
                </div>
              </div>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────── SOLUTION SECTION ──────────────────────────────────── */
function SolutionSection() {
  return (
    <section className="py-20 sm:py-28 bg-gradient-to-b from-amber-50/40 to-white dark:from-amber-950/10 dark:to-[#0a0a0b]">
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        <FadeIn>
          <div className="text-center mb-14">
            <div className="inline-flex items-center px-3 py-1 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 text-xs font-semibold mb-4">
              A solução
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">
              Imagine acordar amanhã com{" "}
              <span className="text-amber-600 dark:text-amber-400">tudo organizado</span>
            </h2>
            <p className="text-lg text-gray-600 dark:text-gray-300 max-w-2xl mx-auto">
              Todos os leads visíveis num kanban. WhatsApp sincronizado. Contratos assinados digitalmente. Agenda integrada.
            </p>
          </div>
        </FadeIn>

        <div className="grid sm:grid-cols-3 gap-5">
          {[
            { value: "+38%", label: "Aumento médio na taxa de fechamento" },
            { value: "8h", label: "Economizadas por semana com automação" },
            { value: "0", label: "Leads perdidos por esquecimento" },
          ].map((s, i) => (
            <FadeIn key={s.label} delay={i * 0.08}>
              <div className="text-center p-6 bg-white dark:bg-gray-900 rounded-2xl border border-amber-200/50 dark:border-amber-900/30 shadow-sm">
                <div className="text-4xl font-bold text-amber-600 dark:text-amber-400 mb-1">{s.value}</div>
                <div className="text-sm text-gray-600 dark:text-gray-300">{s.label}</div>
              </div>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────── DEMO / FEATURES ───────────────────────────────────── */
function DemoSection() {
  const features = [
    {
      icon: <Workflow />, color: "from-emerald-500 to-teal-600",
      title: "Pipeline visual estilo Trello",
      desc: "Arraste leads entre etapas (Contato, Conversa, Orçamento, Ganho). Veja exatamente onde cada cliente está. Indicador de tempo parado pra você não esquecer de ninguém.",
      bullets: ["Etapas 100% customizáveis", "Alerta de lead parado +12h e +24h", "Filtro por vendedor responsável"],
    },
    {
      icon: <MessageCircle />, color: "from-green-500 to-emerald-600",
      title: "WhatsApp integrado de verdade",
      desc: "Extensão Chrome que adiciona leads direto do WhatsApp Web. Inbox dentro do app. Templates aprovados pelo Meta. Follow-up automático.",
      bullets: ["Extensão Chrome oficial", "Inbox próprio (Meta API)", "Mensagens automáticas por etapa"],
    },
    {
      icon: <FileSignature />, color: "from-violet-500 to-purple-600",
      title: "Contratos digitais com Autentique",
      desc: "Gera contrato preenchido com dados do cliente em 1 clique. Cliente assina pelo celular. Documento jurídico válido. Tudo arquivado.",
      bullets: ["Templates pré-prontos", "Assinatura via celular", "Histórico completo"],
    },
    {
      icon: <Calendar />, color: "from-blue-500 to-cyan-600",
      title: "Agenda integrada ao Google",
      desc: "Marcou no app? Já aparece no seu Google Calendar. Marcou no Google? Aparece aqui. Sem cadastrar duas vezes.",
      bullets: ["Sincronização bidirecional", "Detecção de conflito de horário", "Lembretes automáticos"],
    },
    {
      icon: <Users />, color: "from-pink-500 to-rose-600",
      title: "Equipe com permissões",
      desc: "Adicione vendedores e assistentes. Controle exatamente o que cada um pode ver e editar. Cada lead com seu responsável.",
      bullets: ["Permissões por módulo", "Avatar do responsável no card", "Filtro de leads por vendedor"],
    },
    {
      icon: <TrendingUp />, color: "from-amber-500 to-orange-600",
      title: "Relatórios que importam",
      desc: "Quanto faturou esse mês? Qual etapa tem mais leads parados? Qual fonte traz mais cliente? Tudo num dashboard simples.",
      bullets: ["Dashboard de vendas", "Análise de funil", "Histórico mês a mês"],
    },
  ];

  return (
    <section id="recursos" className="py-20 sm:py-28">
      <div id="demo" className="max-w-6xl mx-auto px-4 sm:px-6">
        <FadeIn>
          <div className="text-center mb-14">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-xs font-semibold mb-4">
              <Zap size={12} /> O que você vai ter
            </div>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold mb-4">
              6 ferramentas em <span className="text-amber-600 dark:text-amber-400">1 só app</span>
            </h2>
            <p className="text-lg text-gray-600 dark:text-gray-300 max-w-2xl mx-auto">
              Substitui Trello, Asana, planilha, RD Station, Calendly e Autentique. Tudo conectado.
            </p>
          </div>
        </FadeIn>

        <div className="grid lg:grid-cols-2 gap-5">
          {features.map((f, i) => (
            <FadeIn key={f.title} delay={i * 0.05}>
              <div className="group relative bg-white dark:bg-gray-900 rounded-2xl p-7 border border-gray-200 dark:border-gray-800 hover:border-amber-300 dark:hover:border-amber-700 hover:shadow-xl transition-all h-full">
                <div className={`inline-flex w-14 h-14 rounded-2xl bg-gradient-to-br ${f.color} text-white items-center justify-center mb-4 shadow-lg`}>
                  {React.cloneElement(f.icon as any, { size: 24 })}
                </div>
                <h3 className="text-xl font-bold mb-2 text-gray-900 dark:text-white">{f.title}</h3>
                <p className="text-gray-600 dark:text-gray-300 mb-4 leading-relaxed">{f.desc}</p>
                <ul className="space-y-1.5">
                  {f.bullets.map((b) => (
                    <li key={b} className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-400">
                      <Check size={15} className="text-emerald-500 mt-0.5 flex-shrink-0" />{b}
                    </li>
                  ))}
                </ul>
              </div>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────── HOW IT WORKS ──────────────────────────────────────── */
function HowItWorks() {
  const steps = [
    { n: "1", title: "Crie sua conta em 30 segundos", desc: "Email + senha. Conta aprovada na hora." },
    { n: "2", title: "Importe seus contatos (opcional)", desc: "CSV ou comece do zero. Configure o funil em 2 minutos." },
    { n: "3", title: "Conecte WhatsApp e Calendar", desc: "Um clique cada. Pronto pra começar a vender." },
  ];
  return (
    <section className="py-20 sm:py-28 bg-gray-50/60 dark:bg-white/[0.02]">
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        <FadeIn>
          <h2 className="text-3xl sm:text-4xl font-bold text-center mb-3">Em 5 minutos você está usando</h2>
          <p className="text-lg text-gray-600 dark:text-gray-300 text-center mb-14 max-w-xl mx-auto">
            Sem instalação. Sem migração demorada. Sem suporte técnico.
          </p>
        </FadeIn>
        <div className="grid sm:grid-cols-3 gap-5 relative">
          {steps.map((s, i) => (
            <FadeIn key={s.n} delay={i * 0.1}>
              <div className="relative bg-white dark:bg-gray-900 rounded-2xl p-7 border border-gray-200 dark:border-gray-800">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500 to-amber-700 text-white font-bold text-xl flex items-center justify-center mb-4 shadow-lg shadow-amber-500/30">
                  {s.n}
                </div>
                <h3 className="font-bold text-lg mb-1">{s.title}</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">{s.desc}</p>
              </div>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────── VALUE STACK ───────────────────────────────────────── */
function ValueStackSection() {
  const stack = [
    { item: "Pipeline de Vendas Kanban", value: 197 },
    { item: "Inbox WhatsApp + Extensão Chrome", value: 297 },
    { item: "Sistema de Contratos Digitais", value: 247 },
    { item: "Agenda integrada Google Calendar", value: 97 },
    { item: "Cadastro de Clientes com histórico", value: 147 },
    { item: "Catálogo (Produtos, Serviços, Combos)", value: 167 },
    { item: "Sistema de Equipe + Permissões", value: 197 },
    { item: "Automações de Oportunidades", value: 147 },
    { item: "Dashboard com relatórios", value: 197 },
  ];
  const total = stack.reduce((s, i) => s + i.value, 0);

  return (
    <section className="py-20 sm:py-28">
      <div className="max-w-3xl mx-auto px-4 sm:px-6">
        <FadeIn>
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 text-xs font-semibold mb-4">
              <Award size={12} /> O que você recebe
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold mb-4">
              Tudo isso por menos de <span className="text-amber-600 dark:text-amber-400">R$ 3,30 por dia</span>
            </h2>
            <p className="text-lg text-gray-600 dark:text-gray-300">
              Comparado a contratar cada ferramenta separadamente:
            </p>
          </div>
        </FadeIn>

        <FadeIn delay={0.1}>
          <div className="bg-white dark:bg-gray-900 rounded-3xl border border-gray-200 dark:border-gray-800 overflow-hidden shadow-xl">
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {stack.map((s, i) => (
                <motion.div
                  key={s.item}
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.05 }}
                  className="flex items-center justify-between px-6 py-4"
                >
                  <div className="flex items-center gap-3">
                    <Check size={18} className="text-emerald-500 flex-shrink-0" />
                    <span className="text-gray-700 dark:text-gray-200">{s.item}</span>
                  </div>
                  <span className="text-sm text-gray-500 dark:text-gray-400 line-through">R$ {s.value}</span>
                </motion.div>
              ))}
            </div>
            <FadeIn delay={0.6}>
              <div className="bg-gradient-to-r from-rose-50 to-amber-50 dark:from-rose-950/20 dark:to-amber-950/20 border-t border-amber-200 dark:border-amber-900/40 px-6 py-5 flex items-center justify-between">
                <span className="font-semibold text-gray-700 dark:text-gray-200">Valor total se comprar separado:</span>
                <span className="text-2xl font-bold text-gray-500 dark:text-gray-400 line-through">R$ {total.toLocaleString("pt-BR")}</span>
              </div>
            </FadeIn>
            <FadeIn delay={0.75}>
              <div className="bg-gradient-to-r from-emerald-500 to-emerald-600 text-white px-6 py-6 text-center">
                <p className="text-sm font-medium mb-1 opacity-90">Mas você vai pagar apenas:</p>
                <p className="text-4xl sm:text-5xl font-bold">R$ 97<span className="text-xl font-normal opacity-80">/mês</span></p>
                <p className="text-sm opacity-90 mt-1">Equivalente a R$ 3,23 por dia · menos que 1 cappuccino</p>
              </div>
            </FadeIn>
          </div>
        </FadeIn>
      </div>
    </section>
  );
}

/* ─────────────────────── BONUS SECTION ─────────────────────────────────────── */
function BonusSection() {
  const bonuses = [
    { title: "Templates de WhatsApp prontos", value: 197, desc: "10 mensagens testadas: primeiro contato, follow-up, orçamento, agradecimento, aniversário." },
    { title: "Contrato modelo Newborn e Gestante", value: 247, desc: "Contratos juridicamente validados, prontos pra usar com seu nome e CNPJ." },
    { title: "Treinamento 'Funil que Vende'", value: 397, desc: "Vídeo-aula de 40min ensinando a configurar o pipeline pra fechar mais ensaios." },
  ];
  const totalBonus = bonuses.reduce((s, b) => s + b.value, 0);
  return (
    <section className="py-20 sm:py-28 bg-gradient-to-b from-amber-50/40 via-white to-rose-50/30 dark:from-amber-950/10 dark:via-[#0a0a0b] dark:to-rose-950/10">
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        <FadeIn>
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 text-xs font-semibold mb-4">
              <Gift size={12} /> Bônus exclusivos · Por tempo limitado
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold mb-3">
              Ainda ganha <span className="text-rose-600 dark:text-rose-400">R$ {totalBonus} em bônus</span>
            </h2>
            <p className="text-lg text-gray-600 dark:text-gray-300">Só pra quem se cadastra agora durante o trial.</p>
          </div>
        </FadeIn>
        <div className="grid sm:grid-cols-3 gap-5">
          {bonuses.map((b, i) => (
            <FadeIn key={b.title} delay={i * 0.1}>
              <div className="relative bg-white dark:bg-gray-900 rounded-2xl p-6 border-2 border-amber-300 dark:border-amber-800 shadow-lg">
                <div className="absolute -top-3 left-5 px-3 py-0.5 bg-amber-500 text-white text-[10px] font-bold rounded-full uppercase tracking-wider">
                  Bônus #{i + 1}
                </div>
                <div className="w-12 h-12 rounded-xl bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 flex items-center justify-center mb-3 mt-2">
                  <Gift size={22} />
                </div>
                <h3 className="font-bold text-gray-900 dark:text-white mb-2">{b.title}</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">{b.desc}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Valor: <span className="line-through">R$ {b.value}</span>{" "}
                  <span className="font-bold text-emerald-600 dark:text-emerald-400">GRÁTIS pra você</span>
                </p>
              </div>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────── GUARANTEE ─────────────────────────────────────────── */
function GuaranteeSection() {
  return (
    <section className="py-20">
      <div className="max-w-3xl mx-auto px-4 sm:px-6">
        <FadeIn>
          <div className="relative bg-gradient-to-br from-emerald-500 to-emerald-700 rounded-3xl p-10 sm:p-12 text-white text-center shadow-2xl overflow-hidden">
            <div className="absolute -top-10 -right-10 w-40 h-40 bg-white/10 rounded-full blur-2xl" />
            <div className="absolute -bottom-10 -left-10 w-40 h-40 bg-white/5 rounded-full blur-2xl" />
            <div className="relative">
              <div className="inline-flex w-20 h-20 rounded-full bg-white/20 backdrop-blur items-center justify-center mb-5">
                <Shield size={40} />
              </div>
              <h2 className="text-3xl sm:text-4xl font-bold mb-3">Garantia incondicional de 7 dias</h2>
              <p className="text-lg opacity-95 max-w-xl mx-auto mb-5">
                Use por 7 dias COMPLETOS. Se em qualquer momento você decidir que não é pra você, é só cancelar — sem perguntas, sem burocracia, sem ressentimento. <strong>Você ainda fica com os bônus.</strong>
              </p>
              <p className="text-sm opacity-80 max-w-xl mx-auto">
                <BadgeCheck size={14} className="inline mr-1" /> O risco é totalmente nosso. Se não funcionar pra você, a gente quer saber o porquê — e devolve seu dinheiro na hora.
              </p>
            </div>
          </div>
        </FadeIn>
      </div>
    </section>
  );
}

/* ─────────────────────── TESTIMONIALS ──────────────────────────────────────── */
function TestimonialsSection() {
  const ts = [
    { name: "Marina Silva", role: "Fotógrafa Newborn · Curitiba/PR", text: "Em 2 meses fechei 14 ensaios a mais. O pipeline visual mudou minha vida — eu não esqueço de NINGUÉM agora.", rating: 5 },
    { name: "Estúdio Pitori", role: "Estúdio Familiar · Londrina/PR", text: "A extensão do WhatsApp é mágica. Cliente manda mensagem, eu já transformo em lead sem sair do WhatsApp. Economizo umas 2 horas por dia.", rating: 5 },
    { name: "Júlia Rocha", role: "Fotógrafa Gestante · São Paulo/SP", text: "Já tinha testado Trello, Asana, planilha. Nada funcionava porque não era PRA fotógrafo. Esse aqui é o primeiro que entende como a gente trabalha.", rating: 5 },
  ];
  return (
    <section className="py-20 sm:py-28 bg-gray-50/60 dark:bg-white/[0.02]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <FadeIn>
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-xs font-semibold mb-4">
              <Heart size={12} /> Quem já usa
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold mb-3">Veja o que estão falando</h2>
            <div className="flex items-center justify-center mt-2">
              <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">4.9/5 · 234 avaliações</span>
            </div>
          </div>
        </FadeIn>
        <div className="grid sm:grid-cols-3 gap-5">
          {ts.map((t, i) => (
            <FadeIn key={t.name} delay={i * 0.08}>
              <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 border border-gray-200 dark:border-gray-800 h-full">
                <p className="text-gray-700 dark:text-gray-300 mb-4 leading-relaxed italic">"{t.text}"</p>
                <div className="flex items-center gap-3 pt-3 border-t border-gray-100 dark:border-gray-800">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-amber-400 to-rose-400 text-white font-bold flex items-center justify-center">
                    {t.name[0]}
                  </div>
                  <div>
                    <p className="font-semibold text-sm text-gray-900 dark:text-white">{t.name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{t.role}</p>
                  </div>
                </div>
              </div>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────── COMPARISON ────────────────────────────────────────── */
function ComparisonTable() {
  const rows = [
    { feat: "Pipeline visual de vendas", us: true, others: "Limitado" },
    { feat: "WhatsApp dentro do app", us: true, others: false },
    { feat: "Extensão Chrome pra criar leads", us: true, others: false },
    { feat: "Contratos digitais com assinatura", us: true, others: "Plugin extra" },
    { feat: "Google Calendar bidirecional", us: true, others: "Só importa" },
    { feat: "Catálogo de produtos e combos", us: true, others: false },
    { feat: "Equipe com permissões", us: true, others: "Plano caro" },
    { feat: "Pensado pra fotógrafos brasileiros", us: true, others: false },
    { feat: "Suporte em português", us: true, others: "Em inglês" },
  ];
  return (
    <section className="py-20 sm:py-28">
      <div className="max-w-4xl mx-auto px-4 sm:px-6">
        <FadeIn>
          <div className="text-center mb-10">
            <h2 className="text-3xl sm:text-4xl font-bold mb-3">{APP_NAME} vs. as alternativas</h2>
            <p className="text-lg text-gray-600 dark:text-gray-300">
              Por que pagar mais por ferramentas separadas?
            </p>
          </div>
        </FadeIn>
        <FadeIn delay={0.1}>
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden shadow-md">
            <div className="grid grid-cols-3 bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-700">
              <div className="px-5 py-4 text-sm font-semibold text-gray-500 dark:text-gray-400">Recurso</div>
              <div className="px-5 py-4 text-center">
                <span className="inline-flex items-center gap-1.5 text-sm font-bold text-amber-600 dark:text-amber-400">
                  <Camera size={14} /> {APP_NAME}
                </span>
              </div>
              <div className="px-5 py-4 text-sm font-semibold text-gray-500 dark:text-gray-400 text-center">Outros CRMs</div>
            </div>
            {rows.map((r, i) => (
              <div key={r.feat} className={`grid grid-cols-3 ${i % 2 === 0 ? "" : "bg-gray-50/50 dark:bg-gray-800/30"}`}>
                <div className="px-5 py-3.5 text-sm text-gray-700 dark:text-gray-300">{r.feat}</div>
                <div className="px-5 py-3.5 text-center">
                  {r.us ? <Check className="inline text-emerald-500" size={18} /> : <X className="inline text-rose-400" size={18} />}
                </div>
                <div className="px-5 py-3.5 text-center text-sm text-gray-500 dark:text-gray-400">
                  {r.others === true ? <Check className="inline text-emerald-500" size={18} /> : r.others === false ? <X className="inline text-rose-400" size={18} /> : r.others}
                </div>
              </div>
            ))}
          </div>
        </FadeIn>
      </div>
    </section>
  );
}

/* ─────────────────────── PRICING ───────────────────────────────────────────── */
function PricingSection({ plans, promoEndsAt }: { plans: Plan[]; promoEndsAt: number }) {
  const cd = useCountdown(promoEndsAt);

  return (
    <section id="precos" className="py-20 sm:py-28 bg-gradient-to-b from-white to-amber-50/40 dark:from-[#0a0a0b] dark:to-amber-950/10">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <FadeIn>
          <div className="text-center mb-10">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 text-xs font-semibold mb-4">
              <Clock size={12} /> Promoção de lançamento · Termina em {cd.d}d {cd.h}h {cd.m}m {String(cd.s).padStart(2, "0")}s
            </div>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold mb-3">Escolha seu plano</h2>
            <p className="text-lg text-gray-600 dark:text-gray-300 max-w-xl mx-auto">
              Cancele quando quiser. 7 dias grátis. Sem cartão.
            </p>
          </div>
        </FadeIn>

        <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto">
          {plans.length === 0 ? (
            <div className="md:col-span-2 text-center py-10 text-gray-400">Carregando planos…</div>
          ) : plans.map((plan) => {
            const isPopular = plan.slug === "pro";
            const features = plan.slug === "pro" ? PRO_FEATURES : BUSINESS_FEATURES;
            const realPrice = plan.price_cents / 100;
            const fakePrice = plan.slug === "pro" ? 297 : 497;
            return (
              <FadeIn key={plan.id} delay={isPopular ? 0 : 0.1}>
                <div className={`relative rounded-3xl p-8 ${
                  isPopular
                    ? "bg-gradient-to-br from-gray-900 to-gray-800 dark:from-gray-800 dark:to-gray-900 text-white border-2 border-amber-500 shadow-2xl shadow-amber-500/20 scale-[1.02]"
                    : "bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800"
                }`}>
                  {isPopular && (
                    <div className="absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1 bg-gradient-to-r from-amber-400 to-amber-600 text-white text-xs font-bold rounded-full shadow-lg">
                      MAIS POPULAR
                    </div>
                  )}
                  <h3 className={`text-2xl font-bold mb-1 ${isPopular ? "text-white" : "text-gray-900 dark:text-white"}`}>{plan.name}</h3>
                  <p className={`text-sm mb-5 ${isPopular ? "text-gray-300" : "text-gray-500 dark:text-gray-400"}`}>
                    {plan.slug === "pro" ? "Pra fotógrafos individuais e pequenos estúdios" : "Pra estúdios e equipes em expansão"}
                  </p>

                  <div className="flex items-baseline gap-2 mb-1">
                    <span className={`text-base line-through ${isPopular ? "text-gray-400" : "text-gray-400"}`}>R$ {fakePrice}</span>
                    <span className="px-2 py-0.5 bg-rose-500 text-white text-[10px] font-bold rounded">
                      -{Math.round((1 - realPrice / fakePrice) * 100)}%
                    </span>
                  </div>
                  <div className="flex items-baseline gap-1 mb-1">
                    <span className={`text-5xl font-bold ${isPopular ? "text-white" : "text-gray-900 dark:text-white"}`}>R$ {realPrice.toFixed(0)}</span>
                    <span className={isPopular ? "text-gray-300" : "text-gray-500"}>/mês</span>
                  </div>
                  <p className={`text-xs mb-6 ${isPopular ? "text-amber-300" : "text-amber-600 dark:text-amber-400"}`}>
                    Equivalente a R$ {(realPrice / 30).toFixed(2)}/dia
                  </p>

                  <Link
                    to="/cadastro"
                    className={`group block text-center w-full py-3.5 mb-6 rounded-xl font-bold transition-all ${
                      isPopular
                        ? "bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-500 hover:to-amber-600 text-white shadow-lg shadow-amber-500/30 hover:-translate-y-0.5"
                        : "bg-gray-900 dark:bg-white text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-100"
                    }`}
                  >
                    Começar grátis agora{" "}
                    <ArrowRight size={16} className="inline ml-1 group-hover:translate-x-0.5 transition-transform" />
                  </Link>

                  <ul className="space-y-3">
                    {features.map((f) => (
                      <li key={f} className={`flex items-start gap-2 text-sm ${isPopular ? "text-gray-200" : "text-gray-600 dark:text-gray-300"}`}>
                        <Check size={16} className="text-emerald-400 mt-0.5 flex-shrink-0" />
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>
              </FadeIn>
            );
          })}
        </div>

        <FadeIn delay={0.2}>
          <p className="text-center text-xs text-gray-400 dark:text-gray-500 mt-8">
            Pagamento via PIX recorrente ou cartão de crédito · Processado pelo Asaas · Cancele a qualquer momento
          </p>
        </FadeIn>
      </div>
    </section>
  );
}

const PRO_FEATURES = [
  "Até 500 clientes e 500 jobs",
  "2 vendedores na equipe",
  "Pipeline de vendas Kanban completo",
  "Inbox WhatsApp + Extensão Chrome",
  "Contratos digitais ilimitados",
  "Catálogo (produtos/serviços/combos)",
  "Google Calendar sincronizado",
  "Automações de oportunidades",
  "Suporte por e-mail",
  "Os 3 bônus exclusivos (R$ 841)",
];
const BUSINESS_FEATURES = [
  "Tudo do Pro, mas SEM limites",
  "Clientes, jobs e vendedores ilimitados",
  "Múltiplos vendedores com permissões",
  "Suporte prioritário com SLA",
  "Relatórios avançados",
  "Onboarding 1-a-1 com nossa equipe",
  "Os 3 bônus exclusivos (R$ 841)",
];

/* ─────────────────────── URGENCY BAR ───────────────────────────────────────── */
function UrgencyBar({ promoEndsAt }: { promoEndsAt: number }) {
  const cd = useCountdown(promoEndsAt);
  if (cd.ended) return null;
  return (
    <section className="py-3 bg-gradient-to-r from-rose-600 via-rose-500 to-amber-500 text-white">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-center gap-2 text-center text-sm">
        <Clock size={16} className="flex-shrink-0" />
        <span><strong>Oferta de lançamento</strong> termina em <strong>{cd.d}d {String(cd.h).padStart(2, "0")}:{String(cd.m).padStart(2, "0")}:{String(cd.s).padStart(2, "0")}</strong></span>
        <span className="hidden sm:inline">·</span>
        <Link to="/cadastro" className="font-bold underline hover:no-underline">Garantir minha vaga →</Link>
      </div>
    </section>
  );
}

/* ─────────────────────── FAQ ───────────────────────────────────────────────── */
function FaqSection() {
  const faqs = [
    { q: "Como funciona o trial de 7 dias?", a: "Você cria a conta, ganha 7 dias com acesso COMPLETO ao plano Pro. Não precisa cartão de crédito. Quando acabar, você decide se quer assinar." },
    { q: "Posso cancelar a qualquer momento?", a: "Sim. Cancela pelo próprio app, com 2 cliques. Sem precisar entrar em contato. Você mantém o acesso até o fim do período já pago." },
    { q: "Vou conseguir migrar meus dados?", a: "Sim. Importamos via CSV (planilha) e te ajudamos no processo. A maioria dos fotógrafos importa tudo em menos de 30 minutos." },
    { q: "Como é cobrado?", a: "PIX recorrente (Asaas debita automaticamente todo mês) ou cartão de crédito. A primeira cobrança só acontece depois dos 7 dias grátis." },
    { q: "A extensão do WhatsApp é segura?", a: "100%. A extensão só lê a página do WhatsApp Web que VOCÊ já abriu. Não armazena conversas. Nenhuma mensagem sua vai pros nossos servidores." },
    { q: "Posso usar pelo celular?", a: "O app web roda perfeitamente no navegador do celular. A extensão é específica pro WhatsApp Web (computador)." },
    { q: "Tem suporte humano?", a: "Tem. Email no plano Pro (resposta em até 24h) e atendimento prioritário no Business." },
    { q: "Funciona pra outros nichos além de fotógrafo?", a: "Funciona, mas o produto foi desenhado pensando no fluxo de fotógrafos: Gestante → Newborn, ensaios recorrentes, contratos com cláusulas específicas, etc. Outros nichos vão usar 80% do potencial." },
  ];
  return (
    <section id="faq" className="py-20 sm:py-28">
      <div className="max-w-3xl mx-auto px-4 sm:px-6">
        <FadeIn>
          <h2 className="text-3xl sm:text-4xl font-bold text-center mb-3">Dúvidas frequentes</h2>
          <p className="text-lg text-gray-600 dark:text-gray-300 text-center mb-12">
            Se ficou alguma dúvida que não está aqui, é só falar com a gente.
          </p>
        </FadeIn>
        <div className="space-y-3">
          {faqs.map((f, i) => (
            <FadeIn key={f.q} delay={i * 0.04}>
              <details className="group bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
                <summary className="cursor-pointer p-5 font-semibold text-gray-900 dark:text-white flex items-center justify-between list-none gap-3 hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors">
                  <span>{f.q}</span>
                  <ChevronDown size={18} className="text-gray-400 group-open:rotate-180 transition-transform flex-shrink-0" />
                </summary>
                <div className="px-5 pb-5 text-gray-600 dark:text-gray-300 leading-relaxed">{f.a}</div>
              </details>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────── FINAL CTA ─────────────────────────────────────────── */
function FinalCta() {
  return (
    <section className="py-20 sm:py-28 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-gray-900 via-gray-900 to-amber-900 dark:from-gray-950 dark:via-gray-950 dark:to-amber-950" />
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-amber-500/20 rounded-full blur-3xl" />
      <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-rose-500/10 rounded-full blur-3xl" />

      <div className="relative max-w-3xl mx-auto px-4 sm:px-6 text-center text-white">
        <FadeIn>
          <h2 className="text-3xl sm:text-5xl font-bold mb-4 leading-tight">
            Próximo cliente, você prefere fechar<br className="hidden sm:block" />
            <span className="text-amber-400">organizado</span> ou perdido?
          </h2>
          <p className="text-lg sm:text-xl text-gray-200 mb-8 max-w-xl mx-auto">
            7 dias grátis. Sem cartão. Sem risco. Decide depois.
          </p>
          <Link
            to="/cadastro"
            className="group inline-flex items-center gap-2 px-8 py-4 bg-gradient-to-r from-amber-400 to-amber-600 hover:from-amber-500 hover:to-amber-700 text-white font-bold rounded-xl shadow-2xl shadow-amber-500/40 hover:shadow-amber-500/60 transition-all hover:-translate-y-1 text-lg"
          >
            Criar conta grátis agora
            <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
          </Link>
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 mt-7 text-xs text-gray-400">
            <span className="flex items-center gap-1"><Check size={13} className="text-emerald-400" /> Cancele a qualquer momento</span>
            <span className="flex items-center gap-1"><Check size={13} className="text-emerald-400" /> Sem fidelidade</span>
            <span className="flex items-center gap-1"><Check size={13} className="text-emerald-400" /> Os 3 bônus inclusos</span>
          </div>
        </FadeIn>
      </div>
    </section>
  );
}

/* ─────────────────────── FOOTER ────────────────────────────────────────────── */
function Footer() {
  return (
    <footer className="border-t border-gray-100 dark:border-white/5 py-12 bg-gray-50 dark:bg-[#08080a]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="grid sm:grid-cols-3 gap-8 mb-8">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center">
                <Camera size={14} className="text-white" />
              </div>
              <span className="font-bold">{APP_NAME}</span>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
              O CRM completo pensado pra fotógrafos brasileiros.
            </p>
          </div>
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-3">Produto</h4>
            <ul className="space-y-2 text-sm">
              <li><a href="#recursos" className="text-gray-600 dark:text-gray-300 hover:text-amber-600 dark:hover:text-amber-400">Recursos</a></li>
              <li><a href="#precos" className="text-gray-600 dark:text-gray-300 hover:text-amber-600 dark:hover:text-amber-400">Preços</a></li>
              <li><a href="#faq" className="text-gray-600 dark:text-gray-300 hover:text-amber-600 dark:hover:text-amber-400">Dúvidas</a></li>
            </ul>
          </div>
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-3">Conta</h4>
            <ul className="space-y-2 text-sm">
              <li><Link to="/login" className="text-gray-600 dark:text-gray-300 hover:text-amber-600 dark:hover:text-amber-400">Entrar</Link></li>
              <li><Link to="/cadastro" className="text-gray-600 dark:text-gray-300 hover:text-amber-600 dark:hover:text-amber-400">Criar conta grátis</Link></li>
              <li><Link to="/termos" className="text-gray-600 dark:text-gray-300 hover:text-amber-600 dark:hover:text-amber-400">Termos</Link></li>
              <li><Link to="/privacidade" className="text-gray-600 dark:text-gray-300 hover:text-amber-600 dark:hover:text-amber-400">Privacidade</Link></li>
            </ul>
          </div>
        </div>
        <div className="pt-6 border-t border-gray-200 dark:border-white/5 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-gray-400 dark:text-gray-500">
          <p>© {new Date().getFullYear()} {APP_NAME}. Todos os direitos reservados.</p>
          <p>Feito com 📷 no Brasil</p>
        </div>
      </div>
    </footer>
  );
}
