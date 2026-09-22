import { useApp } from "ink";
import { useMemo, useState, type ReactElement } from "react";
import type { FlowApp } from "@/app.js";
import { loadLastSelection, saveLastSelection } from "@/api/selector.js";
import type { Driver } from "@/domain/drivers.js";
import type { ModelInfo, OrchestrationMode } from "@/domain/models.js";
import type { Orchestrant } from "@/domain/orchestrator.js";
import type { PermissionMode } from "@/domain/permissions.js";
import type { ThinkingLevel } from "@/domain/thinking.js";
import { ModePicker } from "@/api/tui/ModePicker.js";
import { Picker } from "@/api/tui/Picker.js";
import { Session } from "@/api/tui/Session.js";
import { ThinkingPicker } from "@/api/tui/ThinkingPicker.js";

export interface TuiAppProps {
  app: FlowApp;
  models: ModelInfo[];
  notify: boolean;
  yolo: boolean;
  permission: { current: PermissionMode };
  createAgents: (ids: string[], thinking: ThinkingLevel) => Orchestrant[];
  createDriver: (id: string) => Driver;
  /** past council lessons from the composition root ("" when none) */
  lessons?: string;
}

type Screen =
  | { name: "picker" }
  | { name: "mode"; models: string[] }
  | { name: "thinking"; models: string[]; mode: OrchestrationMode }
  | { name: "session"; models: string[]; mode: OrchestrationMode; thinking: ThinkingLevel };

export function visibleRows(models: ModelInfo[], limit: number): string[] {
  return models.slice(0, Math.max(0, limit)).map((m) => `${m.provider} ${m.id}`);
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}

export function App({
  app,
  models,
  notify,
  yolo,
  permission,
  createAgents,
  createDriver,
  lessons = "",
}: TuiAppProps): ReactElement {
  const { exit } = useApp();
  const [screen, setScreen] = useState<Screen>({ name: "picker" });
  const last = useMemo(() => {
    try {
      return loadLastSelection(app, new Set(models.map((m) => m.id)));
    } catch {
      return undefined;
    }
  }, [app, models]);

  if (screen.name === "mode") {
    const remembered =
      last !== undefined && sameSet(last.models, screen.models) ? last.mode : undefined;
    return (
      <ModePicker
        defaultMode={remembered ?? (screen.models.length > 1 ? "council" : "solo")}
        onDone={(mode) => setScreen({ name: "thinking", models: screen.models, mode })}
        onCancel={() => setScreen({ name: "picker" })}
      />
    );
  }
  if (screen.name === "thinking") {
    const remembered =
      last !== undefined && sameSet(last.models, screen.models) ? last.thinking : undefined;
    return (
      <ThinkingPicker
        defaultLevel={remembered ?? "medium"}
        onDone={(thinking) => {
          try {
            saveLastSelection(app, { models: screen.models, mode: screen.mode, thinking });
          } catch {
            // last-selection is best-effort
          }
          setScreen({ name: "session", models: screen.models, mode: screen.mode, thinking });
        }}
        onCancel={() => setScreen({ name: "mode", models: screen.models })}
      />
    );
  }
  if (screen.name === "session") {
    return (
      <Session
        app={app}
        modelIds={screen.models}
        mode={screen.mode}
        thinking={screen.thinking}
        notify={notify}
        yolo={yolo}
        permission={permission}
        createAgents={createAgents}
        createDriver={createDriver}
        lessons={lessons}
      />
    );
  }
  return (
    <Picker
      models={models}
      initialSelected={last?.models ?? []}
      recent={last?.recent ?? []}
      onDone={(ids) => setScreen({ name: "mode", models: ids })}
      onCancel={exit}
    />
  );
}
