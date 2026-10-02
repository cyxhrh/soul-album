type IconName = 'chat' | 'album' | 'data' | 'more' | 'phone'

export const COMPANIONS = [
  { id: 'xiaojian', name: '小笺', label: '女性' },
  { id: 'zhimo', name: '知墨', label: '男性' },
  { id: 'manman', name: '慢慢', label: '中性' },
] as const

export function companionImage(id: string) {
  return `${import.meta.env.BASE_URL}brand/characters/jianji-${id}-cutout.png`
}

export function ProductIcon({ name }: { name: IconName }) {
  return <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
    strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === 'chat' && <path d="M20.5 11.3a8.5 7.5 0 0 1-8.5 7.5c-1.2 0-2.4-.2-3.5-.6L4 20l1.1-4A7 7 0 0 1 3.5 11.3a8.5 7.5 0 0 1 17 0ZM8 11h.01M12 11h.01M16 11h.01" />}
    {name === 'album' && <><path d="M5 3.5h13a1 1 0 0 1 1 1v16H6a3 3 0 0 1-3-3v-12a2 2 0 0 1 2-2ZM7 3.5v13M3 17h16M11 8h4M11 11h3" /></>}
    {name === 'data' && <><path d="M4 19.5h16M6 15V9M12 15V4M18 15v-4" /><circle cx="6" cy="7" r="1" /><circle cx="18" cy="9" r="1" /></>}
    {name === 'more' && <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>}
    {name === 'phone' && <path strokeLinejoin="round" d="M22 16.92v3a2 2 0 0 1-2.18 2A19.79 19.79 0 0 1 3.09 5.18 2 2 0 0 1 5.08 3h3a2 2 0 0 1 2 1.72c.12.96.34 1.91.65 2.82a2 2 0 0 1-.45 2.11L9.01 10.9a16 16 0 0 0 4.09 4.09l1.27-1.27a2 2 0 0 1 2.11-.45c.91.31 1.86.53 2.82.65A2 2 0 0 1 22 16.92Z" />}
  </svg>
}

export function MicrophoneIcon({ size = 19 }: { size?: number }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
    strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="3" width="6" height="12" rx="3" />
    <path d="M6 11a6 6 0 0 0 12 0M12 17v4m-4 0h8" />
  </svg>
}

export function ChatAvatar({ user = false, src }: { user?: boolean; src?: string }) {
  return <span className={'product-avatar' + (user ? ' product-avatar-self' : src ? ' product-avatar-companion' : '')} aria-hidden="true">
    {user ? '我' : src ? <img src={src} alt="" /> : <svg viewBox="0 0 44 44" width="44" height="44" fill="none">
      <rect width="44" height="44" rx="9" fill="#dce7da" />
      <circle cx="31" cy="12" r="5" fill="#f7edc7" />
      <path d="M0 32 17 16l17 28H0Z" fill="#819a7c" />
      <path d="m16 44 18-23 10 10v13Z" fill="#4e7263" />
      <path d="m0 36 13-7 11 15H0Z" fill="#adc0a0" />
    </svg>}
  </span>
}
