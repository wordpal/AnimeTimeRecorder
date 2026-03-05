import { useEffect, useMemo, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useRegisterSW } from 'virtual:pwa-register/react'

function TabLink(props: { to: string; label: string }) {
  return (
    <NavLink
      to={props.to}
      className={({ isActive }) =>
        [
          'flex flex-1 flex-col items-center justify-center py-2 text-xs',
          isActive ? 'text-slate-900' : 'text-slate-500',
        ].join(' ')
      }
    >
      <span className="font-medium">{props.label}</span>
    </NavLink>
  )
}

function GlobalPwaNotices() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW()
  const [isOnline, setIsOnline] = useState<boolean>(() => navigator.onLine)

  useEffect(() => {
    const onOnline = () => setIsOnline(true)
    const onOffline = () => setIsOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  const showUpdate = needRefresh
  const showOffline = !isOnline

  const message = useMemo(() => {
    if (showUpdate) return '发现新版本，刷新即可更新。'
    if (showOffline) return '当前离线：在线搜索不可用，可浏览本地记录/缓存。'
    return ''
  }, [showOffline, showUpdate])

  if (!showUpdate && !showOffline) return null

  return (
    <div className="fixed left-0 right-0 top-0 z-50">
      <div className="mx-auto flex max-w-md items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 text-xs text-slate-800">
        <div className="flex-1">{message}</div>
        {showUpdate ? (
          <button
            type="button"
            className="rounded-md bg-slate-900 px-2 py-1 font-medium text-white"
            onClick={() => void updateServiceWorker(true)}
          >
            刷新更新
          </button>
        ) : null}
      </div>
    </div>
  )
}

export default function RootLayout() {
  return (
    <div className="min-h-dvh bg-white text-slate-900">
      <GlobalPwaNotices />
      <div className="mx-auto min-h-dvh max-w-md pb-16 pt-9">
        <Outlet />
      </div>

      <nav className="fixed bottom-0 left-0 right-0 border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-md">
          <TabLink to="/search" label="搜索" />
          <TabLink to="/my" label="我的" />
          <TabLink to="/settings" label="设置" />
        </div>
      </nav>
    </div>
  )
}
