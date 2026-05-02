import { useAppState } from '../../context/AppContext'
import styles from './LiveRegion.module.css'

/**
 * 全域 aria-live 通知區。掛在 App root 一次，避免多 region 重複播報。
 *
 * 同訊息連續觸發時，SR 偵測 textContent 沒變不會重唸；
 * 用 `<span key={seq}>` 強制 React unmount + mount 新節點，aria-live region 內
 * 新插入子節點會被 SR 偵測為新 announcement。
 */
export default function LiveRegion() {
  const { liveAnnouncement } = useAppState()
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className={styles.region}>
      {liveAnnouncement.seq > 0 && (
        <span key={liveAnnouncement.seq}>{liveAnnouncement.message}</span>
      )}
    </div>
  )
}
