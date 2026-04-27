export type ThemeMode = 'dark' | 'light';

export const whatsappTheme = {
  dark: {
    bg: {
      primary: '#0B141A',
      secondary: '#111B21',
      tertiary: '#202C33',
      hover: '#2A3942',
      input: '#2A3942',
    },
    bubble: {
      sent: '#005C4B',
      received: '#202C33',
    },
    text: {
      primary: '#E9EDEF',
      secondary: '#8696A0',
      muted: '#667781',
    },
    accent: {
      green: '#00A884',
      read: '#53BDEB',
    },
    border: '#2A3942',
  },
  light: {
    bg: {
      primary: '#EFEAE2',
      secondary: '#FFFFFF',
      tertiary: '#F0F2F5',
      hover: '#F5F6F6',
      input: '#FFFFFF',
    },
    bubble: {
      sent: '#D9FDD3',
      received: '#FFFFFF',
    },
    text: {
      primary: '#111B21',
      secondary: '#667781',
      muted: '#8696A0',
    },
    accent: {
      green: '#00A884',
      read: '#53BDEB',
    },
    border: '#E9EDEF',
  },
} as const;
