import { useState } from "react";
import { api } from "./api";
import { useErrorReporter } from "./AppConsole";
import { canMoveHotkey, prepareHotkeyMove, type HotkeySource } from "./hotkeyTransfer";
import { canMoveOverlay, prepareOverlayMove, type OverlaySource } from "./overlayTransfer";
import type { Database } from "./types";

type ProfileItemSource = ({ kind: "hotkey" } & HotkeySource) | OverlaySource;
export interface ProfileItemDrag {
  target: string | null;
  moving: boolean;
  begin: (source: ProfileItemSource) => void;
  end: () => void;
  canDrop: (gameId: string, profileId: string, groupId?: string) => boolean;
  over: (gameId: string, profileId: string, groupId?: string) => void;
  leave: (gameId: string, profileId: string, groupId?: string) => void;
  drop: (gameId: string, profileId: string, groupId?: string) => Promise<void>;
}

export const profileDropKey = (gameId: string, profileId: string, groupId?: string) => JSON.stringify([gameId, profileId, groupId ?? null]);

export function useProfileItemDrag(db: Database | null, onDb: (db: Database) => void): ProfileItemDrag {
  const reportError = useErrorReporter();
  const [source, setSource] = useState<ProfileItemSource | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const canDrop = (gameId: string, profileId: string, groupId?: string) => !!db && !!source && !moving &&
    (source.kind === "hotkey" ? !groupId && canMoveHotkey(db, source, gameId, profileId) : canMoveOverlay(db, source, gameId, profileId, groupId));
  function end() { setSource(null); setTarget(null); }
  return { target, moving, canDrop, end,
    begin(value) { if (!moving) { setSource(value); setTarget(null); } },
    over(gameId, profileId, groupId) { if (canDrop(gameId, profileId, groupId)) setTarget(profileDropKey(gameId, profileId, groupId)); },
    leave(gameId, profileId, groupId) { setTarget(current => current === profileDropKey(gameId, profileId, groupId) ? null : current); },
    async drop(gameId, profileId, groupId) {
      if (!db || !source || !canDrop(gameId, profileId, groupId)) return;
      end(); setMoving(true);
      try {
        if (source.kind === "hotkey") {
          const dependencies = prepareHotkeyMove(db, source, gameId, profileId);
          onDb(await api.moveHotkey(source.gameId, source.profileId, source.index, source.hotkey, gameId, dependencies));
        } else {
          const dependencies = prepareOverlayMove(db, source, gameId, profileId, groupId);
          onDb(await api.moveOverlay(source.gameId, source.profileId, source, gameId, dependencies, groupId ?? null));
        }
      } catch (error) { reportError(error); }
      finally { setMoving(false); }
    },
  };
}
