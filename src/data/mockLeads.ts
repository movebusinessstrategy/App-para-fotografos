import { Lead, QuickReply } from "../types/vendas";

const minutesAgo = (minutes: number) => {
  const date = new Date();
  date.setMinutes(date.getMinutes() - minutes);
  return date;
};

const hoursAgo = (hours: number) => {
  const date = new Date();
  date.setHours(date.getHours() - hours);
  return date;
};

const daysAgo = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
};

export const mockLeads: Lead[] = [
  {
    id: "lead-1",
    name: "Maria Silva",
    phone: "(43) 99999-1234",
    channel: "whatsapp",
    source: "Instagram",
    status: "inbox",
    stage: "novo",
    serviceType: "Ensaio Externo",
    estimatedValue: 450,
    tags: ["ensaio", "novo"],
    notes: "Cliente viu portfólio no Instagram e quer fotos externas ao pôr do sol.",
    messages: [
      {
        id: "m-1",
        content: "Oi, vi seu trabalho e amei!",
        timestamp: minutesAgo(45),
        isFromClient: true,
      },
      {
        id: "m-2",
        content: "Oi Maria! 😊 Obrigado! Como posso ajudar?",
        timestamp: minutesAgo(42),
        isFromClient: false,
        status: "read",
      },
      {
        id: "m-3",
        content: "Qual o valor do ensaio externo?",
        timestamp: minutesAgo(40),
        isFromClient: true,
      },
    ],
    unreadCount: 2,
    createdAt: daysAgo(2),
    updatedAt: minutesAgo(40),
  },
  {
    id: "lead-2",
    name: "Pedro Santos",
    instagramHandle: "@pedrosants",
    channel: "instagram",
    source: "Indicação",
    status: "inbox",
    stage: "novo",
    serviceType: "Ensaio Estúdio",
    estimatedValue: 520,
    tags: ["estúdio"],
    notes: "Curtiu campanha de retratos, prefere fundo claro.",
    messages: [
      {
        id: "m-4",
        content: "Olá! Vi seus retratos, você tem datas na próxima semana?",
        timestamp: hoursAgo(3),
        isFromClient: true,
      },
      {
        id: "m-5",
        content: "Tenho sim! Quais dias te atendem melhor?",
        timestamp: hoursAgo(3),
        isFromClient: false,
        status: "delivered",
      },
      {
        id: "m-6",
        content: "Quinta ou sexta à tarde.",
        timestamp: hoursAgo(2.5),
        isFromClient: true,
      },
    ],
    unreadCount: 1,
    createdAt: daysAgo(1),
    updatedAt: hoursAgo(2.5),
  },
  {
    id: "lead-3",
    name: "Bruna Torres",
    phone: "(11) 98888-2200",
    channel: "whatsapp",
    source: "WhatsApp",
    status: "pipeline",
    stage: "novo",
    serviceType: "15 Anos",
    estimatedValue: 2500,
    tags: ["evento", "15anos"],
    notes: "Evento em agosto, quer pacote completo com álbum.",
    messages: [
      {
        id: "m-7",
        content: "Oi! Faz cobertura de festa de 15 anos?",
        timestamp: hoursAgo(20),
        isFromClient: true,
      },
      {
        id: "m-8",
        content: "Faço sim! Posso te mandar um pacote com opções.",
        timestamp: hoursAgo(19.8),
        isFromClient: false,
        status: "delivered",
      },
      {
        id: "m-9",
        content: "Quero com álbum e making of.",
        timestamp: hoursAgo(19.5),
        isFromClient: true,
      },
      {
        id: "m-10",
        content: "Perfeito! Já envio valores.",
        timestamp: hoursAgo(19.4),
        isFromClient: false,
        status: "sent",
      },
    ],
    unreadCount: 0,
    createdAt: daysAgo(3),
    updatedAt: hoursAgo(19.4),
  },
  {
    id: "lead-4",
    name: "João Costa",
    instagramHandle: "@joaocosta",
    channel: "instagram",
    source: "Instagram",
    status: "pipeline",
    stage: "negociando",
    serviceType: "Casamento",
    estimatedValue: 4800,
    tags: ["casamento", "2025"],
    notes: "Casamento civil em novembro, quer fotos e vídeo curto.",
    messages: [
      {
        id: "m-11",
        content: "Tem data 12/11 para casamento civil?",
        timestamp: daysAgo(1),
        isFromClient: true,
      },
      {
        id: "m-12",
        content: "Tenho sim! Quer só fotos ou fotos + vídeo curto?",
        timestamp: daysAgo(1),
        isFromClient: false,
        status: "read",
      },
      {
        id: "m-13",
        content: "Fotos + vídeo curto.",
        timestamp: hoursAgo(15),
        isFromClient: true,
      },
    ],
    unreadCount: 1,
    createdAt: daysAgo(5),
    updatedAt: hoursAgo(15),
  },
  {
    id: "lead-5",
    name: "Fernanda Lima",
    phone: "(21) 97777-6644",
    channel: "whatsapp",
    source: "Indicação",
    status: "pipeline",
    stage: "negociando",
    serviceType: "Ensaio Estúdio",
    estimatedValue: 650,
    tags: ["estúdio", "lookbook"],
    notes: "Precisa de lookbook para marca própria, pede prazo rápido.",
    messages: [
      {
        id: "m-14",
        content: "Preciso de lookbook para minha marca.",
        timestamp: hoursAgo(8),
        isFromClient: true,
      },
      {
        id: "m-15",
        content: "Entendi! Quantos looks e qual prazo ideal?",
        timestamp: hoursAgo(7.5),
        isFromClient: false,
        status: "delivered",
      },
      {
        id: "m-16",
        content: "12 looks, preciso pronto em 10 dias.",
        timestamp: hoursAgo(7.3),
        isFromClient: true,
      },
      {
        id: "m-17",
        content: "Consigo sim, te envio proposta hoje.",
        timestamp: hoursAgo(6.8),
        isFromClient: false,
        status: "sent",
      },
    ],
    unreadCount: 0,
    createdAt: daysAgo(4),
    updatedAt: hoursAgo(6.8),
  },
  {
    id: "lead-6",
    name: "Ana Costa",
    phone: "(31) 93333-1122",
    channel: "whatsapp",
    source: "WhatsApp",
    status: "pipeline",
    stage: "fechado",
    serviceType: "15 Anos",
    estimatedValue: 600,
    tags: ["15anos", "contrato"],
    notes: "Contrato enviado, aguarda sinal amanhã.",
    messages: [
      {
        id: "m-18",
        content: "Fechamos! Envio sinal amanhã.",
        timestamp: hoursAgo(12),
        isFromClient: true,
      },
      {
        id: "m-19",
        content: "Perfeito, contrato enviado por aqui. Qualquer dúvida me fala.",
        timestamp: hoursAgo(11.8),
        isFromClient: false,
        status: "delivered",
      },
    ],
    unreadCount: 0,
    createdAt: daysAgo(7),
    updatedAt: hoursAgo(11.8),
  },
  {
    id: "lead-7",
    name: "Carlos Mendes",
    instagramHandle: "@carlos.mendes",
    channel: "instagram",
    source: "Instagram",
    status: "pipeline",
    stage: "concluido",
    serviceType: "Corporativo",
    estimatedValue: 900,
    tags: ["b2b", "video"],
    notes: "Job entregue, cliente quer renovar pacote trimestral.",
    messages: [
      {
        id: "m-20",
        content: "Entrega recebida, ficou ótimo!",
        timestamp: daysAgo(2),
        isFromClient: true,
      },
      {
        id: "m-21",
        content: "Que bom que gostou! Vamos falar do pacote trimestral?",
        timestamp: daysAgo(2),
        isFromClient: false,
        status: "read",
      },
    ],
    unreadCount: 0,
    createdAt: daysAgo(20),
    updatedAt: daysAgo(2),
  },
  {
    id: "lead-8",
    name: "Julia Alves",
    instagramHandle: "@juliaalvs",
    channel: "instagram",
    source: "Recorrente",
    status: "pipeline",
    stage: "concluido",
    serviceType: "Ensaio Externo",
    estimatedValue: 450,
    tags: ["ensaio", "recorrente"],
    notes: "Cliente recorrente, gosta de locações com verde.",
    messages: [
      {
        id: "m-22",
        content: "Amei as fotos! Quando abrimos nova data?",
        timestamp: daysAgo(5),
        isFromClient: true,
      },
      {
        id: "m-23",
        content: "Semana que vem tenho agenda no parque, pode ser?",
        timestamp: daysAgo(5),
        isFromClient: false,
        status: "read",
      },
      {
        id: "m-24",
        content: "Pode ser sim, me passa horário.",
        timestamp: daysAgo(4.8),
        isFromClient: true,
      },
    ],
    unreadCount: 0,
    createdAt: daysAgo(40),
    updatedAt: daysAgo(4.8),
  },
];

export const quickReplies: QuickReply[] = [
  { id: "qr-1", title: "Preços", content: "Olá! Segue nossa tabela de preços: ensaio externo a partir de R$450, estúdio R$520 e eventos sob consulta." },
  { id: "qr-2", title: "Agendar", content: "Vamos agendar? Qual a melhor data e horário para você?" },
  { id: "qr-3", title: "Prazo", content: "O prazo de entrega é de 15 dias úteis após o ensaio." },
  { id: "qr-4", title: "Confirmar", content: "Confirmado! Te aguardo no dia e horário combinados." },
  { id: "qr-5", title: "Localização", content: "O estúdio fica na Rua das Fotos, 123 - Centro. Posso te enviar a localização?" },
];
