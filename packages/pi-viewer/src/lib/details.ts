import { useEffect, useState } from "react"

import type { ViewerEvent } from "@/shared/types"
import { fetchEvent } from "@/lib/api"

export interface DetailState {
  event?: ViewerEvent
  loading: boolean
  error?: string
}

export function useDetail(
  session: string | null,
  paneId: string,
  seq: number | undefined,
  enabled: boolean,
): DetailState {
  const [state, setState] = useState<DetailState>({ loading: false })

  useEffect(() => {
    if (!enabled || !session || seq === undefined) return
    let live = true
    setState((previous) => ({ ...previous, loading: true, error: undefined }))
    fetchEvent(session, paneId, seq)
      .then((event) => {
        if (live) setState({ event, loading: false })
      })
      .catch((error: unknown) => {
        if (!live) return
        setState({ loading: false, error: error instanceof Error ? error.message : String(error) })
      })
    return () => {
      live = false
    }
  }, [session, paneId, seq, enabled])

  return state
}
