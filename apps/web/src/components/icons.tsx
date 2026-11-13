import type { ReactNode } from 'react';

function Icon({ children, size = 22 }: { children: ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export const ChatIcon = () => (
  <Icon>
    <path d="M21 12a8 8 0 0 1-11.600 7.100L4 20l1-4.400A8 8 0 1 1 21 12Z" />
  </Icon>
);
export const StatusIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3a9 9 0 0 1 9 9M12 21a9 9 0 0 1-9-9" />
  </Icon>
);
export const ContactsIcon = () => (
  <Icon>
    <circle cx="9" cy="8" r="3.500" />
    <path d="M2.500 20a6.500 6.500 0 0 1 13 0M16 4.500a3.500 3.500 0 0 1 0 7M18 14.500a6 6 0 0 1 3.500 5.500" />
  </Icon>
);
export const MenuIcon = () => (
  <Icon>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Icon>
);
export const CloseIcon = () => (
  <Icon>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
);
export const SendIcon = () => (
  <Icon size={20}>
    <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z" />
  </Icon>
);
export const BackIcon = () => (
  <Icon>
    <path d="m15 18-6-6 6-6" />
  </Icon>
);
export const PlusIcon = () => (
  <Icon>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);
export const UserIcon = () => (
  <Icon>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </Icon>
);
export const SettingsIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.400 15a1.700 1.700 0 0 0 .3 1.800l.1.100a2 2 0 1 1-2.800 2.800l-.1-.1a1.700 1.700 0 0 0-1.800-.3 1.700 1.700 0 0 0-1 1.500V21a2 2 0 1 1-4 0v-.1a1.700 1.700 0 0 0-1.100-1.500 1.700 1.700 0 0 0-1.800.3l-.1.1a2 2 0 1 1-2.800-2.800l.1-.1a1.700 1.700 0 0 0 .3-1.800 1.700 1.700 0 0 0-1.500-1H3a2 2 0 1 1 0-4h.1a1.700 1.700 0 0 0 1.500-1.100 1.700 1.700 0 0 0-.3-1.800l-.1-.1a2 2 0 1 1 2.800-2.800l.1.100a1.700 1.700 0 0 0 1.800.3H9a1.700 1.700 0 0 0 1-1.500V3a2 2 0 1 1 4 0v.1a1.700 1.700 0 0 0 1 1.500 1.700 1.700 0 0 0 1.800-.3l.1-.1a2 2 0 1 1 2.800 2.800l-.1.100a1.700 1.700 0 0 0-.3 1.800V9a1.700 1.700 0 0 0 1.500 1H21a2 2 0 1 1 0 4h-.1a1.700 1.700 0 0 0-1.500 1Z" />
  </Icon>
);
export const GroupIcon = () => (
  <Icon>
    <circle cx="9" cy="9" r="3" />
    <circle cx="17" cy="10" r="2.500" />
    <path d="M3 19a6 6 0 0 1 12 0M15.500 15.200A5 5 0 0 1 21 20" />
  </Icon>
);
export const LogoutIcon = () => (
  <Icon>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
  </Icon>
);
export const HelpIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.500 9a2.500 2.500 0 1 1 3.500 2.300c-.7.400-1 1-1 1.700M12 17h.01" />
  </Icon>
);
/* Íconos del chat (adjuntos, voz y stickers). */
export const AttachIcon = () => (
  <Icon>
    <path d="m20.500 11.500-8.200 8.200a5 5 0 0 1-7.100-7.100l8.500-8.500a3.300 3.300 0 0 1 4.700 4.700l-8.500 8.500a1.700 1.700 0 0 1-2.400-2.400l7.800-7.800" />
  </Icon>
);
export const ImageIcon = () => (
  <Icon>
    <rect x="3" y="4" width="18" height="16" rx="2.500" />
    <circle cx="9" cy="10" r="1.800" />
    <path d="m21 16-5-5-9 9" />
  </Icon>
);
export const FileIcon = () => (
  <Icon>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
    <path d="M14 3v5h5M9 13h6M9 17h4" />
  </Icon>
);
export const VideoIcon = () => (
  <Icon>
    <rect x="2.500" y="6" width="13" height="12" rx="2.500" />
    <path d="m15.500 10.500 6-3.500v10l-6-3.500" />
  </Icon>
);
export const MicIcon = () => (
  <Icon>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5.500 11a6.500 6.500 0 0 0 13 0M12 17.500V21" />
  </Icon>
);
export const StopIcon = () => (
  <Icon>
    <rect x="6.500" y="6.500" width="11" height="11" rx="2" />
  </Icon>
);
export const StickerIcon = () => (
  <Icon>
    <path d="M20.500 12A8.500 8.500 0 1 1 12 3.500h3.500l5 5Z" />
    <path d="M8.500 14.500a4.500 4.500 0 0 0 7 0M9 9.500h.01M15 9.500h.01" />
  </Icon>
);
export const TrashIcon = () => (
  <Icon>
    <path d="M4 7h16M9.500 7V4.500h5V7M6.500 7l1 13h9l1-13M10 11v5M14 11v5" />
  </Icon>
);
export const DownloadIcon = () => (
  <Icon>
    <path d="M12 4v11M7 10.500l5 5 5-5M4.500 20h15" />
  </Icon>
);

/* Íconos de estado (se muestran grandes dentro de `.state-icon`). */
export const MailIcon = () => (
  <Icon>
    <rect x="3" y="5" width="18" height="14" rx="2.5" />
    <path d="m3.500 7 8.500 6 8.500-6" />
  </Icon>
);
export const LockIcon = () => (
  <Icon>
    <rect x="4.500" y="10.500" width="15" height="10" rx="2.500" />
    <path d="M8 10.500V7.500a4 4 0 0 1 8 0v3M12 14.500v2.500" />
  </Icon>
);
export const CheckCircleIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <path d="m8 12.300 2.700 2.700L16 9.500" />
  </Icon>
);
export const AlertIcon = () => (
  <Icon>
    <path d="M10.300 4.200 2.700 17.500A2 2 0 0 0 4.400 20.500h15.200a2 2 0 0 0 1.700-3L13.700 4.200a2 2 0 0 0-3.400 0Z" />
    <path d="M12 9.500v4M12 17h.01" />
  </Icon>
);
export const ClockIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Icon>
);
export const SparkleIcon = () => (
  <Icon>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.300 6.300l2.400 2.400M15.300 15.300l2.400 2.400M17.700 6.300l-2.400 2.400M8.700 15.300l-2.400 2.400" />
  </Icon>
);
export const CameraIcon = () => (
  <Icon>
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2Z" />
    <circle cx="12" cy="13" r="4" />
  </Icon>
);
export const PhoneIcon = () => (
  <Icon>
    <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2Z" />
  </Icon>
);
export const PhoneOffIcon = () => (
  <Icon>
    <path d="M10.7 13.3a16 16 0 0 0 3.3 2.5l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.4 19.4 0 0 1-3.3-2.6M5.2 12.2A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8M22 2 2 22" />
  </Icon>
);
export const MicOffIcon = () => (
  <Icon>
    <path d="m2 2 20 20M9 9v3a3 3 0 0 0 5.1 2.1M15 9.3V5a3 3 0 0 0-5.9-.7M19 10v2a7 7 0 0 1-.6 2.9M5 10v2a7 7 0 0 0 11.6 5.3M12 19v3" />
  </Icon>
);
export const VideoOffIcon = () => (
  <Icon>
    <path d="m2 2 20 20M10.7 5H14a2 2 0 0 1 2 2v3.3l1 1L22 8v8M16 16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h1" />
  </Icon>
);
export const SwitchCameraIcon = () => (
  <Icon>
    <path d="M11 19H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5M13 5h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-5" />
    <circle cx="12" cy="12" r="3" />
    <path d="m18 22-3-3 3-3M6 2l3 3-3 3" />
  </Icon>
);
