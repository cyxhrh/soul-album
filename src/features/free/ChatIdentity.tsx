type IconName = 'chat' | 'album' | 'data' | 'more'

export function ProductIcon({ name }: { name: IconName }) {
  return <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
    strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === 'chat' && <path d="M20.5 11.3a8.5 7.5 0 0 1-8.5 7.5c-1.2 0-2.4-.2-3.5-.6L4 20l1.1-4A7 7 0 0 1 3.5 11.3a8.5 7.5 0 0 1 17 0ZM8 11h.01M12 11h.01M16 11h.01" />}
    {name === 'album' && <><path d="M5 3.5h13a1 1 0 0 1 1 1v16H6a3 3 0 0 1-3-3v-12a2 2 0 0 1 2-2ZM7 3.5v13M3 17h16M11 8h4M11 11h3" /></>}
    {name === 'data' && <><path d="M4 19.5h16M6 15V9M12 15V4M18 15v-4" /><circle cx="6" cy="7" r="1" /><circle cx="18" cy="9" r="1" /></>}
    {name === 'more' && <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>}
  </svg>
}

export function ChatAvatar({ user = false }: { user?: boolean }) {
  return <span className={'product-avatar' + (user ? ' product-avatar-self' : '')} aria-hidden="true">
    {user ? '我' : <svg viewBox="0 0 44 44" width="44" height="44" fill="none">
      <rect width="44" height="44" rx="9" fill="#dce7da" />
      <circle cx="31" cy="12" r="5" fill="#f7edc7" />
      <path d="M0 32 17 16l17 28H0Z" fill="#819a7c" />
      <path d="m16 44 18-23 10 10v13Z" fill="#4e7263" />
      <path d="m0 36 13-7 11 15H0Z" fill="#adc0a0" />
    </svg>}
  </span>
}
